import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";
import { callMcpToolFromRegistry, listMcpToolsFromRegistry } from "../dist/opencode/mcp/server.js";

test("lists MCP descriptors from the composed registry with package metadata and fingerprints", async () => {
  // Given: a real Tiny-Chu registry.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-adapter-"));
  const tiny = createTinyChuPlugin({ root });

  // When: the registry is projected to MCP descriptors.
  const tools = listMcpToolsFromRegistry(tiny.registry);
  const installDescriptor = tools.find((item) => item.name === "tiny_chu_install_check");
  const installSpec = tiny.registry.toolSpecs.find((item) => item.name === "tiny_chu_install_check");

  // Then: the descriptor surface stays in parity with registry.toolSpecs.
  assert.equal(tools.length, tiny.registry.toolSpecs.length);
  assert.deepEqual(tools.map((item) => item.name), tiny.registry.toolSpecs.map((item) => item.name));
  assert.ok(installDescriptor);
  assert.ok(installSpec);
  assert.equal(installDescriptor.description, installSpec.description);
  assert.equal(installDescriptor.metadata.packageId, installSpec.packageId);
  assert.deepEqual(installDescriptor.metadata.permission, installSpec.permission);
  assert.deepEqual(installDescriptor.metadata.smallModel, installSpec.smallModel);
  assert.deepEqual(installDescriptor.metadata.requiredNativeTools, installSpec.requiredNativeTools);
  assert.match(installDescriptor.schemaFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(installDescriptor.metadata.schemaFingerprint, installDescriptor.schemaFingerprint);
});

test("calls a read-only tool through MCP with direct handler equivalence", async () => {
  // Given: a real Tiny-Chu registry and a safe read-only tool.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-call-"));
  const tiny = createTinyChuPlugin({ root });
  const direct = await tiny.tools.tiny_chu_install_check({});

  // When: MCP tools/call invokes the same composed-registry handler.
  const result = await callMcpToolFromRegistry(tiny.registry, {
    name: "tiny_chu_install_check",
    arguments: { maxOutputChars: 100_000, maxArrayItems: 500 },
  }, { targetPath: root });

  // Then: the observable structured payload matches the direct API result.
  assert.equal(result.isError, false);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), direct);
  assert.equal(result.metadata.tool, "tiny_chu_install_check");
  assert.equal(result.metadata.truncated, false);
});

test("fails unknown tools before any handler execution", async () => {
  // Given: a registry with one callable handler.
  let calls = 0;
  const registry = {
    packageIds: ["tiny-chu.test"],
    packages: [],
    tools: {
      known_tool: async () => {
        calls += 1;
        return { ok: true };
      },
    },
    toolSpecs: [{
      name: "known_tool",
      description: "Known test tool.",
      packageId: "tiny-chu.test",
      packageTitle: "Test",
      requiredNativeTools: [],
    }],
    resources: [],
    prompts: [],
    instructions: [],
    requiredToolNames: ["known_tool"],
    nativeToolNames: [],
  };

  // When: MCP tries to call a tool that is not in the composed registry.
  const result = await callMcpToolFromRegistry(registry, {
    name: "missing_tool",
    arguments: {},
  });

  // Then: the handler map is never touched.
  assert.equal(calls, 0);
  assert.equal(result.isError, true);
  assert.equal(result.error.code, "unknown_tool");
  assert.equal(result.metadata.tool, "missing_tool");
});

test("bounds long MCP tool output and reports truncation metadata", async () => {
  // Given: a registry handler that returns more output than the requested budget.
  const registry = {
    packageIds: ["tiny-chu.test"],
    packages: [],
    tools: {
      long_output: async () => ({
        items: Array.from({ length: 20 }, (_, index) => ({ index, value: `value-${index}` })),
      }),
    },
    toolSpecs: [{
      name: "long_output",
      description: "Long output test tool.",
      packageId: "tiny-chu.test",
      packageTitle: "Test",
      requiredNativeTools: [],
    }],
    resources: [],
    prompts: [],
    instructions: [],
    requiredToolNames: ["long_output"],
    nativeToolNames: [],
  };

  // When: MCP calls the tool with a tight output budget.
  const result = await callMcpToolFromRegistry(registry, {
    name: "long_output",
    arguments: { maxOutputChars: 160, maxArrayItems: 3 },
  });

  // Then: the content is bounded and the budget metadata says what happened.
  assert.equal(result.isError, false);
  assert.equal(result.metadata.truncated, true);
  assert.ok(result.metadata.budget.omittedItems > 0);
  assert.ok(result.content[0].text.length <= 160);
});
