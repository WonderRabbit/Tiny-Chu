import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createTinyChuPlugin } from "../dist/index.js";
import { createPortableSymlink as symlink } from "./support/symlink.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(".");
const FIXTURE_ROOT_PREFIX = path.join(os.tmpdir(), "tiny-chu-git-weekly-report-");
const START_DATE = "2026-06-08";
const END_DATE = "2026-06-12";
const TIMEZONE = "Asia/Seoul";
const REPORT_ID = "20260608_20260612";
const BRANCH_REPORT_ID = "20260608_20260612_team-branch";
const RAW_EMAIL = "engineer@example.invalid";
const DISPLAY_NAME = "Mina Park";
const SECRET_TOKEN = "SECRET_TOKEN_123";
const RAW_PATCH_BODY = "RAW_PATCH_BODY_SHOULD_NOT_LEAK";

function emailHash(email = RAW_EMAIL) {
  return `sha256:${createHash("sha256").update(email.toLowerCase()).digest("hex")}`;
}

function fixtureName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function createFixtureRoot(t, name) {
  const parent = await mkdtemp(FIXTURE_ROOT_PREFIX);
  const root = path.join(parent, fixtureName(name));
  await mkdir(root, { recursive: true });
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  return root;
}

async function runGit(repo, args, env = {}) {
  return execFileAsync("git", args, {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Tiny Weekly Fixture",
      GIT_AUTHOR_EMAIL: RAW_EMAIL,
      GIT_COMMITTER_NAME: "Tiny Weekly Fixture",
      GIT_COMMITTER_EMAIL: RAW_EMAIL,
      ...env,
    },
  });
}

async function commitFile(repo, fileName, contents, message, isoDate) {
  await writeFile(path.join(repo, fileName), contents, "utf8");
  await runGit(repo, ["add", fileName]);
  await runGit(repo, ["commit", "-m", message], {
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  });
}

async function createDeterministicGitRepo(root) {
  const repo = path.join(root, "repo");
  await mkdir(repo, { recursive: true });
  await runGit(repo, ["init"]);
  await runGit(repo, ["config", "user.name", "Tiny Weekly Fixture"]);
  await runGit(repo, ["config", "user.email", RAW_EMAIL]);
  await commitFile(repo, "weekly-plan.md", "Mon: map the weekly report artifact contract\n", "Add weekly report plan", "2026-06-09T09:30:00+09:00");
  await commitFile(repo, "private-notes.txt", `${SECRET_TOKEN}\n${RAW_PATCH_BODY}\n`, "Scrub private report details", "2026-06-11T16:45:00+09:00");
  return repo;
}

async function writeTeamMembersMap(root) {
  const reportDir = path.join(root, ".tiny", "reports", "git-weekly");
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    path.join(reportDir, "team-members.json"),
    `${JSON.stringify({
      version: 1,
      members: [
        {
          id: "mina",
          displayName: DISPLAY_NAME,
          aliases: [{ name: "Tiny Weekly Fixture", emailHash: emailHash() }],
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

function getGitWeeklyReportTool(tiny) {
  assert.equal(typeof tiny.tools.git_weekly_report, "function", "git_weekly_report tool must be registered");
  return tiny.tools.git_weekly_report;
}

function artifactPaths(root) {
  const reportDir = path.join(root, ".tiny", "reports", "git-weekly");
  return {
    report: path.join(reportDir, `${REPORT_ID}.md`),
    evidence: path.join(reportDir, "evidence", `${REPORT_ID}.json`),
    qa: path.join(reportDir, "qa", `${REPORT_ID}.json`),
    index: path.join(reportDir, "index.json"),
    audit: path.join(reportDir, "audit.jsonl"),
    teamMembers: path.join(reportDir, "team-members.json"),
  };
}

async function readArtifacts(root, reportId = REPORT_ID) {
  const paths = artifactPaths(root);
  return {
    report: await readFile(path.join(path.dirname(paths.report), `${reportId}.md`), "utf8"),
    evidence: await readFile(path.join(path.dirname(paths.evidence), `${reportId}.json`), "utf8"),
    qa: await readFile(path.join(path.dirname(paths.qa), `${reportId}.json`), "utf8"),
    index: await readFile(paths.index, "utf8"),
    audit: await readFile(paths.audit, "utf8"),
  };
}

function parseArtifactJson(artifacts) {
  return {
    evidence: JSON.parse(artifacts.evidence),
    qa: JSON.parse(artifacts.qa),
    index: JSON.parse(artifacts.index),
    audit: artifacts.audit
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

function weeklyReportInput(repoPath = "repo") {
  return {
    repoPath,
    startDate: START_DATE,
    endDate: END_DATE,
    timezone: TIMEZONE,
  };
}

test("registers git_weekly_report as a Tiny-Chu tool", async (t) => {
  const root = await createFixtureRoot(t, "registers git weekly report");
  const tiny = createTinyChuPlugin({ root });

  getGitWeeklyReportTool(tiny);
});

test("git_weekly_report writes durable artifacts with mapped member display names", async (t) => {
  const root = await createFixtureRoot(t, "mapped artifacts");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);
  await writeTeamMembersMap(root);

  const result = await gitWeeklyReport(weeklyReportInput());

  const artifacts = await readArtifacts(root);
  const parsed = parseArtifactJson(artifacts);

  assert.equal(result.periodKey, REPORT_ID);
  assert.match(artifacts.report, new RegExp(DISPLAY_NAME));
  assert.ok(parsed.evidence);
  assert.equal(parsed.qa.valid, true);
  assert.equal(parsed.qa.includePatches, false);
  assert.equal(parsed.qa.elevatedSensitivity, false);
  assert.match(artifacts.index, new RegExp(`${REPORT_ID}\\.md`));
  assert.ok(parsed.audit.length > 0);
});

test("git_weekly_report writes member summaries with confidence and change stats", async (t) => {
  const root = await createFixtureRoot(t, "member summary stats");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);
  await writeTeamMembersMap(root);

  await gitWeeklyReport(weeklyReportInput());

  const artifacts = await readArtifacts(root);
  const parsed = parseArtifactJson(artifacts);
  assert.match(artifacts.report, /## Team Member Summaries/);
  assert.match(artifacts.report, /Confidence: high/);
  assert.match(artifacts.report, /Files changed: 2/);
  assert.match(artifacts.report, /Insertions: 3/);
  assert.match(artifacts.report, /Paths: .*private-notes\.txt.*weekly-plan\.md/);

  assert.ok(Array.isArray(parsed.evidence.memberSummaries));
  assert.equal(parsed.evidence.memberSummaries.length, 1);
  const [summary] = parsed.evidence.memberSummaries;
  assert.equal(summary.displayName, DISPLAY_NAME);
  assert.equal(summary.confidence, "high");
  assert.equal(summary.commitCount, 2);
  assert.equal(summary.filesChanged, 2);
  assert.equal(summary.insertions, 3);
  assert.equal(summary.deletions, 0);
  assert.deepEqual(summary.paths, ["private-notes.txt", "weekly-plan.md"]);
});

test("git_weekly_report preserves report index history deterministically", async (t) => {
  const root = await createFixtureRoot(t, "index history");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);
  await writeTeamMembersMap(root);
  const reportDir = path.join(root, ".tiny", "reports", "git-weekly");
  await writeFile(
    path.join(reportDir, "index.json"),
    `${JSON.stringify({ version: 1, reports: [{ reportId: "20260601_20260605", path: ".tiny/reports/git-weekly/20260601_20260605.md" }] }, null, 2)}\n`,
    "utf8",
  );

  await gitWeeklyReport(weeklyReportInput());

  const parsed = parseArtifactJson(await readArtifacts(root));
  assert.deepEqual(parsed.index.reports.map((report) => report.reportId), ["20260601_20260605", REPORT_ID]);
});

test("git_weekly_report records redacted patch snippets only when explicitly requested", async (t) => {
  const root = await createFixtureRoot(t, "include patches");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);
  await writeTeamMembersMap(root);

  await gitWeeklyReport({ ...weeklyReportInput(), includePatches: true, reportMode: "evidence" });

  const artifacts = await readArtifacts(root);
  const parsed = parseArtifactJson(artifacts);
  const durableText = Object.values(artifacts).join("\n");
  assert.equal(parsed.qa.includePatches, true);
  assert.equal(parsed.qa.reportMode, "evidence");
  assert.equal(parsed.qa.elevatedSensitivity, true);
  assert.ok(parsed.qa.redactionCounts.patchLines > 0);
  assert.ok(Array.isArray(parsed.evidence.patchSnippets));
  assert.ok(parsed.evidence.patchSnippets.length > 0);
  assert.match(parsed.evidence.patchSnippets[0].patch, /\[redacted-patch-content\]/);
  assert.doesNotMatch(durableText, new RegExp(SECRET_TOKEN));
  assert.doesNotMatch(durableText, new RegExp(RAW_PATCH_BODY));
  assert.equal(parsed.audit.at(-1).includePatches, true);
});

test("git_weekly_report reads commits from the selected ref", async (t) => {
  const root = await createFixtureRoot(t, "selected ref");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  const repo = await createDeterministicGitRepo(root);
  await writeTeamMembersMap(root);
  const { stdout } = await runGit(repo, ["branch", "--show-current"]);
  const baseBranch = stdout.trim();
  await runGit(repo, ["checkout", "-b", "team-branch"]);
  await commitFile(repo, "branch-only.md", "Branch-only summary\n", "feat(branch): branch only summary", "2026-06-12T11:20:00+09:00");
  await runGit(repo, ["checkout", baseBranch]);

  const branchResult = await gitWeeklyReport({ ...weeklyReportInput(), ref: "team-branch" });
  const branchArtifacts = await readArtifacts(root, BRANCH_REPORT_ID);
  assert.equal(branchResult.reportId, BRANCH_REPORT_ID);
  assert.match(branchArtifacts.report, /branch only summary/);

  await gitWeeklyReport({ ...weeklyReportInput(), ref: baseBranch });
  const baseArtifacts = await readArtifacts(root);
  assert.doesNotMatch(baseArtifacts.report, /branch only summary/);
  const parsed = parseArtifactJson(baseArtifacts);
  assert.deepEqual(parsed.index.reports.map((report) => report.reportId), [REPORT_ID, BRANCH_REPORT_ID]);
});

test("git_weekly_report keeps default durable artifacts private when team-members map is missing", async (t) => {
  const root = await createFixtureRoot(t, "missing team members privacy");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);

  await gitWeeklyReport(weeklyReportInput());

  const artifacts = await readArtifacts(root);
  const paths = artifactPaths(root);
  const parsed = parseArtifactJson(artifacts);
  const durableText = Object.values(artifacts).join("\n");

  assert.equal(parsed.qa.valid, false);
  assert.ok(Array.isArray(parsed.qa.unmappedIdentities));
  assert.equal(parsed.qa.unmappedIdentities.length, 1);
  assert.match(parsed.qa.unmappedIdentities[0].identityHash, /^sha256:/);
  assert.match(artifacts.report, /## Unmapped Identities/);
  assert.equal(parsed.evidence.patchSnippets, undefined);
  assert.match(await readFile(paths.teamMembers, "utf8"), /"members"/);
  assert.match(await readFile(paths.teamMembers, "utf8"), /"emailHash"/);
  assert.doesNotMatch(durableText, new RegExp(RAW_EMAIL.replace(".", "\\.")));
  assert.doesNotMatch(durableText, new RegExp(SECRET_TOKEN));
  assert.doesNotMatch(durableText, new RegExp(RAW_PATCH_BODY));
});

test("git_weekly_report rejects non-git repositories without writing partial report state", async (t) => {
  const root = await createFixtureRoot(t, "non git no partials");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await mkdir(path.join(root, "repo"), { recursive: true });

  await assert.rejects(
    () => gitWeeklyReport(weeklyReportInput()),
    /git|repository|work.tree|rev-parse/i,
  );
  await assert.rejects(() => readFile(artifactPaths(root).teamMembers, "utf8"), /ENOENT/);
});

test("git_weekly_report rejects symlinked report storage outside the Tiny-Chu root", async (t) => {
  const root = await createFixtureRoot(t, "report storage symlink");
  const outside = path.join(path.dirname(root), "outside-report-storage");
  await rm(outside, { recursive: true, force: true });
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);
  await mkdir(path.join(root, ".tiny", "reports"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, path.join(root, ".tiny", "reports", "git-weekly"));

  await assert.rejects(
    () => gitWeeklyReport(weeklyReportInput()),
    /report|storage|symlink|outside|root/i,
  );
  assert.deepEqual(await readdir(outside), []);
});

test("git_weekly_report defaults to the last 5 business days before a weekend run date", async (t) => {
  const root = await createFixtureRoot(t, "default business days");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);

  const result = await gitWeeklyReport({
    repoPath: "repo",
    asOfDate: "2026-06-13",
    timezone: TIMEZONE,
  });

  assert.equal(result.periodKey, REPORT_ID);
});

test("git_weekly_report rejects invalid calendar dates before writing artifacts", async (t) => {
  const root = await createFixtureRoot(t, "invalid calendar dates");
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await createDeterministicGitRepo(root);

  await assert.rejects(() => gitWeeklyReport({ ...weeklyReportInput(), startDate: "2026-02-30" }), /Invalid git weekly report date/i);
  await assert.rejects(() => gitWeeklyReport({ ...weeklyReportInput(), endDate: "2026-99-99" }), /Invalid git weekly report date/i);
  await assert.rejects(() => gitWeeklyReport({ repoPath: "repo", asOfDate: "2026-13-01" }), /Invalid git weekly report date/i);
  await assert.rejects(() => readFile(artifactPaths(root).teamMembers, "utf8"), /ENOENT/);
});

test("git_weekly_report rejects repoPath outside the Tiny-Chu root", async (t) => {
  const root = await createFixtureRoot(t, "rejects outside root");
  const outsideRepo = path.join(path.dirname(root), "outside-root-repo");
  const linkedRepo = path.join(root, "linked-outside-repo");
  await rm(outsideRepo, { recursive: true, force: true });
  t.after(async () => {
    await rm(outsideRepo, { recursive: true, force: true });
  });
  const tiny = createTinyChuPlugin({ root });
  const gitWeeklyReport = getGitWeeklyReportTool(tiny);
  await mkdir(outsideRepo, { recursive: true });
  await runGit(outsideRepo, ["init"]);
  await symlink(outsideRepo, linkedRepo);

  await assert.rejects(
    () => gitWeeklyReport(weeklyReportInput("../outside-root-repo")),
    /repoPath|outside|root|path|unsafe/i,
  );
  await assert.rejects(
    () => gitWeeklyReport(weeklyReportInput("linked-outside-repo")),
    /repoPath|outside|root|path|unsafe/i,
  );
});
