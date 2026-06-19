import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import ts from "typescript";
import { extractNamingSymbols } from "../dist/naming/naming-extract.js";

const execFileAsync = promisify(execFile);

test("extractNamingSymbols returns source declarations and package tool names", async () => {
  // Given: the Tiny-Chu source tree and installed TypeScript compiler.
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const expectedMajor = packageJson.dependencies.typescript.match(/\d+/)?.[0];

  // When: the extractor scans src/**/*.ts through the compiler API.
  const result = await extractNamingSymbols(process.cwd());
  const byName = new Map(result.symbols.map((symbol) => [symbol.name, symbol]));

  // Then: source declarations, model settings, and tool seeds are present.
  assert.equal(ts.version.split(".")[0], expectedMajor);
  assert.equal(byName.get("createDefaultAgentModelTemplates")?.kind, "function");
  assert.equal(byName.get("validateAgentModelTemplate")?.kind, "function");
  assert.equal(byName.get("topK")?.namespace, "model-settings");
  assert.equal(byName.get("wiki_context")?.kind, "tool");
  const topK = byName.get("topK");
  assert.ok(topK);
  assert.match(topK.modulePath, /^src\//);
  assert.ok(topK.line > 0);
  assert.ok(topK.sourceRefs.some((ref) => ref.includes(`${topK.modulePath}:`)));
});

test("naming extractor CLI prints JSON symbols", async () => {
  // Given: the built CLI script.
  // When: the CLI is invoked with --root and --json.
  const { stdout } = await execFileAsync(process.execPath, ["scripts/naming-extract.mjs", "--root", ".", "--json"], { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);

  // Then: callers receive a non-empty symbol list without stderr parsing.
  assert.ok(parsed.symbols.length > 0);
  assert.ok(parsed.symbols.some((symbol) => symbol.name === "wiki_context"));
});

test("extractNamingSymbols allows repeated local names", async () => {
  // Given: a temporary fixture with repeated local declarations.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-naming-extract-test-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" }, include: ["src/**/*.ts"] }));
    await writeFile(path.join(root, "src", "fixture.ts"), "function status() { return 1 }\nfunction other() { const status = 2; return status }\n");

    // When: the extractor scans the fixture.
    const result = await extractNamingSymbols(root);

    // Then: duplicate local names are records, not hard errors.
    assert.equal(result.diagnostics.length, 0);
    assert.ok(result.symbols.filter((symbol) => symbol.name === "status").length >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extractNamingSymbols records overloaded exported functions once", async () => {
  // Given: a temporary fixture with TypeScript overload signatures and one implementation.
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-naming-overload-test-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" }, include: ["src/**/*.ts"] }));
    await writeFile(
      path.join(root, "src", "fixture.ts"),
      [
        "export function configure(input: string): string;",
        "export function configure(input: number): string;",
        "export function configure(input: string | number): string { return String(input) }",
      ].join("\n"),
    );

    // When: the extractor scans the fixture.
    const result = await extractNamingSymbols(root);

    // Then: duplicate public-export checks see the callable once, not every overload signature.
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.symbols.filter((symbol) => symbol.name === "configure" && symbol.kind === "function" && symbol.exported).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
