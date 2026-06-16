import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveNpmInvocation, runNpm } from "../scripts/release/npm-runner.mjs";

async function makeTempDir(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeFakeNpmCli(filePath, source) {
  await writeFile(filePath, source, "utf8");
  return filePath;
}

test("resolveNpmInvocation prefers npm_execpath through process.execPath", () => {
  const invocation = resolveNpmInvocation({
    cwd: "/repo",
    env: { npm_execpath: "tools/npm-cli.js" },
    execPath: "/node/bin/node",
    platform: "linux",
  });

  assert.deepEqual(invocation.candidates[0], {
    source: "npm_execpath",
    command: "/node/bin/node",
    argsPrefix: ["/repo/tools/npm-cli.js"],
    shell: false,
    pathToCheck: "/repo/tools/npm-cli.js",
  });
});

test("resolveNpmInvocation falls back to npm on POSIX without a shell", () => {
  assert.deepEqual(
    resolveNpmInvocation({
      cwd: "/repo",
      env: {},
      execPath: "/node/bin/node",
      platform: "linux",
    }).candidates,
    [{ source: "posix-path-fallback", command: "npm", argsPrefix: [], shell: false }],
  );
});

test("resolveNpmInvocation tries Windows Node-install npm CLI candidates before npm.cmd", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const { candidates } = resolveNpmInvocation({
    cwd: "C:\\repo",
    env: {},
    execPath,
    platform: "win32",
  });

  assert.deepEqual(candidates[0], {
    source: "windows-node-cli",
    command: execPath,
    argsPrefix: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
    shell: false,
    pathToCheck: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
  });
  assert.deepEqual(candidates.at(-1), { source: "windows-shell-fallback", command: "npm.cmd", argsPrefix: [], shell: true });
});

test("runNpm uses npm_execpath when PATH cannot resolve npm", async (t) => {
  const root = await makeTempDir(t, "tiny-chu-npm-runner-");
  const emptyPathDir = path.join(root, "path-without-npm");
  const captureFile = path.join(root, "capture.json");
  const npmCli = await writeFakeNpmCli(
    path.join(root, "fake-npm-cli.mjs"),
    `
import { writeFile } from "node:fs/promises";
await writeFile(process.env.NPM_RUNNER_CAPTURE, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  custom: process.env.CUSTOM_VALUE,
  path: process.env.PATH
}));
console.log("fake npm " + process.argv.slice(2).join(" "));
`,
  );
  await mkdir(emptyPathDir);

  const result = await runNpm(["run", "build"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: emptyPathDir,
      npm_execpath: path.basename(npmCli),
      NPM_RUNNER_CAPTURE: captureFile,
      CUSTOM_VALUE: "seen",
    },
    maxBuffer: 1024,
  });

  assert.equal(result.stdout.trim(), "fake npm run build");
  const captured = JSON.parse(await readFile(captureFile, "utf8"));
  assert.deepEqual(captured.argv, ["run", "build"]);
  assert.equal(await realpath(captured.cwd), await realpath(root));
  assert.equal(captured.custom, "seen");
  assert.equal(captured.path, emptyPathDir);
});

test("runNpm forwards maxBuffer to execFile", async (t) => {
  const root = await makeTempDir(t, "tiny-chu-npm-runner-buffer-");
  const npmCli = await writeFakeNpmCli(
    path.join(root, "fake-npm-cli.mjs"),
    `
console.log("this output is longer than the configured buffer");
`,
  );

  await assert.rejects(
    () =>
      runNpm(["--version"], {
        cwd: root,
        env: { ...process.env, npm_execpath: npmCli },
        maxBuffer: 4,
      }),
    (error) => {
      assert.equal(error?.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      return true;
    },
  );
});

test("runNpm reports resolver context when npm_execpath and PATH are both unavailable", async (t) => {
  const root = await makeTempDir(t, "tiny-chu-npm-runner-missing-");
  const emptyPathDir = path.join(root, "path-without-npm");
  await mkdir(emptyPathDir);

  await assert.rejects(
    () =>
      runNpm(["--version"], {
        cwd: root,
        env: { ...process.env, PATH: emptyPathDir, npm_execpath: "missing/npm-cli.js" },
        maxBuffer: 1024,
      }),
    (error) => {
      assert.equal(error?.code, "ERR_TINY_CHU_NPM_NOT_FOUND");
      assert.match(error.message, /missing\/npm-cli\.js/);
      assert.match(error.message, /posix-path-fallback/);
      return true;
    },
  );
});
