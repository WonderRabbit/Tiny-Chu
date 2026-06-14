import { readFile } from "node:fs/promises";
import path from "node:path";
import { runNativeCommand, type NativeRunner } from "./native-runner.js";
import { boundedText, SAFE_TOOLING_LIMITS } from "./safe-tooling.js";

export type DiagnosticsStatus = "passed" | "failed" | "degraded";

export interface DiagnosticsCommandResult {
  readonly commandLine: string;
  readonly exitCode: number | null;
  readonly status: DiagnosticsStatus;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunDiagnosticsResult {
  readonly status: DiagnosticsStatus;
  readonly gatesMutation: false;
  readonly recommendedBeforePublish: true;
  readonly commands: readonly DiagnosticsCommandResult[];
  readonly diagnostics: readonly string[];
}

export interface RunDiagnosticsInput {
  readonly runner?: NativeRunner;
  readonly timeoutMs?: number;
}

interface PackageJsonShape {
  readonly scripts?: Readonly<Record<string, string>>;
}

async function readPackageJson(root: string): Promise<PackageJsonShape | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch (error) {
    return undefined;
  }
}

function commandFor(script: "build" | "test"): { readonly commandLine: string; readonly command: string; readonly args: readonly string[] } {
  return script === "build"
    ? { commandLine: "npm run build", command: "npm", args: ["run", "build"] }
    : { commandLine: "npm test", command: "npm", args: ["test"] };
}

export async function createRunDiagnostics(root: string, input: RunDiagnosticsInput = {}): Promise<RunDiagnosticsResult> {
  const packageJson = await readPackageJson(root);
  if (!packageJson) {
    return {
      status: "degraded",
      gatesMutation: false,
      recommendedBeforePublish: true,
      commands: [],
      diagnostics: ["package.json is missing or malformed."],
    };
  }
  const runner = input.runner ?? runNativeCommand;
  const scripts = packageJson.scripts ?? {};
  const scriptNames = (["build", "test"] as const).filter((script) => typeof scripts[script] === "string");
  if (scriptNames.length === 0) {
    return {
      status: "degraded",
      gatesMutation: false,
      recommendedBeforePublish: true,
      commands: [],
      diagnostics: ["No build or test scripts are defined."],
    };
  }
  const commands: DiagnosticsCommandResult[] = [];
  for (const script of scriptNames) {
    const command = commandFor(script);
    const result = await runner(command.command, command.args, {
      cwd: root,
      timeoutMs: input.timeoutMs ?? SAFE_TOOLING_LIMITS.diagnosticsCommandTimeoutMs,
    });
    commands.push({
      commandLine: command.commandLine,
      exitCode: result.exitCode,
      status: result.status === "ok" && result.exitCode === 0 ? "passed" : "failed",
      stdout: boundedText(result.stdout),
      stderr: boundedText(result.stderr),
    });
  }
  return {
    status: commands.every((command) => command.status === "passed") ? "passed" : "failed",
    gatesMutation: false,
    recommendedBeforePublish: true,
    commands,
    diagnostics: [],
  };
}
