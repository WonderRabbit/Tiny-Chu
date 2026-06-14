import { FeaturePackageError, type TinyFeaturePackage, type TinyToolDescriptor } from "../feature-package.js";
import type { TinyToolHandler } from "../tiny-plugin-types.js";
import { DEFAULT_PACKAGE_SEEDS, SAFE_TOOLING_PACKAGE_SEEDS } from "./default-package-seeds.js";
import { hookNames, type PackageSeed, type ToolSeed } from "./tool-seed.js";

export interface DefaultFeaturePackageOptions {
  readonly safeTooling?: boolean;
  readonly nativePreviews?: boolean;
}

export function createDefaultTinyFeaturePackages(handlers: Readonly<Record<string, TinyToolHandler>>, options: DefaultFeaturePackageOptions = {}): readonly TinyFeaturePackage[] {
  const seeds = options.safeTooling === true
    ? [...DEFAULT_PACKAGE_SEEDS, ...SAFE_TOOLING_PACKAGE_SEEDS.filter((seed) => seed.id !== "tiny-chu.native-previews" || options.nativePreviews === true)]
    : DEFAULT_PACKAGE_SEEDS;
  return seeds.map((seed) => ({
    id: seed.id,
    version: 1,
    title: seed.title,
    category: seed.category,
    dependsOn: seed.dependsOn ?? [],
    compatibility: {
      manifestVersion: 1,
      packageVersion: "0.1.0",
      hostApiVersion: "opencode-plugin-v1",
      dependsOn: seed.dependsOn ?? [],
      requiredTools: seed.tools.map((tool) => tool.name),
      optionalHooks: hookNames(seed.hooks),
      requiredRuntime: {
        windows10: true,
        powershell: "7.6",
        opencode: true,
      },
    },
    tools: seed.tools.map((tool) => bindToolHandler(seed, tool, handlers)),
    resources: seed.resources ?? [],
    prompts: [],
    instructions: seed.instructions ?? [],
    hooks: seed.hooks,
  }));
}

function bindToolHandler(seed: PackageSeed, tool: ToolSeed, handlers: Readonly<Record<string, TinyToolHandler>>): TinyToolDescriptor {
  const handler = handlers[tool.name];
  if (!handler) {
    throw new FeaturePackageError("invalid_tool", `Feature package ${seed.id} references missing handler ${tool.name}`, {
      packageId: seed.id,
      toolName: tool.name,
    });
  }
  return { ...tool, handler };
}
