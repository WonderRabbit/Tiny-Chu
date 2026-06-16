import { FeaturePackageError, type TinyFeaturePackage, type TinyToolDescriptor } from "../feature-package.js";
import { isWorkerRuntimeMode, normalizeTinyChuRuntimeMode, type TinyChuRuntimeMode, type TinyChuRuntimeModeInput } from "../runtime-mode.js";
import type { TinyToolHandler } from "../tiny-plugin-types.js";
import { DEFAULT_PACKAGE_SEEDS, SAFE_TOOLING_PACKAGE_SEEDS } from "./default-package-seeds.js";
import { hookNames, type PackageSeed, type ToolSeed } from "./tool-seed.js";

export interface DefaultFeaturePackageOptions {
  readonly mode?: TinyChuRuntimeModeInput;
  readonly safeTooling?: boolean;
  readonly nativePreviews?: boolean;
}

const WORKER_MODE_EXCLUDED_PACKAGE_IDS = new Set([
  "tiny-chu.public-worker-queue",
  "tiny-chu.button-workflow-dispatch",
  "tiny-chu.workflow-orchestration",
]);

export function createDefaultTinyFeaturePackages(handlers: Readonly<Record<string, TinyToolHandler>>, options: DefaultFeaturePackageOptions = {}): readonly TinyFeaturePackage[] {
  const runtimeMode = normalizeTinyChuRuntimeMode(options.mode);
  const defaultSeeds = defaultPackageSeedsForMode(runtimeMode);
  const seeds = options.safeTooling === true
    ? [...defaultSeeds, ...SAFE_TOOLING_PACKAGE_SEEDS.filter((seed) => seed.id !== "tiny-chu.native-previews" || options.nativePreviews === true)]
    : defaultSeeds;
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
    tools: seed.tools.map((tool) => bindToolHandler(seed, tool, handlers, runtimeMode)),
    resources: seed.resources ?? [],
    prompts: [],
    instructions: seed.instructions ?? [],
    hooks: seed.hooks,
  }));
}

function defaultPackageSeedsForMode(runtimeMode: ReturnType<typeof normalizeTinyChuRuntimeMode>): readonly PackageSeed[] {
  if (!isWorkerRuntimeMode(runtimeMode)) return DEFAULT_PACKAGE_SEEDS;
  return DEFAULT_PACKAGE_SEEDS.flatMap((seed) => {
    if (WORKER_MODE_EXCLUDED_PACKAGE_IDS.has(seed.id)) return [];
    if (seed.id !== "tiny-chu.host-opencode") return [seed];
    return [{
      ...seed,
      dependsOn: (seed.dependsOn ?? []).filter((packageId) => !WORKER_MODE_EXCLUDED_PACKAGE_IDS.has(packageId)),
    }];
  });
}

function workerSafeDescription(description: string, runtimeMode: TinyChuRuntimeMode): string {
  if (!isWorkerRuntimeMode(runtimeMode)) return description;
  return description
    .replace(/\bpublic-worker\b/gi, "worker")
    .replace(/\bpublic worker\b/gi, "worker")
    .replace(/\bpublic rate-limit\b/gi, "packet retry")
    .replace(/\bpublic queue\b/gi, "queue")
    .replace(/\bpublic\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bindToolHandler(seed: PackageSeed, tool: ToolSeed, handlers: Readonly<Record<string, TinyToolHandler>>, runtimeMode: TinyChuRuntimeMode): TinyToolDescriptor {
  const handler = handlers[tool.name];
  if (!handler) {
    throw new FeaturePackageError("invalid_tool", `Feature package ${seed.id} references missing handler ${tool.name}`, {
      packageId: seed.id,
      toolName: tool.name,
    });
  }
  return { ...tool, description: workerSafeDescription(tool.description, runtimeMode), handler };
}
