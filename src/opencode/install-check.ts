import type { TinyComposedToolSpec, TinyFeaturePackageSummary } from "./feature-package.js";
import { createDefaultTinyFeaturePackages, type TinyPackageExclusion, type TinyPackageSelectionDiagnostic } from "./feature-packages/default-packages.js";
import { schemaFingerprintForToolSpec } from "./mcp/registry-adapter.js";
import { normalizeTinyChuRuntimeMode, type TinyChuRuntimeMode, type TinyChuRuntimeModeInput } from "./runtime-mode.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";

export interface TinyChuInstallCheckInput {
  readonly toolNames?: readonly string[];
  readonly exposedPackages?: readonly TinyFeaturePackageSummary[];
  readonly nativeToolNames?: readonly string[];
  readonly runtimeModeInput?: TinyChuRuntimeModeInput;
  readonly disabledPackages?: readonly string[];
  readonly excludedPackages?: readonly TinyPackageExclusion[];
  readonly diagnostics?: readonly TinyPackageSelectionDiagnostic[];
  readonly toolSpecs?: readonly TinyComposedToolSpec[];
}

export interface TinyChuInstallCheckResult {
  readonly packageName: "tiny-chu";
  readonly runtimeMode: TinyChuRuntimeMode;
  readonly disabledPackages: readonly string[];
  readonly requiredTools: readonly string[];
  readonly activePackages: readonly TinyFeaturePackageSummary[];
  readonly exposedPackages: readonly TinyFeaturePackageSummary[];
  readonly excludedPackages: readonly TinyPackageExclusion[];
  readonly diagnostics: readonly TinyPackageSelectionDiagnostic[];
  readonly nativeTools: readonly string[];
  readonly opencodeEntrypoint: "./dist/opencode/plugin.js";
  readonly opencodeTuiEntrypoint: "./dist/opencode/tui-plugin.js";
  readonly mcpEntrypoint: "./dist/opencode/mcp/stdio-entrypoint.js";
  readonly mcpHostPackageId: "tiny-chu.host-mcp";
  readonly mcpToolCount: number;
  readonly mcpSchemaFingerprints: readonly string[];
  readonly installDocs: "INSTALL.md";
  readonly opencodeShim: "templates/opencode/plugins/tiny-chu.ts";
  readonly opencodeTuiConfig: "templates/opencode/tui.json";
  readonly opencodeTuiShim: "templates/opencode/plugins/tiny-chu-tui.ts";
  readonly offlineBundleName: "tiny-chu-offline-vX.Y.Z.tar.gz";
  readonly installModes: readonly ["offline-bundle", "internal-registry", "developer-file"];
  readonly status: "ready";
}

export function createTinyChuInstallCheck(input?: TinyChuInstallCheckInput): TinyChuInstallCheckResult;
export function createTinyChuInstallCheck(
  toolNames?: readonly string[],
  exposedPackages?: readonly TinyFeaturePackageSummary[],
  nativeToolNames?: readonly string[],
  runtimeModeInput?: TinyChuRuntimeModeInput,
): TinyChuInstallCheckResult;
export function createTinyChuInstallCheck(
  inputOrToolNames: TinyChuInstallCheckInput | readonly string[] = {},
  exposedPackages: readonly TinyFeaturePackageSummary[] = [],
  nativeToolNames: readonly string[] = [],
  runtimeModeInput?: TinyChuRuntimeModeInput,
): TinyChuInstallCheckResult {
  const input: TinyChuInstallCheckInput = isStringList(inputOrToolNames)
    ? { toolNames: inputOrToolNames, exposedPackages, nativeToolNames, runtimeModeInput }
    : inputOrToolNames;
  const runtimeMode = normalizeTinyChuRuntimeMode(input.runtimeModeInput);
  const activePackages = input.exposedPackages ?? [];
  const requiredTools = [...(input.toolNames ?? defaultInstallToolNames(runtimeMode))].sort();
  const toolSpecs = input.toolSpecs ?? [];
  return {
    packageName: "tiny-chu",
    runtimeMode,
    disabledPackages: [...(input.disabledPackages ?? [])].sort(),
    requiredTools,
    activePackages,
    exposedPackages: activePackages,
    excludedPackages: input.excludedPackages ?? [],
    diagnostics: input.diagnostics ?? [],
    nativeTools: [...(input.nativeToolNames ?? [])].sort(),
    opencodeEntrypoint: "./dist/opencode/plugin.js",
    opencodeTuiEntrypoint: "./dist/opencode/tui-plugin.js",
    mcpEntrypoint: "./dist/opencode/mcp/stdio-entrypoint.js",
    mcpHostPackageId: "tiny-chu.host-mcp",
    mcpToolCount: toolSpecs.length > 0 ? toolSpecs.length : requiredTools.length,
    mcpSchemaFingerprints: toolSpecs.map((spec) => schemaFingerprintForToolSpec(spec)),
    installDocs: "INSTALL.md",
    opencodeShim: "templates/opencode/plugins/tiny-chu.ts",
    opencodeTuiConfig: "templates/opencode/tui.json",
    opencodeTuiShim: "templates/opencode/plugins/tiny-chu-tui.ts",
    offlineBundleName: "tiny-chu-offline-vX.Y.Z.tar.gz",
    installModes: ["offline-bundle", "internal-registry", "developer-file"],
    status: "ready",
  };
}

function isStringList(value: TinyChuInstallCheckInput | readonly string[]): value is readonly string[] {
  return Array.isArray(value);
}

function defaultInstallToolNames(runtimeMode: TinyChuRuntimeMode): readonly string[] {
  const noop: TinyToolHandler = async () => undefined;
  const handlers: Readonly<Record<string, TinyToolHandler>> = new Proxy({}, {
    get: () => noop,
  });
  const packages = createDefaultTinyFeaturePackages(handlers, { mode: runtimeMode });
  return packages.flatMap((featurePackage) => (featurePackage.tools ?? []).map((tool) => tool.name));
}
