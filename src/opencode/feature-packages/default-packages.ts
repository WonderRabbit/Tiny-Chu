import { FeaturePackageError, type TinyFeaturePackage, type TinyToolDescriptor } from "../feature-package.js";
import { isWorkerRuntimeMode, normalizeTinyChuRuntimeMode, type TinyChuRuntimeMode, type TinyChuRuntimeModeInput } from "../runtime-mode.js";
import type { TinyToolHandler } from "../tiny-plugin-types.js";
import { DEFAULT_PACKAGE_SEEDS, SAFE_TOOLING_PACKAGE_SEEDS } from "./default-package-seeds.js";
import { hookNames, type PackageSeed, type ToolSeed } from "./tool-seed.js";

export interface DefaultFeaturePackageOptions {
  readonly mode?: TinyChuRuntimeModeInput;
  readonly safeTooling?: boolean;
  readonly nativePreviews?: boolean;
  readonly disabledPackages?: readonly string[];
}

export type TinyPackageExclusionReason = "mode" | "disabled";

export interface TinyPackageExclusion {
  readonly id: string;
  readonly title: string;
  readonly category: PackageSeed["category"];
  readonly dependsOn: readonly string[];
  readonly reason: TinyPackageExclusionReason;
}

export interface TinyPackageSelectionDiagnostic {
  readonly severity: "info";
  readonly code: "mode_excluded_package" | "package_disabled";
  readonly packageId: string;
  readonly message: string;
}

export interface DefaultFeaturePackageSelection {
  readonly packages: readonly TinyFeaturePackage[];
  readonly disabledPackages: readonly string[];
  readonly excludedPackages: readonly TinyPackageExclusion[];
  readonly diagnostics: readonly TinyPackageSelectionDiagnostic[];
}

const WORKER_MODE_EXCLUDED_PACKAGE_IDS = new Set([
  "tiny-chu.public-worker-queue",
  "tiny-chu.button-workflow-dispatch",
  "tiny-chu.workflow-orchestration",
]);
const HOST_PACKAGE_ID = "tiny-chu.host-opencode";
const REQUIRED_PACKAGE_IDS = new Set(["tiny-chu.core-runtime", "tiny-chu.shared-support", HOST_PACKAGE_ID]);

export function createDefaultTinyFeaturePackages(handlers: Readonly<Record<string, TinyToolHandler>>, options: DefaultFeaturePackageOptions = {}): readonly TinyFeaturePackage[] {
  return createDefaultTinyFeaturePackageSelection(handlers, options).packages;
}

export function createDefaultTinyFeaturePackageSelection(handlers: Readonly<Record<string, TinyToolHandler>>, options: DefaultFeaturePackageOptions = {}): DefaultFeaturePackageSelection {
  const runtimeMode = normalizeTinyChuRuntimeMode(options.mode);
  const disabledPackages = normalizeDisabledPackageIds(options.disabledPackages ?? []);
  const seeds = selectablePackageSeeds(options);
  const modeExcludedIds = isWorkerRuntimeMode(runtimeMode) ? WORKER_MODE_EXCLUDED_PACKAGE_IDS : new Set<string>();
  validateDisabledPackageIds(disabledPackages, allKnownPackageIds());
  validateRequiredPackagesEnabled(disabledPackages);
  const adjustedSeeds = seeds.flatMap((seed) => modeExcludedIds.has(seed.id) ? [] : [adjustHostDependencies(seed, modeExcludedIds, new Set(disabledPackages))]);
  const activeSeeds = adjustedSeeds.filter((seed) => !disabledPackages.includes(seed.id));
  validateDependencyClosure(activeSeeds);

  return {
    packages: activeSeeds.map((seed) => bindPackageSeed(seed, handlers, runtimeMode)),
    disabledPackages,
    excludedPackages: excludedPackageSummaries(seeds, modeExcludedIds, new Set(disabledPackages)),
    diagnostics: packageSelectionDiagnostics(seeds, modeExcludedIds, new Set(disabledPackages)),
  };
}

function bindPackageSeed(seed: PackageSeed, handlers: Readonly<Record<string, TinyToolHandler>>, runtimeMode: TinyChuRuntimeMode): TinyFeaturePackage {
  return {
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
  };
}

function selectablePackageSeeds(options: DefaultFeaturePackageOptions): readonly PackageSeed[] {
  if (options.safeTooling !== true) return DEFAULT_PACKAGE_SEEDS;
  return [
    ...DEFAULT_PACKAGE_SEEDS,
    ...SAFE_TOOLING_PACKAGE_SEEDS.filter((seed) => seed.id !== "tiny-chu.native-previews" || options.nativePreviews === true),
  ];
}

function allKnownPackageIds(): ReadonlySet<string> {
  return new Set([...DEFAULT_PACKAGE_SEEDS, ...SAFE_TOOLING_PACKAGE_SEEDS].map((seed) => seed.id));
}

function normalizeDisabledPackageIds(disabledPackages: readonly string[]): readonly string[] {
  const normalized = disabledPackages.map((id) => id.trim()).sort();
  for (const id of normalized) {
    if (normalized.filter((candidate) => candidate === id).length > 1) {
      throw new FeaturePackageError("duplicate_disabled_package", `Duplicate disabled package id: ${id}`, { id });
    }
  }
  return normalized;
}

function validateDisabledPackageIds(disabledPackages: readonly string[], knownPackageIds: ReadonlySet<string>): void {
  for (const id of disabledPackages) {
    if (!knownPackageIds.has(id)) {
      throw new FeaturePackageError("unknown_package", `Cannot disable unknown package ${id}.`, { id });
    }
  }
}

function validateRequiredPackagesEnabled(disabledPackages: readonly string[]): void {
  for (const id of disabledPackages) {
    if (REQUIRED_PACKAGE_IDS.has(id)) {
      throw new FeaturePackageError("required_package_disabled", `Required package ${id} cannot be disabled.`, { id });
    }
  }
}

function validateDependencyClosure(seeds: readonly PackageSeed[]): void {
  const activeIds = new Set(seeds.map((seed) => seed.id));
  for (const seed of seeds) {
    for (const dependency of seed.dependsOn ?? []) {
      if (!activeIds.has(dependency)) {
        throw new FeaturePackageError("dependency_disabled", `Package ${seed.id} requires disabled package ${dependency}.`, {
          id: seed.id,
          dependency,
        });
      }
    }
  }
}

function adjustHostDependencies(seed: PackageSeed, modeExcludedIds: ReadonlySet<string>, disabledPackageIds: ReadonlySet<string>): PackageSeed {
  if (seed.id !== HOST_PACKAGE_ID) return seed;
  return {
    ...seed,
    dependsOn: (seed.dependsOn ?? []).filter((packageId) => !modeExcludedIds.has(packageId) && !disabledPackageIds.has(packageId)),
  };
}

function excludedPackageSummaries(seeds: readonly PackageSeed[], modeExcludedIds: ReadonlySet<string>, disabledPackageIds: ReadonlySet<string>): readonly TinyPackageExclusion[] {
  return seeds.flatMap((seed) => {
    const reason = packageExclusionReason(seed.id, modeExcludedIds, disabledPackageIds);
    if (!reason) return [];
    return [{
      id: seed.id,
      title: seed.title,
      category: seed.category,
      dependsOn: seed.dependsOn ?? [],
      reason,
    }];
  });
}

function packageSelectionDiagnostics(seeds: readonly PackageSeed[], modeExcludedIds: ReadonlySet<string>, disabledPackageIds: ReadonlySet<string>): readonly TinyPackageSelectionDiagnostic[] {
  const diagnostics: TinyPackageSelectionDiagnostic[] = [];
  for (const seed of seeds) {
    const reason = packageExclusionReason(seed.id, modeExcludedIds, disabledPackageIds);
    if (reason === "mode") {
      diagnostics.push({
        severity: "info",
        code: "mode_excluded_package",
        packageId: seed.id,
        message: `Package ${seed.id} is excluded by worker runtime mode.`,
      });
    }
    if (reason === "disabled") {
      diagnostics.push({
        severity: "info",
        code: "package_disabled",
        packageId: seed.id,
        message: `Package ${seed.id} is disabled by runtime config.`,
      });
    }
  }
  return diagnostics;
}

function packageExclusionReason(id: string, modeExcludedIds: ReadonlySet<string>, disabledPackageIds: ReadonlySet<string>): TinyPackageExclusionReason | undefined {
  if (disabledPackageIds.has(id)) return "disabled";
  if (modeExcludedIds.has(id)) return "mode";
  return undefined;
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
