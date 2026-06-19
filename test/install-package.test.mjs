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
const npmExecOptions = process.platform === "win32" ? { shell: true } : {};

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

async function packPackage(packDir, cacheDir) {
  const packResult = await execFileAsync(npmCommand, ["pack", "--json", "--pack-destination", packDir, "--cache", cacheDir], {
    ...npmExecOptions,
    cwd: repoRoot,
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
    maxBuffer,
  });
  const packed = JSON.parse(packResult.stdout);
  assertPackedLicenseMetadata(packed[0]);
  return path.join(packDir, packed[0].filename);
}

test("package metadata exposes offline install assets and commands", async () => {
  const packageJson = await readJson("package.json");
  const templatePackage = await readJson("templates/opencode/package.json");

  assert.equal(packageJson.private, false);
  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(packageJson.engines.node, ">=20.18.0");
  assert.equal(packageJson.bundleDependencies, true);
  assert.equal(packageJson.scripts["pack:check"], "npm run build && node --test test/install-package.test.mjs");
  assert.equal(packageJson.scripts["release:offline"], "node scripts/release/build-offline-bundle.mjs");
  assert.equal(packageJson.scripts["verify:offline"], "node scripts/release/verify-offline-bundle.mjs");
  assert.equal(packageJson.exports["./tui"], "./dist/opencode/tui-plugin.js");
  assert.equal(packageJson.bin["tiny-chu"], "./scripts/tiny-chu.mjs");
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ["@opencode-ai/plugin", "@opentui/solid", "typescript"]);
  assert.equal(packageJson.dependencies["@opencode-ai/plugin"], "^1.17.4");
  assert.equal(packageJson.dependencies["@opentui/solid"], "^0.3.4");
  assert.equal(packageJson.dependencies.typescript, "^6.0.3");
  assert.equal(packageJson.dependencies["solid-js"], undefined);
  assert.ok(packageJson.files.includes("LICENSE"));
  assert.ok(packageJson.files.includes("INSTALL.md"));
  assert.ok(packageJson.files.includes("HOW_TO_USE.md"));
  assert.ok(packageJson.files.includes("CONTRIBUTING.md"));
  assert.ok(packageJson.files.includes("CODE_OF_CONDUCT.md"));
  assert.ok(packageJson.files.includes("SECURITY.md"));
  assert.ok(packageJson.files.includes("CHANGELOG.md"));
  assert.ok(packageJson.files.includes("templates"));
  assert.ok(packageJson.files.includes("scripts/tiny-chu.mjs"));
  assert.equal(templatePackage.dependencies["tiny-chu"], "file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz");
});

test("normal package tarball includes install docs, templates, and bundled runtime dependencies", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-dry-cache-"));
  try {
    const result = await execFileAsync(npmCommand, ["pack", "--dry-run", "--json", "--cache", cacheDir], {
      ...npmExecOptions,
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
    assert.ok(files.has("scripts/tiny-chu.mjs"));
    assert.ok(files.has("dist/index.js"));
    assert.ok(files.has("dist/opencode/tui-plugin.js"));
    assert.ok(files.has("node_modules/@opencode-ai/plugin/package.json"));
    assert.ok(files.has("node_modules/@opentui/solid/package.json"));
    assert.ok(files.has("node_modules/typescript/package.json"));
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("package installer creates an OpenCode project shim and installs Tiny-Chu", async () => {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-cli-pack-"));
  const packCache = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-cli-pack-cache-"));
  const consumerDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-cli-consumer-"));
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-cli-target-"));
  const emptyCache = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-cli-empty-cache-"));

  try {
    const tarballPath = await packPackage(packDir, packCache);
    const packageSpec = `file:${tarballPath}`;

    await mkdir(consumerDir, { recursive: true });
    await execFileAsync(npmCommand, ["install", tarballPath, "--offline", "--cache", emptyCache, "--ignore-scripts", "--no-audit", "--fund=false"], {
      ...npmExecOptions,
      cwd: consumerDir,
      env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/", npm_config_audit: "false", npm_config_fund: "false" },
      maxBuffer,
    });
    const installer = path.join(consumerDir, "node_modules", ".bin", process.platform === "win32" ? "tiny-chu.cmd" : "tiny-chu");
    const installResult = await execFileAsync(
      installer,
      ["install", targetDir, "--package-spec", packageSpec],
      {
        ...npmExecOptions,
        cwd: consumerDir,
        env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/", npm_config_cache: emptyCache },
        maxBuffer,
      },
    );
    const openCodeDir = path.join(targetDir, ".opencode");
    const openCodePackage = JSON.parse(await readFile(path.join(openCodeDir, "package.json"), "utf8"));
    const opencodeImport = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", "import { TinyChuOpenCodePlugin } from 'tiny-chu/opencode'; console.log(typeof TinyChuOpenCodePlugin);"],
      { cwd: openCodeDir, maxBuffer },
    );
    const tuiImport = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", "const mod = await import('tiny-chu/tui'); console.log(mod.default.id, typeof mod.default.tui);"],
      { cwd: openCodeDir, maxBuffer },
    );

    assert.match(installResult.stdout, /Tiny-Chu installed/);
    assert.equal(openCodePackage.dependencies["tiny-chu"], packageSpec);
    assert.match(await readFile(path.join(openCodeDir, "plugins", "tiny-chu.ts"), "utf8"), /tiny-chu\/opencode/);
    assert.match(await readFile(path.join(openCodeDir, "plugins", "tiny-chu-tui.ts"), "utf8"), /tiny-chu\/tui/);
    assert.equal(opencodeImport.stdout.trim(), "function");
    assert.equal(tuiImport.stdout.trim(), "tiny-chu.logo function");
  } finally {
    await rm(packDir, { recursive: true, force: true });
    await rm(packCache, { recursive: true, force: true });
    await rm(consumerDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
    await rm(emptyCache, { recursive: true, force: true });
  }
});

test("normal package tarball installs in a fresh offline consumer and exposes public entrypoints", async () => {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-install-"));
  const packCache = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-install-cache-"));
  const consumerDir = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-install-consumer-"));
  const emptyCache = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-pack-install-empty-cache-"));

  try {
    const tarballPath = await packPackage(packDir, packCache);

    await mkdir(consumerDir, { recursive: true });
    const install = await execFileResult(
      npmCommand,
      ["install", tarballPath, "--offline", "--cache", emptyCache, "--ignore-scripts", "--no-audit", "--fund=false"],
      {
        ...npmExecOptions,
        cwd: consumerDir,
        env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/", npm_config_audit: "false", npm_config_fund: "false" },
      },
    );

    assert.equal(install.code, 0, `${install.stdout}\n${install.stderr}`);
    const rootImport = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", "import { createTinyChuPlugin } from 'tiny-chu'; console.log(typeof createTinyChuPlugin);"],
      { cwd: consumerDir, maxBuffer },
    );
    const opencodeImport = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", "import { TinyChuOpenCodePlugin } from 'tiny-chu/opencode'; console.log(typeof TinyChuOpenCodePlugin);"],
      { cwd: consumerDir, maxBuffer },
    );
    const tuiImport = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", "const mod = await import('tiny-chu/tui'); console.log(mod.default.id, typeof mod.default.tui);"],
      { cwd: consumerDir, maxBuffer },
    );

    assert.equal(rootImport.stdout.trim(), "function");
    assert.equal(opencodeImport.stdout.trim(), "function");
    assert.equal(tuiImport.stdout.trim(), "tiny-chu.logo function");
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
      ...npmExecOptions,
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
