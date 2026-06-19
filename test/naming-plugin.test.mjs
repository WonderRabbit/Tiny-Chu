import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";

test("naming tools are exposed through the small-model feature package", async (t) => {
  const root = await fixtureRoot(t);
  const plugin = createTinyChuPlugin({ root });
  const names = ["naming_lookup", "naming_propose", "naming_context", "naming_add"];

  for (const name of names) assert.equal(typeof plugin.tools[name], "function", `${name} tool must be registered`);
  const featurePackage = plugin.registry.packages.find((item) => item.id === "tiny-chu.small-model-resilience");
  assert.ok(featurePackage);
  assert.deepEqual(names.every((name) => featurePackage.toolNames.includes(name)), true);
  const permissions = new Map(plugin.registry.toolSpecs.filter((tool) => names.includes(tool.name)).map((tool) => [tool.name, tool.permission]));
  assert.equal(permissions.get("naming_add")?.writesState, true);
  assert.deepEqual(names.filter((name) => name !== "naming_add").map((name) => permissions.get(name)?.readOnly), [true, true, true]);
});

test("naming plugin tools return bounded context and append proposal events", async (t) => {
  const root = await fixtureRoot(t);
  const plugin = createTinyChuPlugin({ root });
  const before = await readFile(path.join(root, "docs", "naming", "dictionary.json"), "utf8");

  const lookup = await plugin.tools.naming_lookup({ query: "topk", namespace: "model-settings", maxEntries: 2 });
  const proposed = await plugin.tools.naming_propose({ name: "top_k", kind: "setting", namespace: "model-settings" });
  const reservedMisuse = await plugin.tools.naming_propose({ name: "topK", kind: "variable", namespace: "shared", meaning: "Misused setting", sourceRefs: ["qa"] });
  const added = await plugin.tools.naming_add({ name: "newWorkflowTerm", kind: "term", namespace: "shared", meaning: "New workflow term", sourceRefs: ["qa"] });
  const duplicate = await plugin.tools.naming_add({ name: "newWorkflowTerm", kind: "term", namespace: "shared", meaning: "New workflow term", sourceRefs: ["qa"] });

  assert.deepEqual(lookup.matchedEntries.map((entry) => entry.name), ["topK"]);
  assert.ok(proposed.diagnostics.some((diagnostic) => diagnostic.code === "blocked_variant"));
  assert.ok(reservedMisuse.diagnostics.some((diagnostic) => diagnostic.code === "reserved_term_misuse"));
  assert.equal(added.status, "pending");
  assert.equal(duplicate.status, "duplicate");
  const events = await readFile(path.join(root, ".tiny", "naming", "events.jsonl"), "utf8");
  assert.equal(events.split(/\r?\n/).filter(Boolean).length, 2);
  assert.equal(await readFile(path.join(root, "docs", "naming", "dictionary.json"), "utf8"), before);
});

async function fixtureRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-naming-plugin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs", "naming"), { recursive: true });
  await copyFile(path.join(process.cwd(), "docs", "naming", "dictionary.json"), path.join(root, "docs", "naming", "dictionary.json"));
  return root;
}
