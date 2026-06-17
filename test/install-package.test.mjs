import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxBuffer = 1024 * 1024 * 32;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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

function assertPackedLicenseMetadata(packPayload) {
  const files = new Set(packPayload.files.map((file) => file.path));

  assert.ok(files.has("LICENSE"));
  if (Object.hasOwn(packPayload, "license")) assert.equal(packPayload.license, "Apache-2.0");
  return files;
}

test("package metadata exposes offline install assets and commands", async () => {
  const packageJson = await readJson("package.json");
  const templatePackage = await readJson("templates/opencode/package.json");

  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(packageJson.engines.node, ">=20.18.0");
  assert.equal(packageJson.scripts["pack:check"], "npm run build && node --test test/install-package.test.mjs");
  assert.equal(packageJson.scripts["release:offline"], "node scripts/release/build-offline-bundle.mjs");
  assert.equal(packageJson.scripts["verify:offline"], "node scripts/release/verify-offline-bundle.mjs");
  assert.equal(packageJson.exports["./tui"], "./dist/opencode/tui-plugin.js");
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ["@opencode-ai/plugin", "@opentui/solid"]);
  assert.equal(packageJson.dependencies["@opencode-ai/plugin"], "^1.17.4");
  assert.equal(packageJson.dependencies["@opentui/solid"], "^0.3.4");
  assert.equal(packageJson.dependencies["solid-js"], undefined);
  assert.ok(packageJson.files.includes("LICENSE"));
  assert.ok(packageJson.files.includes("INSTALL.md"));
  assert.ok(packageJson.files.includes("HOW_TO_USE.md"));
  assert.ok(packageJson.files.includes("CONTRIBUTING.md"));
  assert.ok(packageJson.files.includes("CODE_OF_CONDUCT.md"));
  assert.ok(packageJson.files.includes("SECURITY.md"));
  assert.ok(packageJson.files.includes("CHANGELOG.md"));
  assert.ok(packageJson.files.includes("templates"));
  assert.equal(templatePackage.dependencies["tiny-chu"], "file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz");
});

test("normal package tarball includes install docs and templates without bundled dependencies", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-dry-cache-"));
  try {
    const result = await execFileAsync(npmCommand, ["pack", "--dry-run", "--json", "--cache", cacheDir], {
      cwd: repoRoot,
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
      maxBuffer,
    });
    const packed = JSON.parse(result.stdout);
    const files = assertPackedLicenseMetadata(packed[0]);

    assert.ok(files.has("README.md"));
    assert.ok(files.has("HOW_TO_USE.md"));
    assert.ok(files.has("INSTALL.md"));
    assert.ok(files.has("CONTRIBUTING.md"));
    assert.ok(files.has("CODE_OF_CONDUCT.md"));
    assert.ok(files.has("SECURITY.md"));
    assert.ok(files.has("CHANGELOG.md"));
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
    const packResult = await execFileAsync(npmCommand, ["pack", "--json", "--pack-destination", packDir, "--cache", packCache], {
      cwd: repoRoot,
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
      maxBuffer,
    });
    const packed = JSON.parse(packResult.stdout);
    assertPackedLicenseMetadata(packed[0]);
    const tarballPath = path.join(packDir, packed[0].filename);

    await mkdir(consumerDir, { recursive: true });
    const install = await execFileResult(
      npmCommand,
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

test("offline release bundle exposes Apache-2.0 license artifacts", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-offline-bundle-test-"));
  const extractDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-offline-bundle-extract-"));
  const releaseCache = process.env.TINY_CHU_RELEASE_NPM_CACHE ?? process.env.npm_config_cache ?? path.join(os.homedir(), ".npm");

  try {
    const result = await execFileAsync(npmCommand, ["run", "release:offline", "--", "--out", outDir], {
      cwd: repoRoot,
      env: { ...process.env, TINY_CHU_RELEASE_NPM_CACHE: releaseCache, npm_config_audit: "false", npm_config_fund: "false" },
      maxBuffer,
    });
    const jsonStart = result.stdout.indexOf("{");
    assert.notEqual(jsonStart, -1, "release command did not print a JSON summary");
    const release = JSON.parse(result.stdout.slice(jsonStart));
    await execFileAsync("tar", ["-xzf", release.bundle, "-C", extractDir], { maxBuffer });

    const [bundleDirName] = (await readdir(extractDir)).filter((entry) => entry.startsWith("tiny-chu-offline-v"));
    assert.ok(bundleDirName);
    const bundleDir = path.join(extractDir, bundleDirName);
    const manifest = JSON.parse(await readFile(path.join(bundleDir, "manifest.json"), "utf8"));
    const releaseDocs = await Promise.all(
      ["LICENSE", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "CHANGELOG.md"].map(async (file) => [
        file,
        await readFile(path.join(bundleDir, file), "utf8"),
      ]),
    );
    const releaseDocText = new Map(releaseDocs);
    const offlineReadme = await readFile(path.join(bundleDir, "README-offline.md"), "utf8");
    const closureDependencies = manifest.dependencyClosure.dependencies ?? {};

    assert.equal(manifest.license, "Apache-2.0");
    assert.equal(manifest.licenseFile, "LICENSE");
    assert.ok(Object.hasOwn(closureDependencies, "@opencode-ai/plugin"));
    assert.ok(Object.hasOwn(closureDependencies, "@opentui/solid"));
    assert.match(releaseDocText.get("LICENSE"), /Apache License/);
    assert.match(releaseDocText.get("CONTRIBUTING.md"), /npm run build/);
    assert.match(releaseDocText.get("CODE_OF_CONDUCT.md"), /Contributor Covenant/);
    assert.match(releaseDocText.get("SECURITY.md"), /7 days/);
    assert.match(releaseDocText.get("CHANGELOG.md"), /## \[0\.1\.0\]/);
    assert.match(offlineReadme, /Apache-2\.0/);
    assert.match(offlineReadme, /LICENSE/);
    assert.match(offlineReadme, /--no-audit/);
    assert.match(offlineReadme, /dependencyClosure/);
    assert.match(offlineReadme, /package-lock\.json/);
    assert.match(offlineReadme, /SHA256SUMS/);
    assert.match(offlineReadme, /SBOM/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
});
