import path from "node:path";
import { realpath } from "node:fs/promises";

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/;

function isWindowsAbsolute(filePath: string): boolean {
  return WINDOWS_ABSOLUTE.test(filePath);
}

function isSafeRelative(relative: string): boolean {
  return relative === "" || !(relative === ".." || relative.startsWith("../") || relative.startsWith("..\\") || WINDOWS_ABSOLUTE.test(relative));
}

export function resolvePathInsideRoot(root: string, candidate: string): string | undefined {
  if (isWindowsAbsolute(root) || isWindowsAbsolute(candidate)) {
    const absoluteRoot = path.win32.resolve(root);
    const absoluteCandidate = path.win32.resolve(absoluteRoot, candidate);
    const relative = path.win32.relative(absoluteRoot, absoluteCandidate);
    return isSafeRelative(relative) ? absoluteCandidate : undefined;
  }
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  return isSafeRelative(relative) ? absoluteCandidate : undefined;
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  return resolvePathInsideRoot(root, candidate) !== undefined;
}

export function isLexicallyInsideRoot(root: string, candidate: string): boolean {
  return resolvePathInsideRoot(root, candidate) !== undefined;
}

export async function resolveExistingPathInsideRoot(root: string, candidate: string): Promise<string | undefined> {
  const lexical = resolvePathInsideRoot(root, candidate);
  if (!lexical) return undefined;
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(lexical)]);
  const relative = path.relative(realRoot, realCandidate);
  return isSafeRelative(relative) ? realCandidate : undefined;
}
