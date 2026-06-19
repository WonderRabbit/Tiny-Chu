import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveExistingPathInsideRoot, resolvePathInsideRoot } from "../state/path-safety.js";

export type DocsConsistencyStatus = "pass" | "fail";
export type DocsConsistencyFindingCode = "unknown_tool" | "path_escape" | "missing_doc";
export type DocsConsistencyFindingSeverity = "error";

export interface DocsConsistencyFinding {
  readonly code: DocsConsistencyFindingCode;
  readonly severity: DocsConsistencyFindingSeverity;
  readonly path: string;
  readonly toolName?: string;
  readonly line?: number;
  readonly message: string;
}

export interface DocsConsistencyInput {
  readonly root: string;
  readonly registryToolNames: readonly string[];
  readonly knownToolNames?: readonly string[];
  readonly paths?: readonly string[];
}

export interface DocsConsistencyResult {
  readonly status: DocsConsistencyStatus;
  readonly registryToolCount: number;
  readonly checkedPaths: readonly string[];
  readonly documentedToolNames: readonly string[];
  readonly findings: readonly DocsConsistencyFinding[];
}

const ROOT_DOC_PATHS: readonly string[] = ["README.md", "HOW_TO_USE.md", "INSTALL.md"];
const TOOL_TOKEN_PATTERN = /[a-z][a-z0-9_]*_[a-z0-9_]*[a-z0-9]\b/g;
const TOOL_LINE_PATTERN = /\b(tool|tools|OpenCode|registry|call|calls)\b|도구|툴|레지스트리|호출/i;
const STRONG_TOOL_CLAIM_PATTERN = /\b(tool list|tools list|call|calls|tiny\.tools)\b|도구 목록|툴 목록|tool 목록|대표적인 도구|호출/i;
const TOOL_TABLE_HEADER_PATTERN = /^\s*\|\s*(?:tool|tools|툴|툴명|도구)\s*\|/i;
const NEGATED_TOOL_LINE_PATTERN = /포함되지 않는다|아직 구현하지|미구현|제외|not included|not implemented|deferred/i;
const NON_TOOL_CODE_LINE_PATTERN = /에러 코드|에러 안|phase 순서|networkMode|metadata probe/i;
const OPTIONAL_SECTION_HEADING_PATTERN = /\b(opt-in|safeTooling|nativePreviews|safe[- ]tooling|native[- ]previews?)\b|옵트인|안전한 source tooling|옵션\s*\(\s*safe\s*\)\s*패키지|옵션 패키지[^\n]*(?:safe[- ]tooling|native[- ]previews?|`tiny-chu\.(?:safe-tooling|native-previews)`)/i;

export async function checkDocsConsistency(input: DocsConsistencyInput): Promise<DocsConsistencyResult> {
  const registryToolNames = new Set(input.registryToolNames);
  const mentionVocabularyToolNames = new Set([...(input.knownToolNames ?? []), ...input.registryToolNames]);
  const requestedPaths = input.paths ? [...input.paths].sort() : await defaultDocsPaths(input.root);
  const checkedPaths: string[] = [];
  const documentedToolNames = new Set<string>();
  const findings: DocsConsistencyFinding[] = [];

  for (const requestedPath of requestedPaths) {
    const resolved = resolvePathInsideRoot(input.root, requestedPath);
    if (!resolved) {
      findings.push(pathEscapeFinding(requestedPath));
      continue;
    }
    const relativePath = toPosixPath(path.relative(input.root, resolved));
    const readPath = await resolveDocsReadPath(input.root, requestedPath, resolved);
    if (!readPath) {
      findings.push(pathEscapeFinding(requestedPath));
      continue;
    }
    const docRead = await readDocsFile(readPath, relativePath);
    if (!docRead.ok) {
      findings.push(docRead.finding);
      continue;
    }
    checkedPaths.push(relativePath);
    const mentions = extractDocumentedToolMentions(docRead.text, mentionVocabularyToolNames, {
      skipInactiveOptionalSections: input.paths === undefined,
    });
    for (const mention of mentions) {
      documentedToolNames.add(mention.toolName);
      if (!registryToolNames.has(mention.toolName)) {
        findings.push({
          code: "unknown_tool",
          severity: "error",
          path: relativePath,
          toolName: mention.toolName,
          line: mention.line,
          message: `Documented tool ${mention.toolName} is not present in the composed registry.`,
        });
      }
    }
  }

  const sortedFindings = [...findings].sort(compareFindings);
  return {
    status: sortedFindings.length === 0 ? "pass" : "fail",
    registryToolCount: registryToolNames.size,
    checkedPaths: checkedPaths.sort(),
    documentedToolNames: [...documentedToolNames].sort(),
    findings: sortedFindings,
  };
}

async function resolveDocsReadPath(root: string, requestedPath: string, lexicalPath: string): Promise<string | undefined> {
  try {
    return await resolveExistingPathInsideRoot(root, requestedPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return lexicalPath;
    throw error;
  }
}

export interface DocumentedToolMention {
  readonly toolName: string;
  readonly line: number;
}

export interface ExtractDocumentedToolMentionOptions {
  readonly skipInactiveOptionalSections?: boolean;
}

export function extractDocumentedToolMentions(
  markdown: string,
  knownToolNames: ReadonlySet<string> = new Set(),
  options: ExtractDocumentedToolMentionOptions = {},
): readonly DocumentedToolMention[] {
  const mentions: DocumentedToolMention[] = [];
  const lines = markdown.split(/\r?\n/);
  let insideToolClaimBlock = false;
  let optionalSectionDepth: number | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = markdownHeading(line);
    if (heading) {
      insideToolClaimBlock = false;
      if (optionalSectionDepth !== undefined && heading.depth <= optionalSectionDepth) optionalSectionDepth = undefined;
      if (options.skipInactiveOptionalSections === true && OPTIONAL_SECTION_HEADING_PATTERN.test(heading.text)) {
        optionalSectionDepth = heading.depth;
      }
      if (optionalSectionDepth !== undefined) continue;
    }
    if (optionalSectionDepth !== undefined) continue;
    if (line.trim() === "") {
      insideToolClaimBlock = false;
      continue;
    }
    if (line.trim().startsWith("#")) {
      insideToolClaimBlock = false;
      continue;
    }
    const startsToolClaimBlock = STRONG_TOOL_CLAIM_PATTERN.test(line) || TOOL_TABLE_HEADER_PATTERN.test(line);
    if (startsToolClaimBlock) insideToolClaimBlock = true;
    if (!startsToolClaimBlock && insideToolClaimBlock && !isToolListContinuation(line)) {
      insideToolClaimBlock = false;
    }
    if ((!insideToolClaimBlock && !isToolClaimLine(line)) || NEGATED_TOOL_LINE_PATTERN.test(line) || NON_TOOL_CODE_LINE_PATTERN.test(line)) continue;
    const codeSource = line.trim().startsWith("|") ? firstTableCell(line) : line;
    for (const toolName of codeSpanToolNames(codeSource, knownToolNames, insideToolClaimBlock || STRONG_TOOL_CLAIM_PATTERN.test(line))) {
      mentions.push({ toolName, line: index + 1 });
    }
  }
  return mentions.sort((left, right) => left.toolName.localeCompare(right.toolName) || left.line - right.line);
}

function markdownHeading(line: string): { readonly depth: number; readonly text: string } | undefined {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
  const hashes = match?.[1];
  const text = match?.[2];
  if (!hashes || !text) return undefined;
  return { depth: hashes.length, text };
}

function isToolListContinuation(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("|");
}

function firstTableCell(line: string): string {
  const cells = line.split("|");
  return cells[1] ?? line;
}

async function defaultDocsPaths(root: string): Promise<readonly string[]> {
  const paths = new Set(ROOT_DOC_PATHS);
  const architectureDir = path.join(root, "docs", "architecture");
  try {
    const entries = await readdir(architectureDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        paths.add(toPosixPath(path.join("docs", "architecture", entry.name)));
      }
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
  return [...paths].sort();
}

type DocsReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly finding: DocsConsistencyFinding };

async function readDocsFile(file: string, relativePath: string): Promise<DocsReadResult> {
  try {
    return { ok: true, text: await readFile(file, "utf8") };
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return {
        ok: false,
        finding: {
          code: "missing_doc",
          severity: "error",
          path: relativePath,
          message: "Docs path does not exist.",
        },
      };
    }
    throw error;
  }
}

function isToolClaimLine(line: string): boolean {
  if (!TOOL_LINE_PATTERN.test(line)) return false;
  return !NEGATED_TOOL_LINE_PATTERN.test(line);
}

function codeSpanToolNames(line: string, knownToolNames: ReadonlySet<string>, strongToolClaim: boolean): readonly string[] {
  const names = new Set<string>();
  for (const codeSpan of line.matchAll(/`([^`]+)`/g)) {
    const content = (codeSpan[1] ?? "").trim();
    for (const match of content.matchAll(TOOL_TOKEN_PATTERN)) {
      const toolName = match[0];
      if (knownToolNames.has(toolName) || isStandaloneToolCodeSpan(content, toolName, strongToolClaim)) {
        names.add(toolName);
      }
    }
  }
  return [...names].sort();
}

function isStandaloneToolCodeSpan(content: string, toolName: string, strongToolClaim: boolean): boolean {
  if (!strongToolClaim) return false;
  if (content === toolName) return true;
  return content.startsWith(`${toolName}(`) || content.startsWith(`${toolName}({`);
}

function pathEscapeFinding(requestedPath: string): DocsConsistencyFinding {
  return {
    code: "path_escape",
    severity: "error",
    path: requestedPath,
    message: "Docs path must stay inside the project root.",
  };
}

function compareFindings(left: DocsConsistencyFinding, right: DocsConsistencyFinding): number {
  return (
    left.path.localeCompare(right.path)
    || (left.toolName ?? "").localeCompare(right.toolName ?? "")
    || (left.line ?? 0) - (right.line ?? 0)
    || left.code.localeCompare(right.code)
  );
}

function toPosixPath(value: string): string {
  return value.split(/[\\/]/).join("/");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
