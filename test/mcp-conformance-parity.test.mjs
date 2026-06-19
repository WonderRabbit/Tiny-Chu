import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTinyChuPlugin } from "../dist/index.js";
import { listMcpToolsFromRegistry, schemaFingerprintForToolSpec } from "../dist/opencode/mcp/server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package metadata and install-check expose the MCP stdio entrypoint", async () => {
  // Given: package metadata and a real Tiny-Chu registry.
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-package-"));
  const tiny = createTinyChuPlugin({ root });
  const install = await tiny.tools.tiny_chu_install_check({});

  // When: MCP package metadata is inspected.
  const mcpPackage = tiny.registry.packages.find((item) => item.id === "tiny-chu.host-mcp");

  // Then: the host package owns no tools and install-check reports descriptor parity.
  assert.equal(packageJson.exports["./opencode/mcp"], "./dist/opencode/mcp/server.js");
  assert.equal(packageJson.exports["./opencode/mcp/stdio"], "./dist/opencode/mcp/stdio-entrypoint.js");
  assert.ok(mcpPackage);
  assert.deepEqual(mcpPackage.toolNames, []);
  assert.ok(mcpPackage.resourceNames.includes("mcp-stdio-adapter"));
  assert.equal(install.mcpEntrypoint, "./dist/opencode/mcp/stdio-entrypoint.js");
  assert.equal(install.mcpHostPackageId, "tiny-chu.host-mcp");
  assert.equal(install.mcpToolCount, tiny.registry.toolSpecs.length);
  assert.equal(install.mcpSchemaFingerprints.length, tiny.registry.toolSpecs.length);
});

test("MCP descriptor fingerprints stay in parity with registry tool specs", async () => {
  // Given: a real Tiny-Chu registry.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-fingerprint-"));
  const tiny = createTinyChuPlugin({ root });

  // When: MCP descriptors are generated.
  const descriptors = listMcpToolsFromRegistry(tiny.registry);
  const descriptorFingerprints = new Map(descriptors.map((item) => [item.name, item.schemaFingerprint]));

  // Then: every descriptor fingerprint is derived from the current registry spec.
  for (const spec of tiny.registry.toolSpecs) {
    assert.equal(descriptorFingerprints.get(spec.name), schemaFingerprintForToolSpec(spec));
  }
});

test("tool_call_conformance_probe accepts MCP descriptor tool-call shapes", async () => {
  // Given: MCP descriptors generated from the current registry.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-conformance-"));
  const tiny = createTinyChuPlugin({ root });
  const descriptors = listMcpToolsFromRegistry(tiny.registry);

  // When: the conformance probe checks a descriptor-backed tool call fixture.
  const probe = await tiny.tools.tool_call_conformance_probe({
    allowedTools: descriptors.map((item) => item.name),
    fixture: {
      tool_calls: [{
        function: {
          name: "tiny_chu_install_check",
          arguments: JSON.stringify({}),
        },
      }],
    },
  });

  // Then: the existing small-model conformance surface covers MCP names.
  assert.equal(probe.status, "pass");
  assert.equal(probe.toolCalls[0].toolName, "tiny_chu_install_check");
  assert.equal(probe.toolCalls[0].valid, true);
});
