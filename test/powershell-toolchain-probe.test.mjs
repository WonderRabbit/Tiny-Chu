import assert from "node:assert/strict";
import test from "node:test";
import { createPowerShellToolchainProbe } from "../dist/index.js";

function fakeRunner(results) {
  return async (_command, args) => {
    const key = args.join(" ");
    const value = results[key] ?? results.default;
    if (!value) return { status: "missing", command: "pwsh", args, exitCode: null, stdout: "", stderr: "", timedOut: false };
    return value;
  };
}

test("powershell_toolchain_probe reports unavailable without throwing when pwsh is missing", async () => {
  // Given: a runner that cannot find pwsh.
  const runner = fakeRunner({});

  // When: the probe runs.
  const result = await createPowerShellToolchainProbe({ runner });

  // Then: the result is degraded and actionable.
  assert.equal(result.status, "unavailable");
  assert.ok(result.checks.some((check) => check.name === "discovery" && check.status === "unavailable"));
  assert.match(result.remediation.join("\n"), /PowerShell|pwsh/);
});

test("powershell_toolchain_probe verifies version cwd utf8 json nonzero and encoded command", async () => {
  // Given: a runner with successful probe outputs.
  const ok = { status: "ok", command: "pwsh", args: [], exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
  const runner = fakeRunner({
    "-NoLogo -NoProfile -Command $PSVersionTable.PSVersion.ToString()": { ...ok, stdout: "7.6.2\n" },
    "-NoLogo -NoProfile -Command (Get-Location).Path": { ...ok, stdout: "/tmp\n" },
    "-NoLogo -NoProfile -Command [Console]::OutputEncoding.WebName": { ...ok, stdout: "utf-8\n" },
    "-NoLogo -NoProfile -Command @{ok=$true; value='한글'} | ConvertTo-Json -Compress": { ...ok, stdout: "{\"ok\":true,\"value\":\"한글\"}\n" },
    "-NoLogo -NoProfile -Command Write-Error 'expected'; exit 7": { ...ok, exitCode: 7, stderr: "expected\n" },
    "-NoLogo -NoProfile -EncodedCommand VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAnAGUAbgBjAG8AZABlAGQAJwA=": { ...ok, stdout: "encoded\n" },
  });

  // When: the probe runs.
  const result = await createPowerShellToolchainProbe({ runner });

  // Then: every behavioral check passes.
  assert.equal(result.status, "ready");
  assert.deepEqual(result.checks.map((check) => check.status), ["ready", "ready", "ready", "ready", "ready", "ready"]);
});

test("powershell_toolchain_probe reports timeout and invalid json as degraded", async () => {
  // Given: a runner with timeout and bad JSON behaviors.
  const ok = { status: "ok", command: "pwsh", args: [], exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
  const runner = fakeRunner({
    "-NoLogo -NoProfile -Command $PSVersionTable.PSVersion.ToString()": { ...ok, stdout: "7.6.2\n" },
    "-NoLogo -NoProfile -Command (Get-Location).Path": { ...ok, stdout: "/tmp\n" },
    "-NoLogo -NoProfile -Command [Console]::OutputEncoding.WebName": { ...ok, stdout: "utf-8\n" },
    "-NoLogo -NoProfile -Command @{ok=$true; value='한글'} | ConvertTo-Json -Compress": { ...ok, stdout: "not-json\n" },
    "-NoLogo -NoProfile -Command Write-Error 'expected'; exit 7": { ...ok, exitCode: 7, stderr: "expected\n" },
    "-NoLogo -NoProfile -EncodedCommand VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAnAGUAbgBjAG8AZABlAGQAJwA=": { ...ok, status: "timeout", exitCode: null, stdout: "", timedOut: true },
  });

  // When: the probe runs.
  const result = await createPowerShellToolchainProbe({ runner });

  // Then: the probe degrades deterministically.
  assert.equal(result.status, "degraded");
  assert.ok(result.checks.some((check) => check.name === "json-roundtrip" && check.status === "degraded"));
  assert.ok(result.checks.some((check) => check.name === "encoded-command" && check.status === "degraded"));
});
