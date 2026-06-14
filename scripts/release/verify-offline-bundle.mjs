#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const maxBuffer = 1024 * 1024 * 32;

function parseArgs(argv) {
  const parsed = { bundle: undefined, keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--bundle requires an archive path");
      parsed.bundle = path.resolve(value);
      index += 1;
    } else if (arg === "--keep-temp") {
      parsed.keepTemp = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (parsed.bundle === undefined) throw new Error("usage: npm run verify:offline -- --bundle /path/to/tiny-chu-offline-vX.Y.Z.tar.gz");
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function findBundleDir(tempRoot) {
  const entries = await readdir(tempRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("tiny-chu-offline-v"));
  if (dirs.length !== 1) throw new Error(`expected one unpacked tiny-chu-offline directory, found ${dirs.length}`);
  return path.join(tempRoot, dirs[0].name);
}

async function prepareConsumer(bundleDir, tempRoot, manifest) {
  const consumerRoot = path.join(tempRoot, "consumer");
  const opencodeDir = path.join(consumerRoot, ".opencode");
  const vendorDir = path.join(opencodeDir, "vendor");
  const tarballName = path.basename(manifest.packageTarball);

  await mkdir(vendorDir, { recursive: true });
  await cp(path.join(bundleDir, "templates", "opencode"), opencodeDir, { recursive: true });
  await cp(path.join(bundleDir, manifest.packageTarball), path.join(vendorDir, tarballName));

  const packageJsonPath = path.join(opencodeDir, "package.json");
  const packageJson = await readJson(packageJsonPath);
  packageJson.dependencies = { "tiny-chu": `file:./vendor/${tarballName}` };
  await writeJson(packageJsonPath, packageJson);
  return { consumerRoot, opencodeDir, tarballName };
}

async function runSmoke(opencodeDir) {
  const smoke = `
import { createTinyChuPlugin } from "tiny-chu";
import { TinyChuOpenCodePlugin } from "tiny-chu/opencode";
const root = process.cwd();
const tiny = createTinyChuPlugin({ root });
const install = await tiny.tools.tiny_chu_install_check({});
const hooks = await TinyChuOpenCodePlugin({
  project: { root },
  directory: root,
  worktree: root,
  client: { app: { log: async () => undefined } },
  $: async () => undefined
});
console.log(JSON.stringify({
  createTinyChuPlugin: typeof createTinyChuPlugin,
  TinyChuOpenCodePlugin: typeof TinyChuOpenCodePlugin,
  packageName: install.packageName,
  installDocs: install.installDocs,
  installModes: install.installModes,
  toolCount: Object.keys(tiny.tools).length,
  opencodeToolCount: Object.keys(hooks.tool).length
}));
`;
  const result = await execFileAsync("node", ["--input-type=module", "-e", smoke], { cwd: opencodeDir, maxBuffer });
  const parsed = JSON.parse(result.stdout.trim());
  if (parsed.createTinyChuPlugin !== "function") throw new Error("root package import did not expose createTinyChuPlugin");
  if (parsed.TinyChuOpenCodePlugin !== "function") throw new Error("opencode subpath import did not expose TinyChuOpenCodePlugin");
  if (parsed.packageName !== "tiny-chu") throw new Error("install check returned the wrong package name");
  if (parsed.installDocs !== "INSTALL.md") throw new Error("install check did not expose INSTALL.md");
  if (!Array.isArray(parsed.installModes) || !parsed.installModes.includes("offline-bundle")) {
    throw new Error("install check did not expose offline-bundle mode");
  }
  if (parsed.toolCount !== parsed.opencodeToolCount) throw new Error("direct and OpenCode tool counts diverged");
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-offline-verify-"));
  try {
    await execFileAsync("tar", ["-xzf", args.bundle, "-C", tempRoot], { maxBuffer });
    const bundleDir = await findBundleDir(tempRoot);
    const manifest = await readJson(path.join(bundleDir, "manifest.json"));
    const consumer = await prepareConsumer(bundleDir, tempRoot, manifest);
    const emptyCache = path.join(tempRoot, "empty-npm-cache");
    await mkdir(emptyCache, { recursive: true });

    const install = await execFileAsync(
      "npm",
      ["install", "--offline", "--cache", emptyCache, "--ignore-scripts", "--no-audit", "--fund=false"],
      {
        cwd: consumer.opencodeDir,
        env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/", npm_config_audit: "false", npm_config_fund: "false" },
        maxBuffer,
      },
    );
    const smoke = await runSmoke(consumer.opencodeDir);

    console.log(
      JSON.stringify(
        {
          bundle: args.bundle,
          version: manifest.version,
          tarball: consumer.tarballName,
          installStdout: install.stdout.trim(),
          smoke,
          tempRoot: args.keepTemp ? tempRoot : undefined,
          cleanup: args.keepTemp ? "kept" : "removed",
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
