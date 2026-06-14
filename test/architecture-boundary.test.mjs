import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

const SRC_ROOT = path.resolve("src");
const CORE_PREFIXES = ["src/context/", "src/dispatcher/", "src/state/", "src/ulw-loop/", "src/wiki/"];
const HOST_FILES = new Set(["src/index.ts", "src/opencode/plugin.ts", "src/opencode/tiny-plugin.ts", "src/opencode/install-check.ts"]);
const SHARED_FILES = new Set([
  "src/markdown/mermaid.ts",
  "src/opencode/artifact-contract.ts",
  "src/opencode/feature-package.ts",
  "src/opencode/feature-package-order.ts",
  "src/opencode/feature-package-types.ts",
  "src/opencode/legacy-input.ts",
  "src/opencode/legacy-scanner.ts",
  "src/opencode/legacy-types.ts",
  "src/opencode/output-budget.ts",
  "src/opencode/powershell-tooling.ts",
  "src/opencode/tiny-plugin-types.ts",
  "src/opencode/tiny-tool-inputs.ts",
]);

test("import boundary guard detects invalid synthetic edges", () => {
  const violations = boundaryViolations([
    { source: "src/state/paths.ts", target: "src/opencode/tool-plan.ts" },
    { source: "src/opencode/legacy-input.ts", target: "src/opencode/tool-plan.ts" },
    { source: "src/opencode/tool-plan.ts", target: "src/opencode/plugin.ts" },
  ]);

  assert.deepEqual(violations.map((violation) => violation.code), ["core_to_opencode", "shared_to_higher", "feature_to_host"]);
});

test("current imports respect core, shared, feature, and host boundaries", async () => {
  const files = await listTsFiles(SRC_ROOT);
  const edges = [];
  for (const file of files) {
    const source = toRepoPath(file);
    const imports = await staticImports(file);
    for (const specifier of imports) {
      const target = resolveRelativeImport(file, specifier);
      if (target) edges.push({ source, target });
    }
  }

  assert.deepEqual(boundaryViolations(edges), []);
});

test("feature package dependency metadata prevents cross-package drift", () => {
  const registry = createTinyChuPlugin().registry;
  const packages = new Map(registry.packages.map((item) => [item.id, item]));

  assert.deepEqual(packageDependencyViolations([
    { id: "tiny-chu.legacy-analysis", dependsOn: ["tiny-chu.ux-reverse-engineering"] },
    { id: "tiny-chu.button-workflow-hardening", dependsOn: ["tiny-chu.ux-reverse-engineering"] },
    { id: "tiny-chu.ux-reverse-engineering", dependsOn: ["tiny-chu.button-workflow-hardening"] },
  ]), [
    "button_ux_cross_dependency:tiny-chu.button-workflow-hardening->tiny-chu.ux-reverse-engineering",
    "button_ux_cross_dependency:tiny-chu.ux-reverse-engineering->tiny-chu.button-workflow-hardening",
    "legacy_must_not_depend_on_feature:tiny-chu.legacy-analysis->tiny-chu.ux-reverse-engineering",
  ]);

  assert.deepEqual(packageDependencyViolations([...packages.values()]), []);
  assert.equal(registry.toolSpecs.find((spec) => spec.name === "button_worker_packet")?.packageId, "tiny-chu.button-workflow-hardening");
  assert.equal(registry.toolSpecs.find((spec) => spec.name === "ux_rationale_trace")?.packageId, "tiny-chu.ux-reverse-engineering");
  assert.deepEqual(packages.get("tiny-chu.legacy-analysis")?.dependsOn, ["tiny-chu.core-runtime", "tiny-chu.shared-support"]);
});

function boundaryViolations(edges) {
  const violations = [];
  for (const edge of edges) {
    const sourceLayer = layerFor(edge.source);
    const targetLayer = layerFor(edge.target);
    if (sourceLayer === "core" && edge.target.startsWith("src/opencode/")) {
      violations.push({ code: "core_to_opencode", ...edge });
    }
    if (sourceLayer === "shared" && (targetLayer === "feature" || targetLayer === "host")) {
      violations.push({ code: "shared_to_higher", ...edge });
    }
    if (sourceLayer === "feature" && targetLayer === "host") {
      violations.push({ code: "feature_to_host", ...edge });
    }
  }
  return violations;
}

function packageDependencyViolations(packages) {
  const violations = [];
  for (const item of packages) {
    for (const dependency of item.dependsOn ?? []) {
      if (item.id === "tiny-chu.legacy-analysis" && !["tiny-chu.core-runtime", "tiny-chu.shared-support"].includes(dependency)) {
        violations.push(`legacy_must_not_depend_on_feature:${item.id}->${dependency}`);
      }
      const buttonUx = new Set(["tiny-chu.button-workflow-hardening", "tiny-chu.ux-reverse-engineering"]);
      if (buttonUx.has(item.id) && buttonUx.has(dependency)) {
        violations.push(`button_ux_cross_dependency:${item.id}->${dependency}`);
      }
    }
  }
  return violations.sort();
}

function layerFor(repoPath) {
  if (CORE_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) return "core";
  if (HOST_FILES.has(repoPath)) return "host";
  if (SHARED_FILES.has(repoPath)) return "shared";
  if (repoPath.startsWith("src/opencode/feature-packages/")) return "feature";
  if (repoPath.startsWith("src/opencode/")) return "feature";
  if (repoPath.startsWith("src/markdown/")) return "shared";
  return "support";
}

async function listTsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTsFiles(child));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(child);
  }
  return files.sort();
}

async function staticImports(file) {
  const content = await readFile(file, "utf8");
  const imports = [];
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of content.matchAll(importPattern)) imports.push(match[1]);
  return imports;
}

function resolveRelativeImport(sourceFile, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(sourceFile), specifier);
  const withoutJs = resolved.endsWith(".js") ? resolved.slice(0, -3) : resolved;
  const candidates = [`${withoutJs}.ts`, resolved, `${resolved}.ts`, path.join(resolved, "index.ts")];
  for (const candidate of candidates) {
    if (candidate.startsWith(SRC_ROOT)) return toRepoPath(candidate);
  }
  return undefined;
}

function toRepoPath(absolutePath) {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}
