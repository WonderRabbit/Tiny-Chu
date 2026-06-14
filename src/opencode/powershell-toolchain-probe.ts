import { runNativeCommand, type NativeRunner } from "./native-runner.js";

export type ToolchainProbeStatus = "ready" | "degraded" | "unavailable";

export interface ToolchainProbeCheck {
  readonly name: string;
  readonly status: ToolchainProbeStatus;
  readonly detail: string;
}

export interface PowerShellToolchainProbeResult {
  readonly status: ToolchainProbeStatus;
  readonly checks: readonly ToolchainProbeCheck[];
  readonly remediation: readonly string[];
}

export interface PowerShellToolchainProbeInput {
  readonly runner?: NativeRunner;
}

const ENCODED_COMMAND = "VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAnAGUAbgBjAG8AZABlAGQAJwA=";

function probeStatus(checks: readonly ToolchainProbeCheck[]): ToolchainProbeStatus {
  if (checks.some((check) => check.status === "unavailable")) return "unavailable";
  return checks.every((check) => check.status === "ready") ? "ready" : "degraded";
}

function remediation(status: ToolchainProbeStatus): readonly string[] {
  if (status === "ready") return [];
  return [
    "Install PowerShell 7 as `pwsh` and run OpenCode with -NoLogo -NoProfile.",
    "Use Standard native argument passing for predictable jq/yq/ast-grep execution.",
  ];
}

export async function createPowerShellToolchainProbe(input: PowerShellToolchainProbeInput = {}): Promise<PowerShellToolchainProbeResult> {
  const runner = input.runner ?? runNativeCommand;
  const checks: ToolchainProbeCheck[] = [];
  const version = await runner("pwsh", ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]);
  if (version.status === "missing") {
    checks.push({ name: "discovery", status: "unavailable", detail: "pwsh executable was not found." });
    return { status: "unavailable", checks, remediation: remediation("unavailable") };
  }
  checks.push({ name: "discovery", status: version.exitCode === 0 ? "ready" : "degraded", detail: version.stdout.trim() || version.stderr.trim() });

  const cwd = await runner("pwsh", ["-NoLogo", "-NoProfile", "-Command", "(Get-Location).Path"]);
  checks.push({ name: "cwd", status: cwd.exitCode === 0 && cwd.stdout.trim() !== "" ? "ready" : "degraded", detail: cwd.stdout.trim() || cwd.stderr.trim() });

  const utf8 = await runner("pwsh", ["-NoLogo", "-NoProfile", "-Command", "[Console]::OutputEncoding.WebName"]);
  checks.push({ name: "utf8", status: /utf-?8/i.test(utf8.stdout) ? "ready" : "degraded", detail: utf8.stdout.trim() || utf8.stderr.trim() });

  const json = await runner("pwsh", ["-NoLogo", "-NoProfile", "-Command", "@{ok=$true; value='한글'} | ConvertTo-Json -Compress"]);
  let jsonReady = false;
  try {
    const parsed: unknown = JSON.parse(json.stdout);
    jsonReady = typeof parsed === "object" && parsed !== null && "ok" in parsed && "value" in parsed;
  } catch (error) {
    jsonReady = false;
  }
  checks.push({ name: "json-roundtrip", status: jsonReady ? "ready" : "degraded", detail: json.stdout.trim() || json.stderr.trim() });

  const nonzero = await runner("pwsh", ["-NoLogo", "-NoProfile", "-Command", "Write-Error 'expected'; exit 7"]);
  checks.push({ name: "nonzero-exit", status: nonzero.exitCode === 7 ? "ready" : "degraded", detail: nonzero.stderr.trim() || String(nonzero.exitCode) });

  const encoded = await runner("pwsh", ["-NoLogo", "-NoProfile", "-EncodedCommand", ENCODED_COMMAND]);
  checks.push({ name: "encoded-command", status: encoded.exitCode === 0 && /encoded/.test(encoded.stdout) ? "ready" : "degraded", detail: encoded.stdout.trim() || encoded.stderr.trim() });

  const status = probeStatus(checks);
  return { status, checks, remediation: remediation(status) };
}
