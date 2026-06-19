#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const maxBuffer = 1024 * 1024 * 16;

function usage() {
  return `Usage:
  tiny-chu install [target-project] [--package-spec <spec>] [--skip-npm-install] [--force]

Examples:
  tiny-chu install
  tiny-chu install /path/to/project
  tiny-chu install --package-spec file:/path/to/tiny-chu-0.1.0.tgz
`;
}

function parseArgs(argv) {
  const parsed = {
    command: undefined,
    targetProject: ".",
    packageSpec: undefined,
    skipNpmInstall: false,
    force: false,
  };
  const rest = [...argv];
  parsed.command = rest.shift();
  if (parsed.command === "--help" || parsed.command === "-h") parsed.command = "help";
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      parsed.command = "help";
      continue;
    }
    if (arg === "--skip-npm-install") {
      parsed.skipNpmInstall = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--package-spec") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--package-spec requires a value");
      parsed.packageSpec = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--package-spec=")) {
      parsed.packageSpec = arg.slice("--package-spec=".length);
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    parsed.targetProject = arg;
  }
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyTemplateFile(source, target, force) {
  if (!force && (await exists(target))) return "kept";
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { force: true });
  return "written";
}

async function writeOpenCodePackage(packagePath, packageSpec) {
  const current = (await exists(packagePath)) ? await readJson(packagePath) : {};
  const dependencies = { ...(current.dependencies ?? {}), "tiny-chu": packageSpec };
  const next = {
    ...current,
    private: current.private ?? true,
    type: current.type ?? "module",
    dependencies,
  };
  await writeJson(packagePath, next);
}

function pathApiForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function resolveNpmExecPath(npmExecPath, cwd, platform) {
  const pathApi = pathApiForPlatform(platform);
  return pathApi.isAbsolute(npmExecPath) ? npmExecPath : pathApi.resolve(cwd, npmExecPath);
}

function npmInvocation(cwd) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath !== undefined && npmExecPath.length > 0) {
    return {
      command: process.execPath,
      argsPrefix: [resolveNpmExecPath(npmExecPath, cwd, process.platform)],
      shell: false,
    };
  }
  if (process.platform === "win32") return { command: "npm.cmd", argsPrefix: [], shell: true };
  return { command: "npm", argsPrefix: [], shell: false };
}

async function runNpmInstall(openCodeDir) {
  const invocation = npmInvocation(openCodeDir);
  await execFileAsync(
    invocation.command,
    [...invocation.argsPrefix, "install", "--ignore-scripts", "--no-audit", "--fund=false"],
    {
      cwd: openCodeDir,
      shell: invocation.shell,
      maxBuffer,
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
    },
  );
}

async function install(argv) {
  const args = parseArgs(argv);
  if (args.command === "help" || args.command === undefined) {
    console.log(usage());
    return;
  }
  if (args.command !== "install") throw new Error(`unknown command: ${args.command}\n\n${usage()}`);

  const packageJson = await readJson(path.join(packageRoot, "package.json"));
  const packageSpec = args.packageSpec ?? packageJson.version;
  const targetProject = path.resolve(args.targetProject);
  const openCodeDir = path.join(targetProject, ".opencode");
  const templateDir = path.join(packageRoot, "templates", "opencode");
  const pluginsDir = path.join(openCodeDir, "plugins");

  await mkdir(pluginsDir, { recursive: true });
  const packageStatus = "written";
  await writeOpenCodePackage(path.join(openCodeDir, "package.json"), packageSpec);
  const serverShimStatus = await copyTemplateFile(
    path.join(templateDir, "plugins", "tiny-chu.ts"),
    path.join(pluginsDir, "tiny-chu.ts"),
    args.force,
  );
  const tuiShimStatus = await copyTemplateFile(
    path.join(templateDir, "plugins", "tiny-chu-tui.ts"),
    path.join(pluginsDir, "tiny-chu-tui.ts"),
    args.force,
  );
  const tuiStatus = await copyTemplateFile(path.join(templateDir, "tui.json"), path.join(openCodeDir, "tui.json"), args.force);

  if (!args.skipNpmInstall) await runNpmInstall(openCodeDir);

  console.log(`Tiny-Chu installed in ${openCodeDir}`);
  console.log(`package.json: ${packageStatus}`);
  console.log(`plugins/tiny-chu.ts: ${serverShimStatus}`);
  console.log(`plugins/tiny-chu-tui.ts: ${tuiShimStatus}`);
  console.log(`tui.json: ${tuiStatus}`);
  console.log(args.skipNpmInstall ? "npm install: skipped" : "npm install: done");
}

install(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
