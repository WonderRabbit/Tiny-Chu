import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isLexicallyInsideRoot } from "../state/path-safety.js";

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

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
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
    if (await exists(file)) {
      docs.push({ kind: "agents", path: path.relative(absoluteRoot, file), content: await readFile(file, "utf8"), precedence: distance });
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
    if (!(await exists(dir))) {
      precedence += 100;
      continue;
    }
    const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    for (const entry of entries) {
      const file = path.join(dir, entry);
      docs.push({ kind: "rule", path: path.relative(absoluteRoot, file), content: await readFile(file, "utf8"), precedence });
      precedence += 1;
    }
    precedence = Math.ceil(precedence / 100) * 100;
  }
  for (const ruleFile of RULE_FILES) {
    const file = path.join(absoluteRoot, ruleFile);
    if (await exists(file)) docs.push({ kind: "rule", path: ruleFile, content: await readFile(file, "utf8"), precedence: 900 });
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
