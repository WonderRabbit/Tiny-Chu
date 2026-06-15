import type { TinyToolHandler } from "./tiny-plugin-types.js";

export type TinyFeatureCategory =
  | "core-runtime"
  | "legacy-analysis"
  | "extension-utilities"
  | "workflow-hardening"
  | "workflow-orchestration"
  | "small-model-resilience"
  | "safe-tooling"
  | "ux-reverse-engineering"
  | "doctor-artifacts"
  | "support";

export type TinyOutputMode = "json" | "markdown" | "compact" | "mixed";

export interface TinyJsonSchema {
  readonly type?: string;
  readonly properties?: Readonly<Record<string, TinyJsonSchema>>;
  readonly items?: TinyJsonSchema;
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
  readonly description?: string;
  readonly default?: unknown;
}

export interface TinyPermissionHint {
  readonly readOnly: boolean;
  readonly writesState?: boolean;
  readonly writesArtifacts?: boolean;
  readonly writesSource?: boolean;
  readonly network?: "none" | "optional" | "required";
}

export interface TinySmallModelHint {
  readonly outputMode: TinyOutputMode;
  readonly deterministic: boolean;
  readonly maxInputChars?: number;
  readonly notes?: readonly string[];
}

export interface TinyCompatibilitySpec {
  readonly manifestVersion: 1;
  readonly packageVersion: string;
  readonly hostApiVersion: "opencode-plugin-v1";
  readonly dependsOn: readonly string[];
  readonly requiredTools: readonly string[];
  readonly optionalHooks: readonly string[];
  readonly requiredRuntime: {
    readonly windows10: boolean;
    readonly powershell: "5.1" | "7.6" | "5.1+";
    readonly opencode: boolean;
  };
}

export interface TinyToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly handler: TinyToolHandler;
  readonly inputSchema?: TinyJsonSchema;
  readonly permission?: TinyPermissionHint;
  readonly smallModel?: TinySmallModelHint;
  readonly requiredNativeTools?: readonly string[];
}

export interface TinyResourceDescriptor {
  readonly name: string;
  readonly description: string;
  readonly path?: string;
}

export interface TinyPromptDescriptor {
  readonly name: string;
  readonly description: string;
  readonly template: string;
}

export interface TinyInstructionDescriptor {
  readonly name: string;
  readonly description: string;
  readonly path?: string;
  readonly text?: string;
}

export interface TinyFeatureHooks {
  readonly beforeRun?: readonly string[];
  readonly afterRun?: readonly string[];
  readonly qa?: readonly string[];
}

export interface TinyFeaturePackage {
  readonly id: string;
  readonly version: 1;
  readonly title: string;
  readonly category: TinyFeatureCategory;
  readonly dependsOn?: readonly string[];
  readonly compatibility?: TinyCompatibilitySpec;
  readonly tools?: readonly TinyToolDescriptor[];
  readonly resources?: readonly TinyResourceDescriptor[];
  readonly prompts?: readonly TinyPromptDescriptor[];
  readonly instructions?: readonly TinyInstructionDescriptor[];
  readonly hooks?: TinyFeatureHooks;
}

export interface TinyComposedToolSpec {
  readonly name: string;
  readonly description: string;
  readonly packageId: string;
  readonly packageTitle: string;
  readonly permission?: TinyPermissionHint;
  readonly smallModel?: TinySmallModelHint;
  readonly inputSchema?: TinyJsonSchema;
  readonly requiredNativeTools: readonly string[];
}

export interface TinyFeaturePackageSummary {
  readonly id: string;
  readonly title: string;
  readonly category: TinyFeatureCategory;
  readonly dependsOn: readonly string[];
  readonly compatibility?: TinyCompatibilitySpec;
  readonly toolNames: readonly string[];
  readonly resourceNames: readonly string[];
  readonly promptNames: readonly string[];
  readonly instructionNames: readonly string[];
}

export interface TinyComposedRegistry {
  readonly packageIds: readonly string[];
  readonly packages: readonly TinyFeaturePackageSummary[];
  readonly tools: Record<string, TinyToolHandler>;
  readonly toolSpecs: readonly TinyComposedToolSpec[];
  readonly resources: readonly TinyResourceDescriptor[];
  readonly prompts: readonly TinyPromptDescriptor[];
  readonly instructions: readonly TinyInstructionDescriptor[];
  readonly requiredToolNames: readonly string[];
  readonly nativeToolNames: readonly string[];
}

export class FeaturePackageError extends Error {
  constructor(
    readonly code:
      | "invalid_package"
      | "duplicate_package_id"
      | "missing_dependency"
      | "dependency_cycle"
      | "duplicate_tool_name"
      | "invalid_tool",
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "FeaturePackageError";
  }
}
