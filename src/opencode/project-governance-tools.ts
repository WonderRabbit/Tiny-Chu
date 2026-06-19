import { checkDocsConsistency } from "../project/docs-consistency.js";
import { writeProjectSnapshot } from "../project/snapshot.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import type { TinyComposedRegistry } from "./feature-package.js";
import type { DefaultFeaturePackageSelection } from "./feature-packages/default-packages.js";
import { createTinyChuInstallCheck } from "./install-check.js";
import { writeRulesSnapshot } from "./rules-snapshot.js";
import type { TinyChuRuntimeMode } from "./runtime-mode.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";

export type ProjectGovernanceToolName = "tiny_chu_install_check" | "rules_snapshot" | "project_snapshot" | "docs_consistency_check";
export type ProjectGovernanceToolHandlers = Readonly<Record<ProjectGovernanceToolName, TinyToolHandler>>;

export interface ProjectGovernanceToolOptions {
  readonly root?: string;
  readonly runtimeMode: TinyChuRuntimeMode;
  readonly registry: () => TinyComposedRegistry;
  readonly packageSelection: () => DefaultFeaturePackageSelection;
}

export function createProjectGovernanceTools(options: ProjectGovernanceToolOptions): ProjectGovernanceToolHandlers {
  return {
    tiny_chu_install_check: async () => {
      const registry = options.registry();
      const packageSelection = options.packageSelection();
      return createTinyChuInstallCheck({
        toolNames: registry.requiredToolNames,
        exposedPackages: registry.packages,
        nativeToolNames: registry.nativeToolNames,
        runtimeModeInput: options.runtimeMode,
        disabledPackages: packageSelection.disabledPackages,
        excludedPackages: packageSelection.excludedPackages,
        diagnostics: packageSelection.diagnostics,
        toolSpecs: registry.toolSpecs,
      });
    },
    project_snapshot: async (input) => writeProjectSnapshot({
      root: options.root,
      registry: options.registry(),
      runtimeMode: options.runtimeMode,
      generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : undefined,
    }),
    rules_snapshot: async (input) => writeRulesSnapshot(options.root, input),
    docs_consistency_check: async (input) => {
      const registry = options.registry();
      return checkDocsConsistency({
        root: resolveTinyChuPaths(options.root).root,
        registryToolNames: Object.keys(registry.tools).sort(),
        paths: Array.isArray(input.paths) ? input.paths.map(String) : undefined,
      });
    },
  };
}
