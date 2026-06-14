import { readFile } from "node:fs/promises";
import { readJsonFile, writeJsonAtomic } from "../state/file-store.js";
import { emailIdentityHash } from "./git-weekly-report-privacy.js";
import { safeReportPath } from "./git-weekly-report-storage.js";
import type { GitWeeklyUnmappedIdentity, TeamAlias, TeamMember, TeamMembersMap } from "./git-weekly-report-summary.js";

export interface ReportIndexEntry {
  readonly reportId: string;
  readonly path: string;
  readonly evidencePath?: string;
  readonly qaPath?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly ref?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function parseAlias(value: unknown): TeamAlias | undefined {
  if (!isRecord(value) || typeof value.name !== "string") return undefined;
  const email = typeof value.email === "string" ? value.email : undefined;
  const emailHash = typeof value.emailHash === "string" ? value.emailHash : undefined;
  if (emailHash) return { name: value.name, emailHash };
  if (email) return { name: value.name, emailHash: emailIdentityHash(email) };
  return undefined;
}

function parseMember(value: unknown): TeamMember | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.displayName !== "string") return undefined;
  const aliases = Array.isArray(value.aliases) ? value.aliases.flatMap((alias) => parseAlias(alias) ?? []) : [];
  return { id: value.id, displayName: value.displayName, aliases };
}

function indexEntry(value: unknown): ReportIndexEntry | undefined {
  if (!isRecord(value) || typeof value.reportId !== "string" || typeof value.path !== "string") return undefined;
  return {
    reportId: value.reportId,
    path: value.path,
    evidencePath: typeof value.evidencePath === "string" ? value.evidencePath : undefined,
    qaPath: typeof value.qaPath === "string" ? value.qaPath : undefined,
    startDate: typeof value.startDate === "string" ? value.startDate : undefined,
    endDate: typeof value.endDate === "string" ? value.endDate : undefined,
    ref: typeof value.ref === "string" ? value.ref : undefined,
  };
}

export async function readTeamMembers(root: string): Promise<TeamMembersMap> {
  try {
    const raw = await readFile(await safeReportPath(root, "team-members.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.members)) return { loaded: true, members: [] };
    return { loaded: true, members: parsed.members.flatMap((member) => parseMember(member) ?? []) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { loaded: false, members: [] };
    throw error;
  }
}

export async function writeDefaultTeamMembers(root: string, unmappedIdentities: readonly GitWeeklyUnmappedIdentity[]): Promise<void> {
  await writeJsonAtomic(await safeReportPath(root, "team-members.json"), {
    version: 1,
    members: [{ id: "member-id", displayName: "Display Name", aliases: [{ name: "Git Name", emailHash: "sha256:<lowercase-email-sha256>" }] }],
    unmappedIdentities,
  });
}

export async function mergeReportIndex(root: string, next: ReportIndexEntry): Promise<readonly ReportIndexEntry[]> {
  const existing = await readJsonFile<unknown>(await safeReportPath(root, "index.json"), { version: 1, reports: [] });
  const reports = isRecord(existing) && Array.isArray(existing.reports) ? existing.reports.flatMap((entry) => indexEntry(entry) ?? []) : [];
  const byId = new Map(reports.map((entry) => [entry.reportId, entry]));
  byId.set(next.reportId, next);
  return [...byId.values()].sort((left, right) => left.reportId.localeCompare(right.reportId));
}
