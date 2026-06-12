declare const process: {
  cwd(): string;
  pid: number;
};

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
    win32: {
      resolve(...paths: string[]): string;
      relative(from: string, to: string): string;
    };
  };
  export default path;
}

declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function access(path: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function realpath(path: string): Promise<string>;
  export function symlink(target: string, path: string): Promise<void>;
  export function writeFile(path: string, data: string, encoding?: "utf8"): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
}
