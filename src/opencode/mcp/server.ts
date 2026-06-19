import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { TinyComposedRegistry } from "../feature-package.js";
import type { TinyToolContext } from "../tiny-plugin-types.js";
import { callMcpToolFromRegistry, listMcpToolsFromRegistry, mcpDescriptorForToolSpec, schemaFingerprintForToolSpec, type TinyMcpToolCallRequest } from "./registry-adapter.js";

export { callMcpToolFromRegistry, listMcpToolsFromRegistry, mcpDescriptorForToolSpec, schemaFingerprintForToolSpec };
export type { TinyMcpToolCallFailure, TinyMcpToolCallRequest, TinyMcpToolCallResult, TinyMcpToolCallSuccess, TinyMcpToolDescriptor } from "./registry-adapter.js";

type JsonRpcId = string | number | null;

export interface TinyMcpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface TinyMcpJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: {
    readonly code: -32700 | -32600 | -32601 | -32602 | -32603;
    readonly message: string;
  };
}

type TinyMcpJsonRpcErrorCode = NonNullable<TinyMcpJsonRpcResponse["error"]>["code"];

export interface TinyMcpStdioLoopOptions {
  readonly registry: TinyComposedRegistry;
  readonly input: Readable;
  readonly output: Writable;
  readonly context?: TinyToolContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpcError(id: JsonRpcId, code: TinyMcpJsonRpcErrorCode, message: string): TinyMcpJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function requestId(value: unknown): JsonRpcId {
  if (!isRecord(value)) return null;
  const id = value.id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

function parseToolCallParams(params: unknown): TinyMcpToolCallRequest | undefined {
  if (!isRecord(params) || typeof params.name !== "string") return undefined;
  if (params.arguments === undefined) return { name: params.name, arguments: {} };
  if (!isRecord(params.arguments)) return undefined;
  return { name: params.name, arguments: params.arguments };
}

export async function dispatchMcpJsonRpc(
  registry: TinyComposedRegistry,
  request: unknown,
  context?: TinyToolContext,
): Promise<TinyMcpJsonRpcResponse> {
  if (!isRecord(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(requestId(request), -32600, "Invalid JSON-RPC request.");
  }
  const id = requestId(request);
  if (request.method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: listMcpToolsFromRegistry(registry) } };
  }
  if (request.method === "tools/call") {
    const parsed = parseToolCallParams(request.params);
    if (!parsed) return jsonRpcError(id, -32602, "tools/call params must include a tool name and object arguments.");
    return { jsonrpc: "2.0", id, result: await callMcpToolFromRegistry(registry, parsed, context) };
  }
  return jsonRpcError(id, -32601, `Unsupported MCP method: ${request.method}`);
}

export async function dispatchMcpJsonRpcLine(
  registry: TinyComposedRegistry,
  line: string,
  context?: TinyToolContext,
): Promise<string> {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return `${JSON.stringify(jsonRpcError(null, -32700, "Malformed JSON-RPC message."))}\n`;
  }
  return `${JSON.stringify(await dispatchMcpJsonRpc(registry, request, context))}\n`;
}

export async function startMcpStdioLoop(options: TinyMcpStdioLoopOptions): Promise<void> {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim() === "") continue;
      options.output.write(await dispatchMcpJsonRpcLine(options.registry, line, options.context));
    }
  } finally {
    options.output.end();
  }
}
