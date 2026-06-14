# Tiny-Chu Installation Guide

This is the canonical A-Z install guide for Tiny-Chu. Use it when you need a local developer install, a closed-network install, or an internal registry rollout for OpenCode projects.

Tiny-Chu's closed-network install path uses local OpenCode plugin files plus a local package dependency under the target project's `.opencode/` directory. Do not rely on OpenCode startup-time npm plugin download for air-gapped environments.

## Prerequisites

Supported runtime:

- Node.js `>=20.18.0`
- npm from the selected Node.js distribution
- OpenCode with project-local plugin loading enabled
- Bash for `install-offline.sh` on macOS/Linux, or PowerShell 7+ for `install-offline.ps1` on Windows

For PowerShell sessions, prefer single quotes around paths or commands that contain `$`, `{}`, `[]`, or `|`. Set native argument passing explicitly when troubleshooting:

```powershell
$PSNativeCommandArgumentPassing = 'Standard'
```

## Choose An Install Path

| Path | Use when | Network requirement in target project |
| --- | --- | --- |
| offline bundle | The target project is in a closed network or has no registry access. | None after the release asset download is copied in. |
| internal registry | Your organization mirrors npm packages into Verdaccio, Artifactory, Nexus, GitHub Packages, or another registry. | Access to the internal registry. |
| developer local checkout | You are developing Tiny-Chu itself or testing local source changes. | Access to the local source checkout and its dependencies. |

The offline bundle is the preferred end-user closed-network install path. The developer source checkout path is intentionally not the primary air-gap story because a source checkout can drift from built release assets.

## Release Asset Download

Before entering the closed network, download the Tiny-Chu release assets from the release page:

- `tiny-chu-offline-vX.Y.Z.tar.gz`
- checksum file, usually `SHA256SUMS`
- optional provenance, SBOM, or source archive files required by your organization

The offline bundle contains:

```text
tiny-chu-offline-vX.Y.Z/
  manifest.json
  SHA256SUMS
  install-offline.sh
  install-offline.ps1
  README-offline.md
  vendor/
    tiny-chu-vX.Y.Z-bundled.tgz
  templates/
    opencode/
      package.json
      plugins/
        tiny-chu.ts
```

Verify the release asset before copying it into the target network:

```bash
sha256sum -c SHA256SUMS
```

On macOS, use:

```bash
shasum -a 256 -c SHA256SUMS
```

## Build-Machine Preparation

Maintainers can build and verify a new offline bundle on an internet-connected release machine:

```bash
git clone <tiny-chu-repository-url>
cd Tiny-Chu
npm install
npm test
npm run release:offline -- --out /tmp/tiny-chu-release
npm run verify:offline -- --bundle /tmp/tiny-chu-release/tiny-chu-offline-vX.Y.Z.tar.gz
```

The release version must come from `package.json.version`. Do not type a separate version into installer scripts or docs for a release build.

The release verifier should install into a fresh temporary `.opencode` consumer, use an empty npm cache, and set a dead registry such as `npm_config_registry=http://127.0.0.1:9/` so accidental network fallback cannot look like an offline success.

## Closed-Network Installation

Copy `tiny-chu-offline-vX.Y.Z.tar.gz` into the closed network, then unpack it near or inside the target project:

```bash
tar -xzf tiny-chu-offline-vX.Y.Z.tar.gz
```

Create the target OpenCode package layout:

```bash
mkdir -p target-project/.opencode
cp -R tiny-chu-offline-vX.Y.Z/templates/opencode/. target-project/.opencode/
mkdir -p target-project/.opencode/vendor
cp tiny-chu-offline-vX.Y.Z/vendor/tiny-chu-vX.Y.Z-bundled.tgz target-project/.opencode/vendor/
```

The target project should now look like this:

```text
target-project/
  .opencode/
    package.json
    plugins/
      tiny-chu.ts
    vendor/
      tiny-chu-vX.Y.Z-bundled.tgz
```

Install from inside `.opencode`:

```bash
cd target-project/.opencode
npm install --offline --cache /tmp/tiny-chu-empty-cache --ignore-scripts --no-audit --fund=false
```

If your bundle includes installer scripts, you can use them instead of the manual copy/install steps:

```bash
./install-offline.sh /path/to/target-project
```

```powershell
.\install-offline.ps1 -TargetProject C:\path\to\target-project
```

## OpenCode Shim

Tiny-Chu is loaded through a project-local OpenCode plugin shim, not through a runtime plugin download.

`target-project/.opencode/package.json` should use the local tarball dependency:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "tiny-chu": "file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz"
  }
}
```

`target-project/.opencode/plugins/tiny-chu.ts` should export the OpenCode adapter from the package subpath:

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "tiny-chu/opencode";
```

The copyable templates in `templates/opencode/` use the same shape. Replace `X.Y.Z` with the release version or with the bundled tarball filename shipped in your release asset.

## Internal Registry Alternative

Use this path when the closed network has an approved internal registry and Tiny-Chu plus its production dependencies are mirrored there.

```bash
cd target-project/.opencode
npm config set registry http://internal-registry.example/npm/
npm install tiny-chu@X.Y.Z --ignore-scripts --no-audit --fund=false
```

Then keep the same local plugin shim:

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "tiny-chu/opencode";
```

For registry installs, `.opencode/package.json` can pin the registry version:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "tiny-chu": "X.Y.Z"
  }
}
```

## Developer Source Install

Use this only for Tiny-Chu development or local source testing:

```bash
git clone <tiny-chu-repository-url>
cd Tiny-Chu
npm install
npm run build
npm test
```

In a separate target project, point `.opencode/package.json` at the local checkout:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "tiny-chu": "file:/absolute/path/to/Tiny-Chu"
  }
}
```

This developer path is useful for fast iteration, but it is not the preferred closed-network release install because it depends on the local checkout state.

## Verification

After installation, run a package import smoke test from `target-project/.opencode`:

```bash
node --input-type=module -e "import { createTinyChuPlugin } from 'tiny-chu'; console.log(typeof createTinyChuPlugin)"
node --input-type=module -e "import { TinyChuOpenCodePlugin } from 'tiny-chu/opencode'; console.log(typeof TinyChuOpenCodePlugin)"
```

Both commands should print `function`.

To inspect Tiny-Chu's own install metadata:

```bash
node --input-type=module -e "import { createTinyChuPlugin } from 'tiny-chu'; const tiny=createTinyChuPlugin({ root: process.cwd() }); console.log(await tiny.tools.tiny_chu_install_check({}));"
```

Expected OpenCode startup behavior:

- OpenCode starts from the target project root.
- OpenCode discovers `.opencode/plugins/tiny-chu.ts`.
- The shim imports `TinyChuOpenCodePlugin` from `tiny-chu/opencode`.
- Tiny-Chu tools, including `tiny_chu_install_check`, are exposed in the OpenCode tool list.

## Troubleshooting

### `ENOTCACHED` During `npm install --offline`

`ENOTCACHED` means npm needed a package that was not present in the offline cache or local tarball dependency. For the offline bundle path, check that:

- `.opencode/package.json` points to `file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz`.
- The bundled tarball exists under `.opencode/vendor/`.
- You are installing from inside `.opencode`.
- You are using the release offline bundle, not a normal source package tarball without bundled dependencies.

### Stale `dist`

If package imports fail after a developer source install, rebuild Tiny-Chu:

```bash
npm run build
```

Do not trust an old generated `dist/` directory when packaging or testing a release.

### Node Or npm Version Mismatch

Check versions:

```bash
node --version
npm --version
```

Use Node.js `>=20.18.0`. If npm behavior differs across machines, rebuild and verify the release bundle with the same Node/npm family used by the target environment.

### PowerShell Quoting

Prefer single quotes around Node one-liners and paths that contain special characters. When a native command receives split or rewritten arguments, set:

```powershell
$PSNativeCommandArgumentPassing = 'Standard'
```

### Permission Or Cache Errors

Use a writable npm cache owned by the current user:

```bash
npm install --offline --cache /tmp/tiny-chu-empty-cache --ignore-scripts --no-audit --fund=false
```

On Windows, choose a writable cache directory outside protected system paths:

```powershell
npm install --offline --cache "$env:TEMP\tiny-chu-empty-cache" --ignore-scripts --no-audit --fund=false
```

If permissions still fail, remove only the temporary cache directory you created for this install and rerun the command. Do not remove shared npm caches or unrelated project state.
