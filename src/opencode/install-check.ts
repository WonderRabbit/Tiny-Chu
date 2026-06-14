import type { TinyFeaturePackageSummary } from "./feature-package.js";
import { createDefaultTinyFeaturePackages } from "./feature-packages/default-packages.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";

export interface TinyChuInstallCheckResult {
  readonly packageName: "tiny-chu";
  readonly requiredTools: readonly string[];
  readonly exposedPackages: readonly TinyFeaturePackageSummary[];
  readonly nativeTools: readonly string[];
  readonly opencodeEntrypoint: "./dist/opencode/plugin.js";
  readonly installDocs: "INSTALL.md";
  readonly opencodeShim: "templates/opencode/plugins/tiny-chu.ts";
  readonly offlineBundleName: "tiny-chu-offline-vX.Y.Z.tar.gz";
  readonly installModes: readonly ["offline-bundle", "internal-registry", "developer-file"];
  readonly status: "ready";
}

export function createTinyChuInstallCheck(
  toolNames: readonly string[] = defaultInstallToolNames(),
  exposedPackages: readonly TinyFeaturePackageSummary[] = [],
  nativeToolNames: readonly string[] = [],
): TinyChuInstallCheckResult {
  return {
    packageName: "tiny-chu",
    requiredTools: [...toolNames].sort(),
    exposedPackages,
    nativeTools: [...nativeToolNames].sort(),
    opencodeEntrypoint: "./dist/opencode/plugin.js",
    installDocs: "INSTALL.md",
    opencodeShim: "templates/opencode/plugins/tiny-chu.ts",
    offlineBundleName: "tiny-chu-offline-vX.Y.Z.tar.gz",
    installModes: ["offline-bundle", "internal-registry", "developer-file"],
    status: "ready",
  };
}

function defaultInstallToolNames(): readonly string[] {
  const noop: TinyToolHandler = async () => undefined;
  const handlers: Readonly<Record<string, TinyToolHandler>> = new Proxy({}, {
    get: () => noop,
  });
  const packages = createDefaultTinyFeaturePackages(handlers);
  return packages.flatMap((featurePackage) => (featurePackage.tools ?? []).map((tool) => tool.name));
}
