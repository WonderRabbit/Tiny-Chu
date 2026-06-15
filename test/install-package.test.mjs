import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxBuffer = 1024 * 1024 * 32;

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function execFileResult(file, args, options) {
  try {
    const result = await execFileAsync(file, args, { ...options, maxBuffer });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && "stdout" in error && "stderr" in error) {
      return { code: Number(error.code), stdout: String(error.stdout), stderr: String(error.stderr) };
    }
    throw error;
  }
}

test("package metadata exposes offline install assets and commands", async () => {
  const packageJson = await readJson("package.json");
  const templatePackage = await readJson("templates/opencode/package.json");

  assert.equal(packageJson.engines.node, ">=20.18.0");
  assert.equal(packageJson.scripts["pack:check"], "npm run build && node --test test/install-package.test.mjs");
  assert.equal(packageJson.scripts["release:offline"], "node scripts/release/build-offline-bundle.mjs");
  assert.equal(packageJson.scripts["verify:offline"], "node scripts/release/verify-offline-bundle.mjs");
  assert.equal(packageJson.exports["./tui"], "./dist/opencode/tui-plugin.js");
  assert.equal(packageJson.dependencies["@opentui/solid"], "^0.3.4");
  assert.equal(packageJson.dependencies["solid-js"], undefined);
  assert.ok(packageJson.files.includes("INSTALL.md"));
  assert.ok(packageJson.files.includes("HOW_TO_USE.md"));
  assert.ok(packageJson.files.includes("templates"));
  assert.equal(templatePackage.dependencies["tiny-chu"], "file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz");
});

test("normal package tarball includes install docs and templates without bundled dependencies", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-dry-cache-"));
  try {
    const result = await execFileAsync("npm", ["pack", "--dry-run", "--json", "--cache", cacheDir], {
      cwd: repoRoot,
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
      maxBuffer,
    });
    const packed = JSON.parse(result.stdout);
    const files = new Set(packed[0].files.map((file) => file.path));

    assert.ok(files.has("README.md"));
    assert.ok(files.has("HOW_TO_USE.md"));
    assert.ok(files.has("INSTALL.md"));
    assert.ok(files.has("templates/opencode/package.json"));
    assert.ok(files.has("templates/opencode/tui.json"));
    assert.ok(files.has("templates/opencode/plugins/tiny-chu.ts"));
    assert.ok(files.has("templates/opencode/plugins/tiny-chu-tui.ts"));
    assert.ok(files.has("dist/index.js"));
    assert.ok(files.has("dist/opencode/tui-plugin.js"));
    assert.equal([...files].some((file) => file.startsWith("node_modules/")), false);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("normal package tarball fails in a fresh offline consumer without cached dependencies", async () => {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-red-"));
  const packCache = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-red-cache-"));
  const consumerDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-red-consumer-"));
  const emptyCache = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-red-empty-cache-"));

  try {
    const packResult = await execFileAsync("npm", ["pack", "--json", "--pack-destination", packDir, "--cache", packCache], {
      cwd: repoRoot,
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
      maxBuffer,
    });
    const packed = JSON.parse(packResult.stdout);
    const tarballPath = path.join(packDir, packed[0].filename);

    await mkdir(consumerDir, { recursive: true });
    const install = await execFileResult(
      "npm",
      ["install", tarballPath, "--offline", "--cache", emptyCache, "--ignore-scripts", "--no-audit", "--fund=false"],
      {
        cwd: consumerDir,
        env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/", npm_config_audit: "false", npm_config_fund: "false" },
      },
    );
    const output = `${install.stdout}\n${install.stderr}`;

    assert.notEqual(install.code, 0);
    assert.match(output, /ENOTCACHED|cache mode is 'only-if-cached'|@opencode-ai%2fplugin|@opencode-ai\/plugin|@opentui%2fsolid|@opentui\/solid/);
  } finally {
    await rm(packDir, { recursive: true, force: true });
    await rm(packCache, { recursive: true, force: true });
    await rm(consumerDir, { recursive: true, force: true });
    await rm(emptyCache, { recursive: true, force: true });
  }
});
