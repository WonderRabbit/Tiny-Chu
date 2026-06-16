import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeBundleTemplate(bundleDir, version, tarballName) {
  const templatePackagePath = path.join(bundleDir, "templates", "opencode", "package.json");
  const templatePackage = await readJson(templatePackagePath);
  templatePackage.dependencies = { "tiny-chu": `file:./vendor/${tarballName}` };
  await writeJson(templatePackagePath, templatePackage);

  await writeFile(
    path.join(bundleDir, "README-offline.md"),
    `# Tiny-Chu Offline Bundle

Version: ${version}

Install into a target project:

\`\`\`bash
./install-offline.sh /path/to/target-project
\`\`\`

The installer copies the OpenCode shim into \`.opencode/\`, places \`${tarballName}\` under \`.opencode/vendor/\`, and runs npm with \`--offline\`.

Tiny-Chu is licensed under Apache-2.0. See \`LICENSE\` in this offline bundle and inside the packaged tarball.
    `,
  );
}

export async function writeInstallers(bundleDir, tarballName) {
  const shellPath = path.join(bundleDir, "install-offline.sh");
  await writeFile(shellPath, shellInstaller(tarballName));
  await chmod(shellPath, 0o755);
  await writeFile(path.join(bundleDir, "install-offline.ps1"), powershellInstaller(tarballName));
}

function shellInstaller(tarballName) {
  return `#!/usr/bin/env bash
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
}

function powershellInstaller(tarballName) {
  return `param(
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
}
