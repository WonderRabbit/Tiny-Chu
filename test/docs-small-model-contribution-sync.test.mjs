import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readText(path) {
  return readFile(path, "utf8");
}

function assertMentionsEvery(docName, docText, values) {
  const missing = values.filter((value) => !docText.includes(value));
  assert.deepEqual(missing, [], `${docName} is missing feature surface mentions`);
}

function assertNoStaleCrossProcessLockingClaim(docName, docText) {
  const stalePatterns = [
    /교차 프로세스 파일 잠금 없음/,
    /cross-process file locking[^.\n]*(?:호출자|caller|not implemented|구현하지)/i,
    /다중 프로세스 호출자는 외부 조정이 필요/,
    /여러 process가 같은 `?\.tiny`? state를 동시에 쓰는 경우[^.\n]*호출자/i,
    /task id, public job id, checkpoint sequence[^.\n]*(?:하나의 Node|single Node|single process)/i,
    /ID는 한 Node 프로세스 내에서 충돌에 강/,
    /시퀀스 기반 ID/,
    /단일 프로세스 한계/,
  ];
  assert.equal(stalePatterns.some((pattern) => pattern.test(docText)), false, `${docName} still contains stale cross-process locking limitations`);
}

test("small-model contribution evaluation report documents scoring and offline evidence workflow", async () => {
  const report = await readText("docs/reports/small-model-contribution-evaluation.md");
  const rubricSection = report.slice(report.indexOf("## Rubric Table"), report.indexOf("## Load Factors"));
  const rubricRows = [...rubricSection.matchAll(/^\| [A-F]\d{2} \|/gm)];

  assert.equal(rubricRows.length, 22);
  assertMentionsEvery("small-model contribution evaluation report", report, [
    "[small-model-opencode-audit.md](./small-model-opencode-audit.md)",
    "0/1/2",
    "normalizedScore",
    "material_help",
    "infrastructure_help",
    "weak_scaffold",
    "decorative",
    "skill",
    "command",
    "tool",
    "prompt",
    "file_write",
    "provider_call",
    "context",
    "recovery",
    "evidence",
    "6000",
    "12000",
    "8000",
    "2000",
    "scripts/evaluate-small-model-contribution.mjs",
    ".omo/evidence/small-model-contribution-eval/",
    "blockedReasons",
    "fixPaths",
    "Memory substitute rules",
    "Compact prompt/write rules",
    "Recovery/resume recipes",
    "No live Qwen",
    "Future live Qwen repeated-trial benchmark gap",
  ]);
});

test("docs describe advisory state locks without stale caller-side serialization claims", async () => {
  const docs = [
    ["README.md", await readText("README.md")],
    ["HOW_TO_USE.md", await readText("HOW_TO_USE.md")],
    ["CLAUDE.md", await readText("CLAUDE.md")],
    ["docs/architecture/06-state-layer.md", await readText("docs/architecture/06-state-layer.md")],
    ["docs/architecture/07-stability-contracts.md", await readText("docs/architecture/07-stability-contracts.md")],
    ["docs/architecture/08-design-decisions.md", await readText("docs/architecture/08-design-decisions.md")],
    ["docs/feature/2026-06-15-unimplemented-features.md", await readText("docs/feature/2026-06-15-unimplemented-features.md")],
  ];

  for (const [docName, docText] of docs) assertNoStaleCrossProcessLockingClaim(docName, docText);
  assertMentionsEvery("README.md advisory lock contract", docs[0][1], [".tiny/locks/", "owner.json", "lockId", "local filesystem advisory semantics"]);
  assertMentionsEvery("state architecture advisory lock matrix", docs[3][1], [
    "tasks-create.lock",
    "public-jobs-create.lock",
    "workflows-create.lock",
    "workflow-<runId>.lock",
    "wiki-index.lock",
    "plan-<hash>.lock",
    "safe-tooling.lock",
  ]);
});
