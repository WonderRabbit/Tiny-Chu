import { createHash } from "node:crypto";
import type { TinyComposedRegistry, TinyComposedToolSpec, TinyJsonSchema } from "../feature-package.js";
import type { OutputBudgetMetadata } from "../output-budget.js";
import { renderBudgetedOutput } from "../output-budget.js";
import type { TinyToolContext } from "../tiny-plugin-types.js";

const DEFAULT_INPUT_SCHEMA: TinyJsonSchema = { type: "object", properties: {} };

export interface TinyMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TinyJsonSchema;
  readonly schemaFingerprint: string;
  readonly metadata: {
    readonly packageId: string;
    readonly packageTitle: string;
    readonly permission: TinyComposedToolSpec["permission"];
    readonly smallModel: TinyComposedToolSpec["smallModel"];
    readonly requiredNativeTools: readonly string[];
    readonly schemaFingerprint: string;
  };
}

export interface TinyMcpToolCallRequest {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

interface TinyMcpToolMetadata extends OutputBudgetMetadata {
  readonly tool: string;
  readonly packageId?: string;
  readonly schemaFingerprint?: string;
}

export interface TinyMcpToolCallSuccess {
  readonly isError: false;
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly metadata: TinyMcpToolMetadata;
}

export interface TinyMcpToolCallFailure {
  readonly isError: true;
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly metadata: TinyMcpToolMetadata;
  readonly error: {
    readonly code: "unknown_tool" | "handler_error";
    readonly message: string;
  };
}

export type TinyMcpToolCallResult = TinyMcpToolCallSuccess | TinyMcpToolCallFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = stableValue(value[key]);
    return acc;
  }, {});
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function inputSchemaForSpec(spec: TinyComposedToolSpec): TinyJsonSchema {
  return spec.inputSchema ?? DEFAULT_INPUT_SCHEMA;
}

export function schemaFingerprintForToolSpec(spec: TinyComposedToolSpec): string {
  const payload = {
    inputSchema: inputSchemaForSpec(spec),
    name: spec.name,
    packageId: spec.packageId,
  };
  return `sha256:${createHash("sha256").update(stableJson(payload)).digest("hex")}`;
}

export function mcpDescriptorForToolSpec(spec: TinyComposedToolSpec): TinyMcpToolDescriptor {
  const schemaFingerprint = schemaFingerprintForToolSpec(spec);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: inputSchemaForSpec(spec),
    schemaFingerprint,
    metadata: {
      packageId: spec.packageId,
      packageTitle: spec.packageTitle,
      permission: spec.permission,
      smallModel: spec.smallModel,
      requiredNativeTools: spec.requiredNativeTools,
      schemaFingerprint,
    },
  };
}

export function listMcpToolsFromRegistry(registry: TinyComposedRegistry): readonly TinyMcpToolDescriptor[] {
  return registry.toolSpecs.map((spec) => mcpDescriptorForToolSpec(spec));
}

function unknownToolResult(toolName: string): TinyMcpToolCallFailure {
  const error = { code: "unknown_tool" as const, message: `Unknown Tiny-Chu tool: ${toolName}` };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(error) }],
    metadata: {
      tool: toolName,
      truncated: false,
      budget: {
        maxOutputChars: 0,
        maxArrayItems: 0,
        omittedItems: 0,
        fullSizeChars: error.message.length,
        outputSizeChars: error.message.length,
      },
    },
    error,
  };
}

export async function callMcpToolFromRegistry(
  registry: TinyComposedRegistry,
  request: TinyMcpToolCallRequest,
  context?: TinyToolContext,
): Promise<TinyMcpToolCallResult> {
  const spec = registry.toolSpecs.find((item) => item.name === request.name);
  if (!spec) return unknownToolResult(request.name);
  const handler = registry.tools[request.name];
  if (!handler) return unknownToolResult(request.name);
  try {
    const value = await handler(request.arguments, context);
    const budgetInput = spec.name === "tiny_chu_install_check" && request.arguments.maxOutputChars === undefined
      ? { ...request.arguments, maxOutputChars: 20_000, maxArrayItems: 200 }
      : request.arguments;
    const budgeted = renderBudgetedOutput(value, budgetInput);
    return {
      isError: false,
      content: [{ type: "text", text: budgeted.output }],
      metadata: {
        tool: spec.name,
        packageId: spec.packageId,
        schemaFingerprint: schemaFingerprintForToolSpec(spec),
        ...budgeted.metadata,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      code: "handler_error" as const,
      message,
    };
    const budgeted = renderBudgetedOutput(payload, request.arguments);
    return {
      isError: true,
      content: [{ type: "text", text: budgeted.output }],
      metadata: {
        tool: spec.name,
        packageId: spec.packageId,
        schemaFingerprint: schemaFingerprintForToolSpec(spec),
        ...budgeted.metadata,
      },
      error: payload,
    };
  }
}
