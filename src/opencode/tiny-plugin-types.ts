import type { PowerShellToolingProfile } from "./powershell-tooling.js";
import type { TinyComposedRegistry } from "./feature-package.js";

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
  opencode: OpenCodeRuntimeConfig;
  registry: TinyComposedRegistry;
  tools: Record<string, TinyToolHandler>;
  hooks: {
    transformUserMessage(message: string, context?: TinyToolContext): Promise<string>;
    onSessionIdle(input: { planRef?: string }): Promise<{ shouldContinue: boolean; reason: string }>;
  };
}
