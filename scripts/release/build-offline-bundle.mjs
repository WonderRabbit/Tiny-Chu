#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { writeBundleTemplate, writeInstallers } from "./offline-installers.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const maxBuffer = 1024 * 1024 * 32;

function parseArgs(argv) {
  const parsed = { out: path.join(repoRoot, "release"), keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--out requires a directory");
      parsed.out = path.resolve(value);
      index += 1;
    } else if (arg === "--keep-temp") {
      parsed.keepTemp = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertExists(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const nested of await listFiles(absolute)) files.push(path.join(entry.name, nested));
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files;
}

async function copyReleaseInputs(stagingDir) {
  const requiredPaths = ["dist", "README.md", "HOW_TO_USE.md", "INSTALL.md", "LICENSE", "templates", "package-lock.json"];
  for (const relativePath of requiredPaths) await assertExists(path.join(repoRoot, relativePath), relativePath);

  for (const relativePath of requiredPaths) {
    await cp(path.join(repoRoot, relativePath), path.join(stagingDir, relativePath), { recursive: true });
  }
}

async function buildStagePackageJson(stagingDir, packageJson) {
  const releasePackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    private: packageJson.private,
    type: packageJson.type,
    description: packageJson.description,
    license: packageJson.license,
    engines: packageJson.engines,
    exports: packageJson.exports,
    files: packageJson.files,
    dependencies: packageJson.dependencies,
    bundleDependencies: true,
  };
  await writeJson(path.join(stagingDir, "package.json"), releasePackageJson);
}

function npmEnv(cacheDir) {
  return { ...process.env, npm_config_audit: "false", npm_config_fund: "false", npm_config_cache: cacheDir };
}

async function installProductionDependencies(stagingDir, cacheDir) {
  try {
    await execFileAsync(
      "npm",
      ["install", "--omit=dev", "--cache", cacheDir, "--ignore-scripts", "--no-audit", "--fund=false"],
      {
        cwd: stagingDir,
        env: npmEnv(cacheDir),
        maxBuffer,
      },
    );
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    if (/ENOTCACHED|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network|fetch failed/i.test(stderr)) {
      throw new Error(
        `release build machine needs dependency materialization for production dependencies; rerun with network or a pre-populated npm cache (${cacheDir})`,
      );
    }
    throw error;
  }
}

async function writeInnerChecksums(bundleDir) {
  const bundleFiles = (await listFiles(bundleDir)).filter((file) => file !== "SHA256SUMS");
  const lines = [];
  for (const file of bundleFiles) lines.push(`${await hashFile(path.join(bundleDir, file))}  ${file}`);
  await writeFile(path.join(bundleDir, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageJson = await readJson(path.join(repoRoot, "package.json"));
  const version = packageJson.version;
  const bundleName = `tiny-chu-offline-v${version}`;
  const tarballName = `tiny-chu-v${version}-bundled.tgz`;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-offline-build-"));
  const stagingDir = path.join(tempRoot, "package");
  const bundleDir = path.join(tempRoot, bundleName);
  const cacheDir = process.env.TINY_CHU_RELEASE_NPM_CACHE
    ? path.resolve(process.env.TINY_CHU_RELEASE_NPM_CACHE)
    : path.join(tempRoot, "npm-cache");
  const packCacheDir = path.join(tempRoot, "npm-pack-cache");

  try {
    await execFileAsync("npm", ["run", "build"], { cwd: repoRoot, maxBuffer });
    await mkdir(args.out, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await mkdir(packCacheDir, { recursive: true });
    await mkdir(stagingDir, { recursive: true });
    await mkdir(path.join(bundleDir, "vendor"), { recursive: true });

    await copyReleaseInputs(stagingDir);
    await buildStagePackageJson(stagingDir, packageJson);
    await installProductionDependencies(stagingDir, cacheDir);

    const packResult = await execFileAsync("npm", ["pack", "--json", "--pack-destination", path.join(bundleDir, "vendor"), "--cache", packCacheDir], {
      cwd: stagingDir,
      env: npmEnv(packCacheDir),
      maxBuffer,
    });
    const packed = JSON.parse(packResult.stdout);
    const generatedTarballName = packed[0]?.filename;
    if (typeof generatedTarballName !== "string") throw new Error("npm pack did not return a tarball filename");
    await rename(path.join(bundleDir, "vendor", generatedTarballName), path.join(bundleDir, "vendor", tarballName));

    await cp(path.join(repoRoot, "LICENSE"), path.join(bundleDir, "LICENSE"));
    await cp(path.join(repoRoot, "templates"), path.join(bundleDir, "templates"), { recursive: true });
    await writeBundleTemplate(bundleDir, version, tarballName);
    await writeInstallers(bundleDir, tarballName);

    const dependencyClosure = JSON.parse(
      (await execFileAsync("npm", ["ls", "--omit=dev", "--json"], { cwd: stagingDir, maxBuffer })).stdout,
    );
    const distHashes = {
      "dist/index.js": await hashFile(path.join(stagingDir, "dist", "index.js")),
      "dist/opencode/plugin.js": await hashFile(path.join(stagingDir, "dist", "opencode", "plugin.js")),
      "dist/opencode/tui-plugin.js": await hashFile(path.join(stagingDir, "dist", "opencode", "tui-plugin.js")),
    };
    const manifest = {
      name: "tiny-chu-offline-bundle",
      packageName: packageJson.name,
      version,
      createdAt: new Date().toISOString(),
      node: process.version,
      npm: (await execFileAsync("npm", ["--version"], { cwd: repoRoot, maxBuffer })).stdout.trim(),
      packageTarball: `vendor/${tarballName}`,
      license: packageJson.license,
      licenseFile: "LICENSE",
      opencodeTemplate: "templates/opencode",
      opencodeDependency: `file:./vendor/${tarballName}`,
      installDocs: "INSTALL.md",
      dependencyStrategy: { bundleDependencies: true, materializedFrom: "staging-npm-install", omit: "dev" },
      dependencyClosure,
      distHashes,
      verifiedEntrypoints: [".", "./opencode", "./tui"],
    };
    await writeJson(path.join(bundleDir, "manifest.json"), manifest);
    await writeInnerChecksums(bundleDir);

    const archivePath = path.join(args.out, `${bundleName}.tar.gz`);
    await execFileAsync("tar", ["-czf", archivePath, "-C", tempRoot, bundleName], { cwd: repoRoot, maxBuffer });
    await writeFile(path.join(args.out, "SHA256SUMS"), `${await hashFile(archivePath)}  ${path.basename(archivePath)}\n`);

    const archiveStat = await stat(archivePath);
    console.log(
      JSON.stringify(
        {
          bundle: archivePath,
          checksumFile: path.join(args.out, "SHA256SUMS"),
          version,
          bytes: archiveStat.size,
          tempRoot: args.keepTemp ? tempRoot : undefined,
        },
        null,
        2,
      ),
    );
  } finally {
    if (!args.keepTemp) await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
