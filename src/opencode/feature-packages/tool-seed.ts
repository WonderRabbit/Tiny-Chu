import type { TinyFeatureCategory, TinyFeatureHooks, TinyInstructionDescriptor, TinyPermissionHint, TinyResourceDescriptor, TinySmallModelHint, TinyToolDescriptor } from "../feature-package.js";

export type ToolSeed = Omit<TinyToolDescriptor, "handler">;

export interface PackageSeed {
  readonly id: string;
  readonly title: string;
  readonly category: TinyFeatureCategory;
  readonly dependsOn?: readonly string[];
  readonly tools: readonly ToolSeed[];
  readonly resources?: readonly TinyResourceDescriptor[];
  readonly instructions?: readonly TinyInstructionDescriptor[];
  readonly hooks?: TinyFeatureHooks;
}

const READ_ONLY: TinyPermissionHint = { readOnly: true, network: "none" };
const STATE_WRITE: TinyPermissionHint = { readOnly: false, writesState: true, network: "none" };
const ARTIFACT_WRITE: TinyPermissionHint = { readOnly: false, writesArtifacts: true, network: "none" };
const SOURCE_WRITE: TinyPermissionHint = { readOnly: false, writesSource: true, network: "none" };
const JSON_HINT: TinySmallModelHint = { outputMode: "json", deterministic: true };
const MARKDOWN_HINT: TinySmallModelHint = { outputMode: "markdown", deterministic: true };

export function readJson(name: string, description: string, requiredNativeTools: readonly string[] = []): ToolSeed {
  return { name, description, permission: READ_ONLY, smallModel: JSON_HINT, requiredNativeTools };
}

export function writeState(name: string, description: string): ToolSeed {
  return { name, description, permission: STATE_WRITE, smallModel: JSON_HINT };
}

export function writeMarkdown(name: string, description: string): ToolSeed {
  return { name, description, permission: ARTIFACT_WRITE, smallModel: MARKDOWN_HINT };
}

export function writeSource(name: string, description: string): ToolSeed {
  return { name, description, permission: SOURCE_WRITE, smallModel: JSON_HINT };
}

export function markdown(name: string, description: string): ToolSeed {
  return { name, description, permission: READ_ONLY, smallModel: MARKDOWN_HINT };
}

export function resource(name: string, description: string, path: string): TinyResourceDescriptor {
  return { name, description, path };
}

export function instruction(name: string, description: string): TinyInstructionDescriptor {
  return { name, description, text: description };
}

export function hookNames(hooks: TinyFeatureHooks | undefined): readonly string[] {
  return [...(hooks?.beforeRun ?? []), ...(hooks?.afterRun ?? []), ...(hooks?.qa ?? [])].sort();
}
