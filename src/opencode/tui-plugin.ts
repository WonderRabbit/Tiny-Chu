import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createDashboardSnapshot, type DashboardSnapshotInterrupt, type DashboardSnapshotResult } from "./dashboard-snapshot.js";
import {
  createTinyChuDashboardSlotPlugin,
  renderTinyChuHomeLogo,
  TINY_CHU_TUI_LOGO_TEXT,
  tinyChuDisplayColumns,
  type TinyChuDashboardState,
  type TinyChuSolidRuntime,
} from "./tui-dashboard-renderer.js";

declare const process: {
  readonly cwd: () => string;
};

declare const setInterval: (callback: () => void, ms: number) => unknown;
declare const clearInterval: (handle: unknown) => void;

export { renderTinyChuHomeLogo, TINY_CHU_TUI_LOGO_TEXT, tinyChuDisplayColumns, type TinyChuSolidRuntime };

const DEFAULT_REFRESH_MS = 5000;

export type TinyChuDashboardSnapshotLoader = (root: string | undefined, input: Record<string, unknown>) => Promise<DashboardSnapshotResult>;
export type TinyChuTuiIntervalCallback = () => void | Promise<void>;

export interface TinyChuTuiTimer {
  readonly setInterval: (callback: TinyChuTuiIntervalCallback, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

interface TinyChuRefreshControl {
  disposed: boolean;
  generation: number;
}

let loadSolidRuntime = async (): Promise<TinyChuSolidRuntime> => {
  const runtime = await import("@opentui/solid");
  return {
    createElement: (tag) => runtime.createElement(tag),
    insert: (parent, accessor) => runtime.insert(parent, accessor),
  };
};

let loadDashboardSnapshot: TinyChuDashboardSnapshotLoader = createDashboardSnapshot;

let tuiTimer: TinyChuTuiTimer = {
  setInterval(callback, ms) {
    const handle = setInterval(() => {
      void callback();
    }, ms);
    return () => clearInterval(handle);
  },
  clearInterval(handle) {
    if (typeof handle === "function") handle();
  },
};

export function setTinyChuTuiRuntimeLoaderForTest(loader: () => Promise<TinyChuSolidRuntime>): () => void {
  const previous = loadSolidRuntime;
  loadSolidRuntime = loader;
  return () => {
    loadSolidRuntime = previous;
  };
}

export function setTinyChuDashboardSnapshotLoaderForTest(loader: TinyChuDashboardSnapshotLoader): () => void {
  const previous = loadDashboardSnapshot;
  loadDashboardSnapshot = loader;
  return () => {
    loadDashboardSnapshot = previous;
  };
}

export function setTinyChuTuiTimerForTest(timer: TinyChuTuiTimer): () => void {
  const previous = tuiTimer;
  tuiTimer = timer;
  return () => {
    tuiTimer = previous;
  };
}

function textInput(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function positiveInteger(input: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = input?.[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function networkModeInput(value: unknown): string | undefined {
  if (value === "disabled" || value === "loopback_only" || value === "explicit_hosts") return value;
  return undefined;
}

function modeInput(value: unknown): unknown {
  if (value === 1 || value === 2 || typeof value === "string") return value;
  return undefined;
}

function resolveTuiRoot(api: TuiPluginApi, options: Record<string, unknown> | undefined): string | undefined {
  return textInput(options, "root") ?? textInput(api.state.path, "worktree") ?? textInput(api.state.path, "directory") ?? process.cwd();
}

function snapshotInput(options: Record<string, unknown> | undefined): Record<string, unknown> {
  const input: Record<string, unknown> = { includeProviderPreflight: options?.includeProviderPreflight === true };
  for (const key of ["runId", "taskId", "provider", "endpoint"] as const) {
    const value = textInput(options, key);
    if (value) input[key] = value;
  }
  const networkMode = networkModeInput(options?.networkMode);
  const mode = modeInput(options?.mode);
  const maxJobs = positiveInteger(options, "maxJobs", 0);
  const maxEvidenceRefs = positiveInteger(options, "maxEvidenceRefs", 0);
  if (networkMode) input.networkMode = networkMode;
  if (mode !== undefined) input.mode = mode;
  if (maxJobs > 0) input.maxJobs = maxJobs;
  if (maxEvidenceRefs > 0) input.maxEvidenceRefs = maxEvidenceRefs;
  return input;
}

function toastVariant(severity: DashboardSnapshotInterrupt["severity"]): "info" | "success" | "warning" | "error" {
  if (severity === "danger") return "error";
  if (severity === "success") return "success";
  if (severity === "warning") return "warning";
  return "info";
}

async function emitDashboardInterrupts(api: TuiPluginApi, snapshot: DashboardSnapshotResult, seen: Set<string>): Promise<void> {
  for (const item of snapshot.interrupts) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    if (item.severity === "info") continue;
    if (item.severity === "danger") {
      await api.attention.notify({ title: item.title, message: item.message, notification: true, sound: { name: "error" } });
    } else {
      api.ui.toast({ variant: toastVariant(item.severity), title: item.title, message: item.message });
    }
  }
}

function createDashboardState(initial: TinyChuDashboardState): readonly [() => TinyChuDashboardState, (value: TinyChuDashboardState) => TinyChuDashboardState] {
  let value = initial;
  return [
    () => value,
    (next) => {
      value = next;
      return value;
    },
  ];
}

function updateDashboardState(api: TuiPluginApi, current: () => TinyChuDashboardState, setState: (value: TinyChuDashboardState) => TinyChuDashboardState, patch: Partial<TinyChuDashboardState>): void {
  setState({ ...current(), ...patch });
  api.renderer.requestRender();
}

async function refreshDashboard(api: TuiPluginApi, current: () => TinyChuDashboardState, setState: (value: TinyChuDashboardState) => TinyChuDashboardState, seen: Set<string>, control: TinyChuRefreshControl, root: string | undefined, input: Record<string, unknown>): Promise<void> {
  if (control.disposed) return;
  control.generation += 1;
  const generation = control.generation;
  updateDashboardState(api, current, setState, { loading: !current().snapshot });
  try {
    const snapshot = await loadDashboardSnapshot(root, input);
    if (control.disposed || generation !== control.generation) return;
    updateDashboardState(api, current, setState, { snapshot, error: undefined, loading: false });
    await emitDashboardInterrupts(api, snapshot, seen);
  } catch (error) {
    if (control.disposed || generation !== control.generation) return;
    const message = error instanceof Error ? error.message : "Tiny-Chu dashboard snapshot failed.";
    updateDashboardState(api, current, setState, { error: message, loading: false });
  }
}

export const TinyChuOpenCodeTuiPlugin: TuiPluginModule = {
  id: "tiny-chu.logo",
  async tui(api, options) {
    const runtime = await loadSolidRuntime();
    const root = resolveTuiRoot(api, options);
    const input = snapshotInput(options);
    const refreshMs = positiveInteger(options, "refreshMs", DEFAULT_REFRESH_MS);
    const [state, setState] = createDashboardState({ loading: true });
    const seenInterruptKeys = new Set<string>();
    const refreshControl: TinyChuRefreshControl = { disposed: false, generation: 0 };

    api.slots.register(createTinyChuDashboardSlotPlugin(runtime, state));
    const interval = tuiTimer.setInterval(() => refreshDashboard(api, state, setState, seenInterruptKeys, refreshControl, root, input), refreshMs);
    api.lifecycle.onDispose(() => {
      refreshControl.disposed = true;
      tuiTimer.clearInterval(interval);
    });
    void refreshDashboard(api, state, setState, seenInterruptKeys, refreshControl, root, input);
  },
};

export default TinyChuOpenCodeTuiPlugin;
