import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SKIPPED_DIRS = new Set([".git", ".idea", ".omo", "dist", "node_modules"]);
const SCANNED_EXTENSIONS = new Set([".md", ".mjs", ".ts", ".js", ".json"]);
const FORBIDDEN_PATTERNS = [
  /\bTeam Mode\b/i,
  /\bHyperplan\b/i,
  /\bAtlas\b/i,
  /\bMoAI\s+SPEC\b/i,
  /\bSPEC\/EARS\b/i,
  /\bEARS\b/,
  /\bprovider[_\s-]*(?:chat|generate|completion)\b/i,
  /\bchat\/generate(?:\/completion)?\b/i,
  /\bHTTP\s+MCP\b/i,
  /\bmanager[-\s]*agents?\b/i,
  /\bsecond registry\b/i,
];

const ALLOWLIST = [
  { path: "AGENTS.md", line: /의도적으로 포함하지/ },
  { path: "CLAUDE.md", line: /의도적으로 제외/ },
  { path: "README.md", line: /의도적으로 .*포함하지 않는다/ },
  { path: "README.md", line: /provider_endpoint_preflight.*(?:chat|generation).*아니다/ },
  { path: "README.md", line: /provider chat\/generate\/completion calls/ },
  { path: "HOW_TO_USE.md", line: /provider_endpoint_preflight.*예외/ },
  { path: "HOW_TO_USE.md", line: /chat\/generate 요청은 readiness proof로 쓰지 않는다/ },
  { path: "docs/architecture/01-overview.md", line: /범위 밖|대규모|병렬 디스패치 훅 없음/ },
  { path: "docs/architecture/04-tool-catalog.md", line: /chat\/generate 없이 provider metadata/ },
  { path: "docs/architecture/08-design-decisions.md", line: /chat\/generate.*(?:아닌|하지 않음|불필요)/ },
  { path: "docs/architecture/08-design-decisions.md", line: /결정 9: .*제외/ },
  { path: "docs/architecture/08-design-decisions.md", line: /현재 보류 범위.*chat\/generate\/completion.*MCP registry publish/ },
  { path: "docs/architecture/08-design-decisions.md", line: /제외:/ },
  { path: "docs/architecture/08-design-decisions.md", line: /의도적으로 작게|제외된 대형 시스템/ },
  { path: "docs/feature/2026-06-15-unimplemented-features.md", line: /provider_endpoint_preflight.*(?:아닐|않|아니다)|provider chat\/generate\/completion calls/ },
  { path: "test/code-context-scan.test.mjs", line: /unsupported tag is not a navigation hint/ },
  { path: "test/small-model-failure-replay.test.mjs", line: /provider_chat_generate/ },
  { path: "test/docs-feature-sync.test.mjs", line: /provider chat\/generate\/completion calls/ },
  { path: "test/forbidden-scope.test.mjs", line: /.*/ },
];

async function listScannedFiles(root, relativeDir = ".") {
  const directory = path.join(root, relativeDir);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = relativeDir === "." ? entry.name : path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...await listScannedFiles(root, relativePath));
      continue;
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath.split(path.sep).join("/"));
  }
  return files.sort();
}

function isAllowed(filePath, line) {
  return ALLOWLIST.some((entry) => entry.path === filePath && entry.line.test(line));
}

function forbiddenMatch(line) {
  return FORBIDDEN_PATTERNS.find((pattern) => pattern.test(line));
}

test("repository scope excludes Team Mode, Hyperplan, SPEC, provider chat, and second-registry additions", async () => {
  // Given: Tiny-Chu's product scope is intentionally smaller than the source research system.
  const root = process.cwd();
  const violations = [];

  // When: source, docs, and tests are scanned with precise historical/deferred allowlists.
  for (const filePath of await listScannedFiles(root)) {
    const lines = (await readFile(path.join(root, filePath), "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      const pattern = forbiddenMatch(line);
      if (pattern && !isAllowed(filePath, line)) {
        violations.push(`${filePath}:${index + 1}: ${pattern}: ${line.trim()}`);
      }
    });
  }

  // Then: new scope-expanding additions fail closed and make this CLI exit nonzero.
  assert.deepEqual(violations, []);
});
