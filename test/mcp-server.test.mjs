import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTinyChuPlugin } from "../dist/index.js";
import { dispatchMcpJsonRpc, dispatchMcpJsonRpcLine, startMcpStdioLoop } from "../dist/opencode/mcp/server.js";

test("dispatches tools/list over JSON-RPC from the composed registry", async () => {
  // Given: a real Tiny-Chu registry.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-jsonrpc-list-"));
  const tiny = createTinyChuPlugin({ root });

  // When: a JSON-RPC tools/list request is dispatched.
  const response = await dispatchMcpJsonRpc(tiny.registry, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });

  // Then: the result mirrors registry.toolSpecs.
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.tools.length, tiny.registry.toolSpecs.length);
  assert.deepEqual(response.result.tools.map((item) => item.name), tiny.registry.toolSpecs.map((item) => item.name));
});

test("dispatches tools/call over JSON-RPC and preserves context", async () => {
  // Given: a registry whose handler echoes input and context.
  const registry = {
    packageIds: ["tiny-chu.test"],
    packages: [],
    tools: {
      echo_context: async (input, context) => ({ input, context }),
    },
    toolSpecs: [{
      name: "echo_context",
      description: "Echo context.",
      packageId: "tiny-chu.test",
      packageTitle: "Test",
      requiredNativeTools: [],
    }],
    resources: [],
    prompts: [],
    instructions: [],
    requiredToolNames: ["echo_context"],
    nativeToolNames: [],
  };

  // When: JSON-RPC tools/call invokes the handler.
  const response = await dispatchMcpJsonRpc(registry, {
    jsonrpc: "2.0",
    id: "call-1",
    method: "tools/call",
    params: { name: "echo_context", arguments: { value: "ok" } },
  }, { sessionId: "s1", targetPath: "/tmp/tiny-chu-target" });

  // Then: both arguments and context arrive at the composed-registry handler.
  assert.equal(response.id, "call-1");
  assert.equal(response.result.isError, false);
  assert.deepEqual(JSON.parse(response.result.content[0].text), {
    input: { value: "ok" },
    context: { sessionId: "s1", targetPath: "/tmp/tiny-chu-target" },
  });
});

test("returns structured JSON-RPC errors for malformed and invalid requests", async () => {
  // Given: a real registry.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-jsonrpc-error-"));
  const tiny = createTinyChuPlugin({ root });

  // When: malformed JSON, invalid params, and unknown methods are dispatched.
  const malformed = await dispatchMcpJsonRpcLine(tiny.registry, "{bad json");
  const invalidParams = await dispatchMcpJsonRpc(tiny.registry, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "tiny_chu_install_check", arguments: [] },
  });
  const unknownMethod = await dispatchMcpJsonRpc(tiny.registry, {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/list",
    params: {},
  });

  // Then: each failure is explicit and handler execution is avoided for invalid params.
  assert.equal(JSON.parse(malformed).error.code, -32700);
  assert.equal(invalidParams.error.code, -32602);
  assert.equal(unknownMethod.error.code, -32601);
});

test("dispatchMcpJsonRpcLine rethrows unexpected JSON parser failures", async (t) => {
  // Given: JSON.parse fails with a non-SyntaxError.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-jsonrpc-parser-failure-"));
  const tiny = createTinyChuPlugin({ root });
  const originalParse = JSON.parse;
  t.after(() => {
    JSON.parse = originalParse;
  });
  JSON.parse = () => {
    throw new TypeError("parser unavailable");
  };

  // When/Then: the unexpected parser failure is not converted to a parse error response.
  await assert.rejects(
    () => dispatchMcpJsonRpcLine(tiny.registry, "{}"),
    /parser unavailable/,
  );
});

test("processes newline-delimited stdio JSON-RPC requests", async () => {
  // Given: a registry and in-memory stdio streams.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-mcp-stdio-"));
  const tiny = createTinyChuPlugin({ root });
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(chunk.toString("utf8")));

  // When: the stdio loop receives a tools/list request.
  const loop = startMcpStdioLoop({ registry: tiny.registry, input, output });
  input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} })}\n`);
  await loop;
  await once(output, "finish");

  // Then: a JSON-RPC response is written to stdout.
  const response = JSON.parse(chunks.join("").trim());
  assert.equal(response.id, 7);
  assert.equal(response.result.tools.length, tiny.registry.toolSpecs.length);
});
