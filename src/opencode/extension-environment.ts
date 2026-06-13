import { execFile } from "node:child_process";

export interface EnvironmentDoctorCheck {
  readonly name: string;
  readonly command: string;
  readonly status: "ok" | "missing" | "error";
  readonly version?: string;
  readonly required: boolean;
}

export interface EnvironmentDoctorResult {
  readonly overallStatus: "ready" | "degraded" | "blocked";
  readonly checks: readonly EnvironmentDoctorCheck[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly remediation: readonly string[];
}

const COMMANDS = [
  ["pwsh", "pwsh", true],
  ["node", "node", true],
  ["npm", "npm", true],
  ["opencode", "opencode", true],
  ["ollama", "ollama", true],
  ["ripgrep", "rg", false],
  ["fd", "fd", false],
  ["ast-grep", "ast-grep", false],
  ["jq", "jq", false],
  ["yq", "yq", false],
  ["mdq", "mdq", false],
  ["mermaid-cli", "mmdc", false],
] as const;

function timeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 800;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

function requestedToolNames(value: unknown): ReadonlySet<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.flatMap((item) => typeof item === "string" && item.trim() !== "" ? [item.trim().toLowerCase()] : []);
  return names.length > 0 ? new Set(names) : undefined;
}

async function checkCommand(name: string, command: string, required: boolean, timeout: number): Promise<EnvironmentDoctorCheck> {
  try {
    const result = await new Promise<{ readonly stdout: string; readonly stderr: string }>((resolve, reject) => {
      execFile(command, ["--version"], { timeout }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
    const version = `${result.stdout}${result.stderr}`.split(/\r?\n/).find((line) => line.trim() !== "")?.trim();
    return { name, command, status: "ok", ...(version ? { version } : {}), required };
  } catch (error) {
    const code = errorCode(error);
    return { name, command, status: code === "ENOENT" ? "missing" : "error", required };
  }
}

export async function createEnvironmentDoctor(input: Record<string, unknown>): Promise<EnvironmentDoctorResult> {
  const requested = requestedToolNames(input.toolNames);
  const commands = requested
    ? COMMANDS.filter(([name, command]) => requested.has(name.toLowerCase()) || requested.has(command.toLowerCase()))
    : COMMANDS;
  const checks = await Promise.all(commands.map(([name, command, required]) => checkCommand(name, command, required, timeoutMs(input.timeoutMs))));
  const blockers = checks.filter((check) => check.required && check.status !== "ok").map((check) => `${check.name} is ${check.status}`);
  const warnings = checks.filter((check) => !check.required && check.status !== "ok").map((check) => `${check.name} is ${check.status}`);
  return {
    overallStatus: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "degraded" : "ready",
    checks,
    blockers,
    warnings,
    remediation: [
      "Install missing tools outside Tiny-Chu, then rerun environment_doctor.",
      "Use PowerShell 7.6 with $PSNativeCommandArgumentPassing = 'Standard'.",
      "Do not rely on WSL, winget, choco, scoop, Windows Store, LM Studio, or external model services.",
    ],
  };
}
