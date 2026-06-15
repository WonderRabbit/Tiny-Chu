import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";

export type ProviderEndpointPreflightStatus = "skipped" | "pass" | "warning" | "blocked" | "fail";
export type ProviderNetworkMode = "disabled" | "loopback_only" | "explicit_hosts";

export interface ProviderEndpointPreflightDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface ProviderEndpointPreflightResult {
  readonly status: ProviderEndpointPreflightStatus;
  readonly provider: string;
  readonly endpoint?: string;
  readonly networkMode: ProviderNetworkMode;
  readonly timeoutMs: number;
  readonly requestAttempted: boolean;
  readonly modelCount?: number;
  readonly diagnostics: readonly ProviderEndpointPreflightDiagnostic[];
}

const DEFAULT_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 96_000;

function textInput(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String).filter((item) => item.trim() !== "") : [];
}

function networkMode(value: unknown): ProviderNetworkMode {
  if (value === "loopback_only" || value === "explicit_hosts") return value;
  return "disabled";
}

function timeoutInput(value: unknown): number {
  const timeout = typeof value === "number" && Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
  return Math.min(timeout, MAX_TIMEOUT_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function endpointPath(provider: string): string {
  return provider === "ollama" ? "/api/tags" : "/v1/models";
}

function isLoopback(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower.endsWith(".localhost");
}

function allowedByMode(url: URL, mode: ProviderNetworkMode, allowedHosts: readonly string[]): ProviderEndpointPreflightDiagnostic | undefined {
  if (mode === "disabled") {
    return { code: "network_disabled", severity: "info", message: "Network probing is disabled; no provider request was attempted." };
  }
  if (mode === "loopback_only" && !isLoopback(url.hostname)) {
    return { code: "remote_endpoint_blocked", severity: "error", message: "Only loopback provider endpoints may be probed in loopback_only mode." };
  }
  if (mode === "explicit_hosts" && !isLoopback(url.hostname) && !allowedHosts.includes(url.hostname)) {
    return { code: "remote_endpoint_blocked", severity: "error", message: "Remote provider endpoint is not listed in allowedHosts." };
  }
  return undefined;
}

function metadataUrl(endpoint: string, provider: string): URL | undefined {
  try {
    const url = new URL(endpoint);
    url.pathname = endpointPath(provider);
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
}

function displayEndpoint(url: URL): string {
  const redacted = new URL(`${url.protocol}//${url.hostname}`);
  redacted.pathname = url.pathname;
  return `${redacted.protocol}//${redacted.hostname}${redacted.pathname}`;
}

function countModels(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.models)) return value.models.length;
  if (Array.isArray(value.data)) return value.data.length;
  return undefined;
}

async function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_RESPONSE_BYTES) {
        response.destroy(new Error("Provider metadata response exceeded byte limit."));
      }
    });
    response.on("error", reject);
    response.on("end", () => resolve(body));
  });
}

async function fetchJson(url: URL, timeoutMs: number): Promise<{ readonly statusCode: number; readonly body: unknown }> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, { method: "GET", timeout: timeoutMs }, (response) => {
      void readBody(response)
        .then((body) => {
          const parsed: unknown = body.trim() === "" ? undefined : JSON.parse(body);
          resolve({ statusCode: response.statusCode ?? 0, body: parsed });
        })
        .catch(reject);
    });
    request.on("timeout", () => request.destroy(new Error("Provider metadata probe timed out.")));
    request.on("error", reject);
    request.end();
  });
}

export async function createProviderEndpointPreflight(input: Record<string, unknown>): Promise<ProviderEndpointPreflightResult> {
  const provider = textInput(input, "provider", "openai_compatible");
  const endpoint = textInput(input, "endpoint", provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234");
  const mode = networkMode(input.networkMode);
  const timeoutMs = timeoutInput(input.timeoutMs);
  const url = metadataUrl(endpoint, provider);
  if (!url) {
    return { status: "fail", provider, networkMode: mode, timeoutMs, requestAttempted: false, diagnostics: [{ code: "invalid_endpoint", severity: "error", message: "Provider endpoint is not a valid URL." }] };
  }
  const endpointDisplay = displayEndpoint(url);
  const blocked = allowedByMode(url, mode, stringList(input.allowedHosts));
  if (blocked) {
    return { status: blocked.code === "network_disabled" ? "skipped" : "blocked", provider, endpoint: endpointDisplay, networkMode: mode, timeoutMs, requestAttempted: false, diagnostics: [blocked] };
  }
  try {
    const response = await fetchJson(url, timeoutMs);
    const modelCount = countModels(response.body);
    const ok = response.statusCode >= 200 && response.statusCode < 300;
    return {
      status: ok ? "pass" : "warning",
      provider,
      endpoint: endpointDisplay,
      networkMode: mode,
      timeoutMs,
      requestAttempted: true,
      modelCount,
      diagnostics: [{ code: ok ? "metadata_probe_ok" : "metadata_probe_non_2xx", severity: ok ? "info" : "warning", message: `Provider metadata endpoint returned HTTP ${response.statusCode}.` }],
    };
  } catch (error) {
    return {
      status: "fail",
      provider,
      endpoint: endpointDisplay,
      networkMode: mode,
      timeoutMs,
      requestAttempted: true,
      diagnostics: [{ code: "metadata_probe_failed", severity: "error", message: error instanceof Error ? error.message : "Provider metadata probe failed." }],
    };
  }
}
