#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  const requiredPaths = ["dist", "README.md", "HOW_TO_USE.md", "INSTALL.md", "templates", "package-lock.json"];
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
    engines: packageJson.engines,
    exports: packageJson.exports,
    files: packageJson.files,
    dependencies: packageJson.dependencies,
    bundleDependencies: true,
  };
  await writeJson(path.join(stagingDir, "package.json"), releasePackageJson);
}

async function installProductionDependencies(stagingDir) {
  const cacheDir = process.env.npm_config_cache ?? path.join(os.tmpdir(), "tiny-chu-release-npm-cache");
  try {
    await execFileAsync(
      "npm",
      ["install", "--omit=dev", "--cache", cacheDir, "--ignore-scripts", "--no-audit", "--fund=false"],
      {
        cwd: stagingDir,
        env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
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

async function writeBundleTemplate(bundleDir, version, tarballName) {
  const templatePackagePath = path.join(bundleDir, "templates", "opencode", "package.json");
  const templatePackage = await readJson(templatePackagePath);
  templatePackage.dependencies = { "tiny-chu": `file:./vendor/${tarballName}` };
  await writeJson(templatePackagePath, templatePackage);

  const readme = `# Tiny-Chu Offline Bundle

Version: ${version}

Install into a target project:

\`\`\`bash
./install-offline.sh /path/to/target-project
\`\`\`

The installer copies the OpenCode shim into \`.opencode/\`, places \`${tarballName}\` under \`.opencode/vendor/\`, and runs npm with \`--offline\`.
`;
  await writeFile(path.join(bundleDir, "README-offline.md"), readme);
}

async function writeInstallers(bundleDir, tarballName) {
  const shellInstaller = `#!/usr/bin/env bash
set -euo pipefail

TARGET_PROJECT="\${1:-}"
if [ -z "\${TARGET_PROJECT}" ]; then
  echo "usage: ./install-offline.sh /path/to/target-project" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
OPENCODE_DIR="\${TARGET_PROJECT}/.opencode"
CACHE_DIR="\${TMPDIR:-/tmp}/tiny-chu-offline-npm-cache"

mkdir -p "\${OPENCODE_DIR}"
cp -R "\${SCRIPT_DIR}/templates/opencode/." "\${OPENCODE_DIR}/"
mkdir -p "\${OPENCODE_DIR}/vendor"
cp "\${SCRIPT_DIR}/vendor/${tarballName}" "\${OPENCODE_DIR}/vendor/${tarballName}"

cd "\${OPENCODE_DIR}"
npm install --offline --cache "\${CACHE_DIR}" --ignore-scripts --no-audit --fund=false
`;
  const powershellInstaller = `param(
  [Parameter(Mandatory = $true)]
  [string]$TargetProject
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OpenCodeDir = Join-Path $TargetProject '.opencode'
$VendorDir = Join-Path $OpenCodeDir 'vendor'
$CacheDir = Join-Path ([System.IO.Path]::GetTempPath()) 'tiny-chu-offline-npm-cache'

New-Item -ItemType Directory -Force -Path $OpenCodeDir | Out-Null
Copy-Item -Recurse -Force -Path (Join-Path $ScriptDir 'templates/opencode/*') -Destination $OpenCodeDir
New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null
Copy-Item -Force -Path (Join-Path $ScriptDir 'vendor/${tarballName}') -Destination (Join-Path $VendorDir '${tarballName}')

Push-Location $OpenCodeDir
try {
  npm install --offline --cache $CacheDir --ignore-scripts --no-audit --fund=false
} finally {
  Pop-Location
}
`;
  const shellPath = path.join(bundleDir, "install-offline.sh");
  await writeFile(shellPath, shellInstaller);
  await chmod(shellPath, 0o755);
  await writeFile(path.join(bundleDir, "install-offline.ps1"), powershellInstaller);
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

  try {
    await execFileAsync("npm", ["run", "build"], { cwd: repoRoot, maxBuffer });
    await mkdir(args.out, { recursive: true });
    await mkdir(stagingDir, { recursive: true });
    await mkdir(path.join(bundleDir, "vendor"), { recursive: true });

    await copyReleaseInputs(stagingDir);
    await buildStagePackageJson(stagingDir, packageJson);
    await installProductionDependencies(stagingDir);

    const packResult = await execFileAsync("npm", ["pack", "--json", "--pack-destination", path.join(bundleDir, "vendor")], {
      cwd: stagingDir,
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
      maxBuffer,
    });
    const packed = JSON.parse(packResult.stdout);
    const generatedTarballName = packed[0]?.filename;
    if (typeof generatedTarballName !== "string") throw new Error("npm pack did not return a tarball filename");
    await rename(path.join(bundleDir, "vendor", generatedTarballName), path.join(bundleDir, "vendor", tarballName));

    await cp(path.join(repoRoot, "templates"), path.join(bundleDir, "templates"), { recursive: true });
    await writeBundleTemplate(bundleDir, version, tarballName);
    await writeInstallers(bundleDir, tarballName);

    const dependencyClosure = JSON.parse(
      (await execFileAsync("npm", ["ls", "--omit=dev", "--json"], { cwd: stagingDir, maxBuffer })).stdout,
    );
    const distHashes = {
      "dist/index.js": await hashFile(path.join(stagingDir, "dist", "index.js")),
      "dist/opencode/plugin.js": await hashFile(path.join(stagingDir, "dist", "opencode", "plugin.js")),
    };
    const manifest = {
      name: "tiny-chu-offline-bundle",
      packageName: packageJson.name,
      version,
      createdAt: new Date().toISOString(),
      node: process.version,
      npm: (await execFileAsync("npm", ["--version"], { cwd: repoRoot, maxBuffer })).stdout.trim(),
      packageTarball: `vendor/${tarballName}`,
      opencodeTemplate: "templates/opencode",
      opencodeDependency: `file:./vendor/${tarballName}`,
      installDocs: "INSTALL.md",
      dependencyStrategy: { bundleDependencies: true, materializedFrom: "staging-npm-install", omit: "dev" },
      dependencyClosure,
      distHashes,
      verifiedEntrypoints: [".", "./opencode"],
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
