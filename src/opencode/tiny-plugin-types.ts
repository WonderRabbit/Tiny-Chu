import type { PowerShellToolingProfile } from "./powershell-tooling.js";
import type { TinyComposedRegistry } from "./feature-package.js";

export type TinyChuRuntimeMode = "worker" | "orchestrator_worker";
export type TinyChuRuntimeModeInput =
  | TinyChuRuntimeMode
  | 1
  | 2
  | "1"
  | "2"
  | "mode1"
  | "mode2"
  | "worker_only";

export interface OpenCodeShellRuntime {
  name: "powershell";
  executable: "pwsh";
  version: "7.6.2";
  args: readonly ["-NoLogo", "-NoProfile"];
}

export interface OpenCodeRuntimeConfig {
  shell: OpenCodeShellRuntime;
  tooling: PowerShellToolingProfile;
}

export interface TinyChuConfig {
  root?: string;
  mode?: TinyChuRuntimeModeInput;
  safeTooling?: boolean;
  nativePreviews?: boolean;
  disabledPackages?: readonly string[];
  publicDispatcher?: {
    softRpm?: number;
    softTpm?: number;
    hardRpm?: number;
    hardTpm?: number;
    owner?: string;
  };
}

export interface TinyToolContext {
  sessionId?: string;
  targetPath?: string;
}

export type TinyToolHandler = (input: Record<string, unknown>, context?: TinyToolContext) => Promise<unknown>;

export interface TinyPluginModule {
  name: "tiny-chu";
  runtimeMode: TinyChuRuntimeMode;
  opencode: OpenCodeRuntimeConfig;
  registry: TinyComposedRegistry;
  tools: Record<string, TinyToolHandler>;
  hooks: {
    transformUserMessage(message: string, context?: TinyToolContext): Promise<string>;
    onSessionIdle(input: { planRef?: string }): Promise<{ shouldContinue: boolean; reason: string }>;
  };
}
