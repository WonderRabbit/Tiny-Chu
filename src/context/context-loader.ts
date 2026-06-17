import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isLexicallyInsideRoot, portableRelative, resolveExistingPathInsideRoot } from "../state/path-safety.js";

export interface ContextDocument {
  kind: "agents" | "rule";
  path: string;
  content: string;
  precedence: number;
}

export interface ContextBundle {
  root: string;
  targetPath: string;
  documents: ContextDocument[];
  text: string;
}

const RULE_DIRS = [".tiny/rules", ".claude/rules", ".cursor/rules", ".github/instructions"] as const;
const RULE_FILES = [".github/copilot-instructions.md"] as const;

type MaybeSymlinkDirent = {
  readonly isFile: () => boolean;
  readonly isSymbolicLink?: () => boolean;
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isIgnorablePathError(error: unknown): boolean {
  return isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR") || isErrno(error, "EISDIR");
}

function isStatsFile(stats: object): boolean {
  return "isFile" in stats && typeof stats.isFile === "function" && stats.isFile() === true;
}

function isStatsDirectory(stats: object): boolean {
  return "isDirectory" in stats && typeof stats.isDirectory === "function" && stats.isDirectory() === true;
}

function isFileOrSymlink(entry: MaybeSymlinkDirent): boolean {
  return entry.isFile() || entry.isSymbolicLink?.() === true;
}

async function resolveDiscoveredPath(root: string, file: string): Promise<string | undefined> {
  if (!(await exists(file))) return undefined;
  return resolveExistingPathInsideRoot(root, file);
}

async function readDiscoveredFile(root: string, file: string): Promise<string | undefined> {
  const realFile = await resolveDiscoveredPath(root, file);
  if (!realFile) return undefined;
  try {
    if (!isStatsFile(await stat(realFile))) return undefined;
    return await readFile(realFile, "utf8");
  } catch (error) {
    if (isIgnorablePathError(error)) return undefined;
    throw error;
  }
}

async function readDiscoveredDirectory(root: string, dir: string): Promise<string[] | undefined> {
  const realDir = await resolveDiscoveredPath(root, dir);
  if (!realDir) return undefined;
  try {
    if (!isStatsDirectory(await stat(realDir))) return undefined;
    return (await readdir(realDir, { withFileTypes: true })).filter(isFileOrSymlink).map((entry) => entry.name).sort();
  } catch (error) {
    if (isIgnorablePathError(error)) return undefined;
    throw error;
  }
}

async function collectAgentsFiles(root: string, targetPath: string): Promise<ContextDocument[]> {
  const absoluteRoot = path.resolve(root);
  let cursor = path.resolve(absoluteRoot, targetPath);
  const statPath = path.extname(cursor) ? path.dirname(cursor) : cursor;
  cursor = isLexicallyInsideRoot(absoluteRoot, statPath) ? statPath : absoluteRoot;
  const docs: ContextDocument[] = [];
  let distance = 0;
  while (isLexicallyInsideRoot(absoluteRoot, cursor)) {
    const file = path.join(cursor, "AGENTS.md");
    const content = await readDiscoveredFile(absoluteRoot, file);
    if (content !== undefined) {
      docs.push({ kind: "agents", path: portableRelative(absoluteRoot, file), content, precedence: distance });
    }
    if (cursor === absoluteRoot) break;
    cursor = path.dirname(cursor);
    distance += 1;
  }
  return docs.sort((a, b) => a.precedence - b.precedence);
}

async function collectRuleFiles(root: string): Promise<ContextDocument[]> {
  const absoluteRoot = path.resolve(root);
  const docs: ContextDocument[] = [];
  let precedence = 100;
  for (const ruleDir of RULE_DIRS) {
    const dir = path.join(absoluteRoot, ruleDir);
    const entries = await readDiscoveredDirectory(absoluteRoot, dir);
    if (!entries) {
      precedence += 100;
      continue;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry);
      const content = await readDiscoveredFile(absoluteRoot, file);
      if (content !== undefined) {
        docs.push({ kind: "rule", path: portableRelative(absoluteRoot, file), content, precedence });
        precedence += 1;
      }
    }
    precedence = Math.ceil(precedence / 100) * 100;
  }
  for (const ruleFile of RULE_FILES) {
    const file = path.join(absoluteRoot, ruleFile);
    const content = await readDiscoveredFile(absoluteRoot, file);
    if (content !== undefined) docs.push({ kind: "rule", path: ruleFile, content, precedence: 900 });
  }
  return docs.sort((a, b) => a.precedence - b.precedence || a.path.localeCompare(b.path));
}

export async function loadContextBundle(root = process.cwd(), targetPath = "."): Promise<ContextBundle> {
  const absoluteRoot = path.resolve(root);
  const documents = [...(await collectAgentsFiles(absoluteRoot, targetPath)), ...(await collectRuleFiles(absoluteRoot))];
  const text = documents
    .map((doc) => `---\nkind: ${doc.kind}\npath: ${doc.path}\nprecedence: ${doc.precedence}\n---\n${doc.content.trim()}\n`)
    .join("\n");
  return { root: absoluteRoot, targetPath, documents, text };
}
