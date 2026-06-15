import type { TuiSlotPlugin } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import type { DashboardSnapshotResult } from "./dashboard-snapshot.js";

export const TINY_CHU_TUI_LOGO_TEXT = "TinyChu";

const DEFAULT_TEXT_COLUMNS = 76;
const COMPACT_TEXT_COLUMNS = 64;
const NO_ACTIVE_TASK_TEXT = "No active Tiny-Chu task";

export interface TinyChuSolidRuntime {
  readonly createElement: (tag: "text") => JSX.Element;
  readonly insert: (parent: JSX.Element, accessor: string | (() => string)) => JSX.Element;
}

export interface TinyChuDashboardState {
  readonly snapshot?: DashboardSnapshotResult;
  readonly error?: string;
  readonly loading: boolean;
}

export function renderTinyChuHomeLogo(runtime: TinyChuSolidRuntime): JSX.Element {
  return renderText(runtime, TINY_CHU_TUI_LOGO_TEXT);
}

export function tinyChuDisplayColumns(value: string): number {
  let columns = 0;
  for (const character of value) columns += characterColumns(character);
  return columns;
}

export function createTinyChuDashboardSlotPlugin(runtime: TinyChuSolidRuntime, state: () => TinyChuDashboardState): TuiSlotPlugin {
  return {
    slots: {
      home_logo: () => renderTinyChuHomeLogo(runtime),
      home_prompt_right: () => renderDynamicText(runtime, () => dashboardSection(state(), "home_prompt_right")),
      sidebar_title: () => renderDynamicText(runtime, () => dashboardSection(state(), "sidebar_title")),
      sidebar_content: () => renderDynamicText(runtime, () => dashboardSection(state(), "sidebar_content")),
      sidebar_footer: () => renderDynamicText(runtime, () => dashboardSection(state(), "sidebar_footer")),
      home_bottom: () => renderDynamicText(runtime, () => dashboardSection(state(), "home_bottom")),
    },
  };
}

function renderText(runtime: TinyChuSolidRuntime, value: string): JSX.Element {
  const text = runtime.createElement("text");
  runtime.insert(text, value);
  return text;
}

function renderDynamicText(runtime: TinyChuSolidRuntime, value: () => string): JSX.Element {
  const text = runtime.createElement("text");
  runtime.insert(text, value);
  return text;
}

function dashboardSection(state: TinyChuDashboardState, section: "home_prompt_right" | "sidebar_title" | "sidebar_content" | "sidebar_footer" | "home_bottom"): string {
  const fallback = loadingText(state);
  if (fallback) return fallback;
  const snapshot = state.snapshot;
  if (!snapshot) return "TinyChu status loading";
  if (section === "home_prompt_right") return homePromptRight(snapshot);
  if (section === "sidebar_title") return sidebarTitle(snapshot);
  if (section === "sidebar_content") return sidebarContent(snapshot);
  if (section === "sidebar_footer") return sidebarFooter(snapshot);
  return homeBottom(snapshot);
}

function loadingText(state: TinyChuDashboardState): string | undefined {
  if (state.loading && !state.snapshot && !state.error) return "TinyChu status loading";
  if (state.error) return clip(`TinyChu status degraded: ${state.error}`);
  return undefined;
}

function homePromptRight(snapshot: DashboardSnapshotResult): string {
  return clip(`${snapshot.runtimeMode} | ${snapshot.provider.model} | provider ${snapshot.provider.health} | ctx ${snapshot.contextBudget.status}`);
}

function sidebarTitle(snapshot: DashboardSnapshotResult): string {
  const priority = snapshot.task.priority ? ` [${snapshot.task.priority}]` : "";
  const workflow = snapshot.workflow.status ? ` | ${snapshot.workflow.status}` : "";
  return clip(`${taskTitle(snapshot)}${priority}${workflow}`);
}

function sidebarContent(snapshot: DashboardSnapshotResult): string {
  return [
    `task ${taskTitle(snapshot)}`,
    statusCounts(snapshot),
    workflowLine(snapshot),
    evidenceLine(snapshot),
    snapshot.task.openQuestions.length > 0 ? `questions ${snapshot.task.openQuestions.join("; ")}` : "questions none",
    snapshot.task.evidenceRefs.length > 0 ? `refs ${snapshot.task.evidenceRefs.join(", ")}` : "refs none",
  ].map((line) => clip(line)).join("\n");
}

function sidebarFooter(snapshot: DashboardSnapshotResult): string {
  const retryAt = snapshot.publicJobs.nextRetryAt ? ` next ${snapshot.publicJobs.nextRetryAt}` : "";
  return clip(`health ${snapshot.status} | retryable ${snapshot.publicJobs.retryable}${retryAt}`);
}

function homeBottom(snapshot: DashboardSnapshotResult): string {
  const info = snapshot.interrupts.find((item) => item.severity === "info");
  if (info) return clip(`TinyChu ${info.title}: ${info.message}`, COMPACT_TEXT_COLUMNS);
  if (snapshot.task.openQuestions.length > 0) return clip(`TinyChu ${snapshot.task.openQuestions.length} open question(s)`, COMPACT_TEXT_COLUMNS);
  return "TinyChu dashboard ready";
}

function taskTitle(snapshot: DashboardSnapshotResult): string {
  if (!snapshot.task.found) return NO_ACTIVE_TASK_TEXT;
  return clip(snapshot.task.title ?? snapshot.task.id ?? NO_ACTIVE_TASK_TEXT, COMPACT_TEXT_COLUMNS);
}

function statusCounts(snapshot: DashboardSnapshotResult): string {
  const counts = snapshot.publicJobs.byStatus.map((item) => `${item.status} ${item.count}`).join(", ");
  return counts ? `jobs ${snapshot.publicJobs.total} (${counts})` : `jobs ${snapshot.publicJobs.total}`;
}

function workflowLine(snapshot: DashboardSnapshotResult): string {
  if (!snapshot.workflow.found) return `workflow ${snapshot.workflow.warning ?? "not linked"}`;
  return `workflow ${snapshot.workflow.status ?? "unknown"} ${snapshot.workflow.statusLine ?? ""}`.trim();
}

function evidenceLine(snapshot: DashboardSnapshotResult): string {
  const warnings = snapshot.evidence.warnings.length > 0 ? `; ${snapshot.evidence.warnings.join("; ")}` : "";
  const commands = snapshot.evidence.verificationCommands.length > 0 ? `; verify ${snapshot.evidence.verificationCommands.join(", ")}` : "";
  return `evidence ${snapshot.evidence.status}${warnings}${commands}`;
}

function clip(value: string, maxColumns = DEFAULT_TEXT_COLUMNS): string {
  if (tinyChuDisplayColumns(value) <= maxColumns) return value;
  const marker = "...";
  const markerColumns = tinyChuDisplayColumns(marker);
  let output = "";
  let columns = 0;
  const limit = Math.max(0, maxColumns - markerColumns);
  for (const character of value) {
    const width = characterColumns(character);
    if (columns + width > limit) break;
    output += character;
    columns += width;
  }
  return `${output}${marker}`;
}

function characterColumns(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f)
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1f64f)
    || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff)
  ) return 2;
  return 1;
}
