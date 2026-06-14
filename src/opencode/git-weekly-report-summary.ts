import { cleanText, emailIdentityHash } from "./git-weekly-report-privacy.js";

const RS = "\u001e";
export const GIT_WEEKLY_LOG_FORMAT = `${RS}%H\u001f%an\u001f%ae\u001f%ad\u001f%s`;
const US = "\u001f";

export interface TeamAlias {
  readonly name: string;
  readonly emailHash: string;
}

export interface TeamMember {
  readonly id: string;
  readonly displayName: string;
  readonly aliases: readonly TeamAlias[];
}

export interface TeamMembersMap {
  readonly loaded: boolean;
  readonly members: readonly TeamMember[];
}

export interface GitWeeklyFileStat {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}

export interface RawGitCommit {
  readonly hash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly date: string;
  readonly subject: string;
  readonly files: readonly GitWeeklyFileStat[];
}

export interface GitWeeklyReportCommit {
  readonly hash: string;
  readonly date: string;
  readonly subject: string;
  readonly contributor: string;
  readonly mapped: boolean;
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly paths: readonly string[];
  readonly themes: readonly string[];
  readonly identityHash?: string;
}

export interface GitWeeklyMemberSummary {
  readonly displayName: string;
  readonly mapped: boolean;
  readonly confidence: "high" | "low";
  readonly commitCount: number;
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly paths: readonly string[];
  readonly themes: readonly string[];
}

export interface GitWeeklyUnmappedIdentity {
  readonly identityHash: string;
  readonly commitCount: number;
}

interface MutableSummary {
  displayName: string;
  mapped: boolean;
  commitCount: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  paths: Set<string>;
  themes: Set<string>;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function numericStat(value: string | undefined): number {
  if (!value || value === "-") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseGitLog(raw: string): readonly RawGitCommit[] {
  const commits: Array<RawGitCommit & { files: GitWeeklyFileStat[] }> = [];
  let current: (RawGitCommit & { files: GitWeeklyFileStat[] }) | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    if (line.startsWith(RS)) {
      const [hash, authorName, authorEmail, date, subject] = line.slice(1).split(US);
      current = hash && authorName && authorEmail && date && subject ? { hash, authorName, authorEmail, date, subject, files: [] } : undefined;
      if (current) commits.push(current);
      continue;
    }
    if (!current) continue;
    const [insertions, deletions, filePath] = line.split("\t");
    if (!filePath) continue;
    current.files.push({ path: cleanText(filePath), insertions: numericStat(insertions), deletions: numericStat(deletions) });
  }
  return commits;
}

function findMember(map: TeamMembersMap, commit: RawGitCommit): TeamMember | undefined {
  const identityHash = emailIdentityHash(commit.authorEmail);
  return map.members.find((member) => member.aliases.some((alias) => alias.name === commit.authorName || alias.emailHash === identityHash));
}

function themesFor(subject: string, paths: readonly string[]): readonly string[] {
  const subjectType = subject.match(/^([a-z]+)(?:\(.+\))?:/i)?.[1]?.toLowerCase();
  const pathThemes = paths.map((filePath) => filePath.split("/")[0]).filter((part) => part !== "");
  return sortedUnique([...(subjectType ? [subjectType] : []), ...pathThemes]).slice(0, 6);
}

function summarizeCommit(map: TeamMembersMap, commit: RawGitCommit): GitWeeklyReportCommit {
  const member = findMember(map, commit);
  const paths = sortedUnique(commit.files.map((file) => file.path));
  const subject = cleanText(commit.subject);
  return {
    hash: commit.hash.slice(0, 12),
    date: commit.date,
    subject,
    contributor: member?.displayName ?? "Unknown contributor",
    mapped: member !== undefined,
    filesChanged: paths.length,
    insertions: commit.files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: commit.files.reduce((sum, file) => sum + file.deletions, 0),
    paths,
    themes: themesFor(subject, paths),
    ...(member ? {} : { identityHash: emailIdentityHash(commit.authorEmail) }),
  };
}

function addCommit(summary: MutableSummary, commit: GitWeeklyReportCommit): void {
  summary.commitCount += 1;
  summary.filesChanged += commit.filesChanged;
  summary.insertions += commit.insertions;
  summary.deletions += commit.deletions;
  for (const filePath of commit.paths) summary.paths.add(filePath);
  for (const theme of commit.themes) summary.themes.add(theme);
}

export function summarizeGitWeeklyReport(map: TeamMembersMap, rawCommits: readonly RawGitCommit[]): {
  readonly commits: readonly GitWeeklyReportCommit[];
  readonly memberSummaries: readonly GitWeeklyMemberSummary[];
  readonly unmappedIdentities: readonly GitWeeklyUnmappedIdentity[];
} {
  const commits = rawCommits.map((commit) => summarizeCommit(map, commit));
  const byContributor = new Map<string, MutableSummary>();
  for (const commit of commits) {
    const key = `${commit.mapped ? "mapped" : "unknown"}:${commit.contributor}`;
    const current = byContributor.get(key) ?? {
      displayName: commit.contributor,
      mapped: commit.mapped,
      commitCount: 0,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      paths: new Set<string>(),
      themes: new Set<string>(),
    };
    addCommit(current, commit);
    byContributor.set(key, current);
  }
  const memberSummaries = [...byContributor.values()]
    .map((summary) => ({
      displayName: summary.displayName,
      mapped: summary.mapped,
      confidence: summary.mapped ? "high" as const : "low" as const,
      commitCount: summary.commitCount,
      filesChanged: summary.filesChanged,
      insertions: summary.insertions,
      deletions: summary.deletions,
      paths: [...summary.paths].sort((left, right) => left.localeCompare(right)),
      themes: [...summary.themes].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const unmapped = new Map<string, number>();
  for (const commit of commits) {
    if (commit.mapped || !commit.identityHash) continue;
    unmapped.set(commit.identityHash, (unmapped.get(commit.identityHash) ?? 0) + 1);
  }
  const unmappedIdentities = [...unmapped.entries()]
    .map(([identityHash, commitCount]) => ({ identityHash, commitCount }))
    .sort((left, right) => left.identityHash.localeCompare(right.identityHash));
  return { commits, memberSummaries, unmappedIdentities };
}

export function renderReport(input: {
  readonly reportId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly timezone: string;
  readonly businessDays: number;
  readonly ref: string;
  readonly commits: readonly GitWeeklyReportCommit[];
  readonly memberSummaries: readonly GitWeeklyMemberSummary[];
  readonly unmappedIdentities: readonly GitWeeklyUnmappedIdentity[];
  readonly qaValid: boolean;
}): string {
  const summaryLines = input.memberSummaries.length > 0
    ? input.memberSummaries.map((summary) => [
      `- ${summary.displayName} - Confidence: ${summary.confidence}; Commits: ${summary.commitCount}; Files changed: ${summary.filesChanged};`,
      `Insertions: ${summary.insertions}; Deletions: ${summary.deletions}; Paths: ${summary.paths.join(", ") || "none"};`,
      `Themes: ${summary.themes.join(", ") || "none"}`,
    ].join(" "))
    : ["- No mapped team activity found in range."];
  const commitLines = input.commits.length > 0
    ? input.commits.map((commit) => [
      `- ${commit.date} ${commit.hash} ${commit.contributor}: ${commit.subject}`,
      `(${commit.filesChanged} files, +${commit.insertions}/-${commit.deletions}; ${commit.paths.join(", ") || "no paths"})`,
    ].join(" "))
    : ["- No commits found in range."];
  const unmappedLines = input.unmappedIdentities.length > 0
    ? ["", "## Unmapped Identities", ...input.unmappedIdentities.map((identity) => `- ${identity.identityHash}: ${identity.commitCount} commits`)]
    : [];
  return `${[
    `# Git Weekly Report ${input.reportId}`,
    "",
    `Range: ${input.startDate} to ${input.endDate} (${input.timezone}, ${input.businessDays} business days)`,
    `Local Git Evidence: commits reachable from ref ${input.ref}`,
    `QA: ${input.qaValid ? "valid" : "needs team member mapping"}`,
    "",
    "## Team Member Summaries",
    ...summaryLines,
    "",
    "## Commit Evidence",
    ...commitLines,
    ...unmappedLines,
    "",
  ].join("\n")}\n`;
}
