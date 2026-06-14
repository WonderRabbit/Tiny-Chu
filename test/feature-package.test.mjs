import assert from "node:assert/strict";
import test from "node:test";
import { composeFeaturePackages, FeaturePackageError } from "../dist/opencode/feature-package.js";

const noop = async () => ({ ok: true });

function pkg(id, options = {}) {
  return {
    id,
    version: 1,
    title: id,
    category: options.category ?? "support",
    dependsOn: options.dependsOn ?? [],
    tools: options.tools ?? [],
  };
}

function tool(name, description = `${name} description`) {
  return { name, description, handler: noop };
}

test("feature package descriptor rejects duplicate package ids and tool names", () => {
  assert.throws(
    () => composeFeaturePackages([pkg("same"), pkg("same")]),
    (error) => error instanceof FeaturePackageError && error.code === "duplicate_package_id" && error.message.includes("same"),
  );
  assert.throws(
    () => composeFeaturePackages([pkg("a", { tools: [tool("same_tool")] }), pkg("b", { tools: [tool("same_tool")] })]),
    (error) => error instanceof FeaturePackageError && error.code === "duplicate_tool_name" && error.message.includes("same_tool"),
  );
});

test("feature package composer rejects missing dependencies and cycles", () => {
  assert.throws(
    () => composeFeaturePackages([pkg("a", { dependsOn: ["missing"] })]),
    (error) => error instanceof FeaturePackageError && error.code === "missing_dependency" && error.message.includes("missing"),
  );
  assert.throws(
    () => composeFeaturePackages([pkg("a", { dependsOn: ["b"] }), pkg("b", { dependsOn: ["a"] })]),
    (error) => error instanceof FeaturePackageError && error.code === "dependency_cycle" && error.message.includes("a") && error.message.includes("b"),
  );
});

test("feature package composer orders dependencies deterministically and executes handlers", async () => {
  const packages = [
    pkg("feature.z", { dependsOn: ["shared.a"], tools: [tool("z_tool")] }),
    pkg("core.runtime", { tools: [tool("core_tool")] }),
    pkg("shared.a", { dependsOn: ["core.runtime"], tools: [tool("shared_tool")] }),
  ];

  const first = composeFeaturePackages(packages);
  const second = composeFeaturePackages([...packages].reverse());

  assert.deepEqual(first.packageIds, ["core.runtime", "shared.a", "feature.z"]);
  assert.deepEqual(second.packageIds, ["core.runtime", "shared.a", "feature.z"]);
  assert.deepEqual(first.requiredToolNames, ["core_tool", "shared_tool", "z_tool"]);
  assert.deepEqual(first.toolSpecs.map((spec) => spec.name), ["core_tool", "shared_tool", "z_tool"]);
  assert.deepEqual(first.toolSpecs.map((spec) => spec.packageId), ["core.runtime", "shared.a", "feature.z"]);
  assert.deepEqual(await first.tools.z_tool({}, { sessionId: "s1" }), { ok: true });
});
