import { execFile } from "node:child_process";
import { appendJsonLine, writeJsonAtomic, writeTextAtomic } from "../state/file-store.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { EMPTY_REDACTION_COUNTS, mergeRedactionCounts, redactPatch, type RedactionCounts } from "./git-weekly-report-privacy.js";
import { mergeReportIndex, readTeamMembers, writeDefaultTeamMembers } from "./git-weekly-report-state.js";
import { assertReportStorageInsideRoot, relativeReportPath, safeReportPath } from "./git-weekly-report-storage.js";
import {
  GIT_WEEKLY_LOG_FORMAT,
  type GitWeeklyMemberSummary,
  type GitWeeklyReportCommit,
  parseGitLog,
  renderReport,
  type RawGitCommit,
  summarizeGitWeeklyReport,
} from "./git-weekly-report-summary.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export type { GitWeeklyMemberSummary, GitWeeklyReportCommit } from "./git-weekly-report-summary.js";

export interface GitWeeklyReportResult {
  readonly periodKey: string;
  readonly reportId: string;
  readonly reportPath: string;
  readonly evidencePath: string;
  readonly qaPath: string;
  readonly indexPath: string;
  readonly auditPath: string;
  readonly commitCount: number;
  readonly qaValid: boolean;
  readonly memberSummaries: readonly GitWeeklyMemberSummary[];
}

type GitWeeklyReportMode = "summary_only" | "evidence";

interface PatchSnippet {
  readonly hash: string;
  readonly patch: string;
}

class GitWeeklyReportInputError extends Error {
  readonly name = "GitWeeklyReportInputError";
}

class GitWeeklyReportGitError extends Error {
  readonly name = "GitWeeklyReportGitError";
}

function dateText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (!DATE_PATTERN.test(value)) throw new GitWeeklyReportInputError(`Invalid git weekly report date: ${value}`);
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) throw new GitWeeklyReportInputError(`Invalid git weekly report date: ${value}`);
  return value;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function businessDaysInput(value: unknown): number {
  if (value === undefined) return 5;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new GitWeeklyReportInputError(`Invalid git weekly report businessDays: ${String(value)}`);
}

function refInput(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "HEAD";
  const ref = value.trim();
  if (ref.startsWith("-") || ref.includes("\0")) throw new GitWeeklyReportInputError(`Invalid git weekly report ref: ${ref}`);
  return ref;
}

function includePatchesInput(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new GitWeeklyReportInputError(`Invalid git weekly report includePatches: ${String(value)}`);
}

function reportModeInput(value: unknown): GitWeeklyReportMode {
  if (value === undefined) return "summary_only";
  if (value === "summary_only" || value === "evidence") return value;
  throw new GitWeeklyReportInputError(`Invalid git weekly report reportMode: ${String(value)}`);
}

function defaultEndDate(asOfDate: string): string {
  const date = new Date(`${asOfDate}T00:00:00.000Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return formatDate(date);
}

function defaultStartDate(endDate: string, businessDays: number): string {
  const date = new Date(`${endDate}T00:00:00.000Z`);
  let remaining = businessDays - 1;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return formatDate(date);
}

function baseReportId(startDate: string, endDate: string): string {
  return `${startDate.replaceAll("-", "")}_${endDate.replaceAll("-", "")}`;
}

function reportId(startDate: string, endDate: string, ref: string, currentBranch: string): string {
  const base = baseReportId(startDate, endDate);
  if (ref === "HEAD" || ref === currentBranch) return base;
  const slug = ref.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return slug === "" ? base : `${base}_${slug}`;
}

async function runGit(repo: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", repo, ...args], { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new GitWeeklyReportGitError(`git ${args.join(" ")} failed: ${String(stderr) || error.message}`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

async function currentBranch(repo: string): Promise<string> {
  return (await runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

async function assertGitRepo(repo: string): Promise<void> {
  const inside = (await runGit(repo, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") throw new GitWeeklyReportGitError("git rev-parse did not confirm a work tree");
}

async function collectPatchSnippets(repo: string, commits: readonly RawGitCommit[]): Promise<{
  readonly patchSnippets: readonly PatchSnippet[];
  readonly redactionCounts: RedactionCounts;
}> {
  let redactionCounts = EMPTY_REDACTION_COUNTS;
  const patchSnippets: PatchSnippet[] = [];
  for (const commit of commits) {
    const rawPatch = await runGit(repo, ["show", "--format=", "--patch", "--unified=0", commit.hash]);
    const redacted = redactPatch(rawPatch);
    redactionCounts = mergeRedactionCounts(redactionCounts, redacted.counts);
    patchSnippets.push({ hash: commit.hash.slice(0, 12), patch: redacted.patch });
  }
  return { patchSnippets, redactionCounts };
}

export async function createGitWeeklyReport(root: string | undefined, input: Record<string, unknown>): Promise<GitWeeklyReportResult> {
  const configuredRoot = resolveTinyChuPaths(root).root;
  const repoPath = typeof input.repoPath === "string" && input.repoPath.trim() !== "" ? input.repoPath : ".";
  const repo = await resolveExistingPathInsideRoot(configuredRoot, repoPath);
  if (!repo) throw new GitWeeklyReportInputError(`repoPath is outside configured root or does not exist: ${repoPath}`);

  const businessDays = businessDaysInput(input.businessDays);
  const asOfDate = dateText(input.asOfDate, formatDate(new Date()));
  const endDate = typeof input.endDate === "string" ? dateText(input.endDate, asOfDate) : defaultEndDate(asOfDate);
  const startDate = dateText(input.startDate, defaultStartDate(endDate, businessDays));
  if (startDate > endDate) throw new GitWeeklyReportInputError(`startDate must be on or before endDate: ${startDate} > ${endDate}`);
  const timezone = typeof input.timezone === "string" && input.timezone.trim() !== "" ? input.timezone : "UTC";
  const ref = refInput(input.ref);
  const includePatches = includePatchesInput(input.includePatches);
  const reportMode = reportModeInput(input.reportMode);
  await assertReportStorageInsideRoot(configuredRoot);
  await assertGitRepo(repo);
  const branch = await currentBranch(repo);
  const periodKey = baseReportId(startDate, endDate);
  const id = reportId(startDate, endDate, ref, branch);
  const rawLog = await runGit(repo, [
    "log",
    ref,
    "--numstat",
    `--since=${startDate}`,
    `--until=${endDate} 23:59:59`,
    "--date=short",
    `--pretty=format:${GIT_WEEKLY_LOG_FORMAT}`,
  ]);
  const rawCommits = parseGitLog(rawLog);
  const teamMembers = await readTeamMembers(configuredRoot);
  const { commits, memberSummaries, unmappedIdentities } = summarizeGitWeeklyReport(teamMembers, rawCommits);
  if (!teamMembers.loaded) await writeDefaultTeamMembers(configuredRoot, unmappedIdentities);
  const qaValid = teamMembers.loaded && commits.every((commit) => commit.mapped);
  const patches = includePatches ? await collectPatchSnippets(repo, rawCommits) : { patchSnippets: undefined, redactionCounts: EMPTY_REDACTION_COUNTS };
  const reportPath = relativeReportPath(`${id}.md`);
  const evidencePath = relativeReportPath("evidence", `${id}.json`);
  const qaPath = relativeReportPath("qa", `${id}.json`);
  const indexPath = relativeReportPath("index.json");
  const auditPath = relativeReportPath("audit.jsonl");

  await writeJsonAtomic(await safeReportPath(configuredRoot, "evidence", `${id}.json`), { reportId: id, periodKey, ref, range: { startDate, endDate, timezone, businessDays }, memberSummaries, commits, patchSnippets: patches.patchSnippets });
  await writeJsonAtomic(await safeReportPath(configuredRoot, "qa", `${id}.json`), {
    reportId: id,
    valid: qaValid,
    includePatches,
    reportMode,
    elevatedSensitivity: includePatches,
    unmappedIdentities,
    redactionCounts: patches.redactionCounts,
    checks: [
      { name: "teamMemberMap", pass: teamMembers.loaded },
      { name: "allContributorsMapped", pass: commits.every((commit) => commit.mapped) },
      { name: "noRawPatchBodiesPersisted", pass: true },
    ],
  });
  await writeTextAtomic(await safeReportPath(configuredRoot, `${id}.md`), renderReport({ reportId: id, startDate, endDate, timezone, businessDays, ref, commits, memberSummaries, unmappedIdentities, qaValid }));
  const reports = await mergeReportIndex(configuredRoot, { reportId: id, path: reportPath, evidencePath, qaPath, startDate, endDate, ref });
  await writeJsonAtomic(await safeReportPath(configuredRoot, "index.json"), {
    version: 1,
    reports,
  });
  await appendJsonLine(await safeReportPath(configuredRoot, "audit.jsonl"), { event: "git_weekly_report", reportId: id, periodKey, ref, commitCount: commits.length, qaValid, includePatches, elevatedSensitivity: includePatches });

  return {
    periodKey,
    reportId: id,
    reportPath,
    evidencePath,
    qaPath,
    indexPath,
    auditPath,
    commitCount: commits.length,
    qaValid,
    memberSummaries,
  };
}
