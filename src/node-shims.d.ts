declare const process: {
  cwd(): string;
  pid: number;
  platform: string;
  env: Record<string, string | undefined>;
};

declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(timeout: unknown): void;
declare function setInterval(callback: () => void, ms: number): unknown;
declare function clearInterval(timeout: unknown): void;

declare class Buffer extends Uint8Array {
  static byteLength(value: string, encoding?: "utf8"): number;
  static from(value: string): Buffer;
}

declare class URL {
  constructor(input: string, base?: string);
  protocol: string;
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
}

declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string;
  }
}

declare module "node:path" {
  const path: {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
    dirname(path: string): string;
    basename(path: string): string;
    relative(from: string, to: string): string;
    extname(path: string): string;
    isAbsolute(path: string): boolean;
    win32: {
      resolve(...paths: string[]): string;
      relative(from: string, to: string): string;
    };
  };
  export default path;
}

declare module "node:os" {
  const os: {
    tmpdir(): string;
    hostname(): string;
  };
  export default os;
}

declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): {
      digest(encoding: "hex"): string;
    };
  };
}

declare module "node:child_process" {
  interface ChildProcessLike {
    stdout: { setEncoding(encoding: "utf8"): void; on(event: "data", callback: (chunk: string) => void): void };
    stderr: { setEncoding(encoding: "utf8"): void; on(event: "data", callback: (chunk: string) => void): void };
    stdin: { end(data?: string): void };
    kill(signal: "SIGTERM"): void;
    on(event: "error", callback: (error: NodeJS.ErrnoException) => void): void;
    on(event: "close", callback: (code: number | null) => void): void;
  }
  export function execFile(
    file: string,
    args: readonly string[],
    options: { timeout?: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): void;
  export function spawn(
    file: string,
    args: readonly string[],
    options: { cwd?: string; shell?: boolean; env?: Record<string, string | undefined>; stdio?: readonly ["pipe", "pipe", "pipe"] },
  ): ChildProcessLike;
}

declare module "node:http" {
  export interface IncomingMessage {
    readonly statusCode?: number;
    setEncoding(encoding: "utf8"): void;
    destroy(error?: Error): void;
    on(event: "data", callback: (chunk: string) => void): void;
    on(event: "error", callback: (error: Error) => void): void;
    on(event: "end", callback: () => void): void;
  }
  export interface ClientRequest {
    on(event: "timeout", callback: () => void): void;
    on(event: "error", callback: (error: Error) => void): void;
    destroy(error?: Error): void;
    end(): void;
  }
  const http: {
    request(url: URL, options: { method: "GET"; timeout: number }, callback: (response: IncomingMessage) => void): ClientRequest;
  };
  export default http;
}

declare module "node:https" {
  import type { ClientRequest, IncomingMessage } from "node:http";
  const https: {
    request(url: URL, options: { method: "GET"; timeout: number }, callback: (response: IncomingMessage) => void): ClientRequest;
  };
  export default https;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function lstatSync(path: string): { isSymbolicLink(): boolean; isDirectory(): boolean };
}

declare module "node:fs/promises" {
  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function access(path: string): Promise<void>;
  export function copyFile(source: string, target: string): Promise<void>;
  export function lstat(path: string): Promise<{ mtimeMs: number; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readFile(path: string): Promise<Buffer>;
  export function realpath(path: string): Promise<string>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function stat(path: string): Promise<{ mtimeMs: number; size: number }>;
  export function utimes(path: string, atime: Date, mtime: Date): Promise<void>;
  export function symlink(target: string, path: string): Promise<void>;
  export function writeFile(path: string, data: string | Uint8Array, encoding?: "utf8"): Promise<void>;
  export function appendFile(path: string, data: string, encoding?: "utf8"): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
}
