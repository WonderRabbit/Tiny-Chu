import { spawn } from "node:child_process";

export type NativeCommandStatus = "ok" | "missing" | "timeout" | "error";

export interface NativeCommandResult {
  readonly status: NativeCommandStatus;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type NativeRunner = (command: string, args: readonly string[], options?: NativeRunOptions) => Promise<NativeCommandResult>;

export interface NativeRunOptions {
  readonly cwd?: string;
  readonly input?: string;
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export const NATIVE_RUNNER_LIMITS = {
  timeoutMs: 10_000,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
} as const;

function appendBounded(current: string, chunk: string, maxBytes: number): string {
  const combined = current + chunk;
  return Buffer.byteLength(combined, "utf8") <= maxBytes ? combined : combined.slice(0, maxBytes);
}

export function runNativeCommand(command: string, args: readonly string[], options: NativeRunOptions = {}): Promise<NativeCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      shell: false,
      env: {
        ...process.env,
        NO_COLOR: "1",
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      resolve({
        status: "timeout",
        command,
        args,
        exitCode: null,
        stdout,
        stderr,
        timedOut: true,
      });
    }, options.timeoutMs ?? NATIVE_RUNNER_LIMITS.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendBounded(stdout, chunk, options.maxStdoutBytes ?? NATIVE_RUNNER_LIMITS.maxStdoutBytes);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendBounded(stderr, chunk, options.maxStderrBytes ?? NATIVE_RUNNER_LIMITS.maxStderrBytes);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: "code" in error && error.code === "ENOENT" ? "missing" : "error",
        command,
        args,
        exitCode: null,
        stdout,
        stderr: error.message,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: "ok",
        command,
        args,
        exitCode: code,
        stdout,
        stderr,
        timedOut: false,
      });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
