import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveTinyChuPaths } from "./paths.js";
import { appendJsonLine, ensureDir, readJsonFile, readJsonLines, writeJsonAtomic } from "./file-store.js";
import { tinyStateTaskLockName, withTinyStateLock } from "./lock-store.js";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";

export interface TinyTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: "low" | "normal" | "high";
  notes: string[];
  createdAt: string;
  updatedAt: string;
  planRef?: string;
  evidenceRefs: string[];
  publicJobIds: string[];
  checkpoints: TaskCheckpoint[];
}

export interface TaskCheckpoint {
  sequence: number;
  summary: string;
  artifactType?: string;
  passIndex?: number;
  nextSteps: string[];
  evidenceRefs: string[];
  openQuestions: string[];
  verificationCommands: string[];
  createdAt: string;
}

export interface TaskStoreOptions {
  root?: string;
  now?: () => Date;
}

const checkpointLocks = new Map<string, Promise<void>>();

function taskIdCandidate(now: Date, sequence: number): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const base = `T-${stamp}`;
  return sequence === 0 ? base : `${base}-${sequence.toString(36).padStart(4, "0")}`;
}

function assertTaskId(id: string): void {
  if (!/^T-[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid task id: ${id}`);
}

function taskFile(root: string | undefined, id: string): string {
  assertTaskId(id);
  return path.join(resolveTinyChuPaths(root).tasksDir, `${id}.json`);
}

function checkpointFile(root: string | undefined, id: string): string {
  assertTaskId(id);
  return path.join(resolveTinyChuPaths(root).tasksDir, `${id}.checkpoints.jsonl`);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function nextTaskId(root: string | undefined, now: Date): Promise<string> {
  for (let sequence = 0; ; sequence += 1) {
    const id = taskIdCandidate(now, sequence);
    if (!(await fileExists(taskFile(root, id)))) return id;
  }
}

function isTinyTask(task: TinyTask | undefined): task is TinyTask {
  return task !== undefined;
}

function normalizeCheckpoint(checkpoint: TaskCheckpoint): TaskCheckpoint {
  return {
    ...checkpoint,
    nextSteps: checkpoint.nextSteps ?? [],
    evidenceRefs: checkpoint.evidenceRefs ?? [],
    openQuestions: checkpoint.openQuestions ?? [],
    verificationCommands: checkpoint.verificationCommands ?? [],
  };
}

function normalizeTask(task: TinyTask): TinyTask {
  return {
    ...task,
    notes: task.notes ?? [],
    evidenceRefs: task.evidenceRefs ?? [],
    publicJobIds: task.publicJobIds ?? [],
    checkpoints: (task.checkpoints ?? []).map(normalizeCheckpoint),
  };
}

function checkpointKey(checkpoint: TaskCheckpoint): string {
  return JSON.stringify(checkpoint);
}

function compareCheckpoints(left: TaskCheckpoint, right: TaskCheckpoint): number {
  return left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt) || left.summary.localeCompare(right.summary);
}

function mergeCheckpoints(inline: readonly TaskCheckpoint[], sidecar: readonly TaskCheckpoint[]): TaskCheckpoint[] {
  const checkpoints: TaskCheckpoint[] = [];
  const seen = new Set<string>();
  for (const checkpoint of [...inline, ...sidecar]) {
    const normalized = normalizeCheckpoint(checkpoint);
    const key = checkpointKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    checkpoints.push(normalized);
  }
  return checkpoints.sort(compareCheckpoints);
}

function nextCheckpointSequence(checkpoints: readonly TaskCheckpoint[]): number {
  return checkpoints.reduce((max, checkpoint) => Math.max(max, checkpoint.sequence), 0) + 1;
}

async function withCheckpointLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = checkpointLocks.get(id) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => gate, () => gate);
  checkpointLocks.set(id, chain);
  await previous.then(() => undefined, () => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (checkpointLocks.get(id) === chain) checkpointLocks.delete(id);
  }
}

export class TaskStore {
  readonly root?: string;
  private readonly now: () => Date;

  constructor(options: TaskStoreOptions = {}) {
    this.root = options.root;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: { title: string; priority?: TinyTask["priority"]; notes?: string[]; planRef?: string }): Promise<TinyTask> {
    return withTinyStateLock(this.root, "tasks-create.lock", async (lock) => {
      const now = this.now();
      const iso = now.toISOString();
      const task: TinyTask = {
        id: await nextTaskId(this.root, now),
        title: input.title,
        status: "todo",
        priority: input.priority ?? "normal",
        notes: input.notes ?? [],
        createdAt: iso,
        updatedAt: iso,
        planRef: input.planRef,
        evidenceRefs: [],
        publicJobIds: [],
        checkpoints: [],
      };
      await lock.assertActive();
      await writeJsonAtomic(taskFile(this.root, task.id), task);
      return task;
    });
  }

  async get(id: string): Promise<TinyTask | undefined> {
    const sentinel = Symbol("missing");
    const value = await readJsonFile<TinyTask | typeof sentinel>(taskFile(this.root, id), sentinel);
    if (value === sentinel) return undefined;
    return this.withSidecarCheckpoints(value);
  }

  async list(status?: TaskStatus): Promise<TinyTask[]> {
    const dir = resolveTinyChuPaths(this.root).tasksDir;
    await ensureDir(dir);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const tasks = await Promise.all(files.map((file) => readJsonFile<TinyTask | undefined>(path.join(dir, file), undefined)));
    const normalized = await Promise.all(tasks.filter(isTinyTask).map((task) => this.withSidecarCheckpoints(task)));
    return normalized.filter((task) => !status || task.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(id: string, patch: Partial<Omit<TinyTask, "id" | "createdAt">>): Promise<TinyTask> {
    assertTaskId(id);
    return withTinyStateLock(this.root, tinyStateTaskLockName(id), async (lock) => {
      const current = await this.get(id);
      if (!current) throw new Error(`Task not found: ${id}`);
      const updated: TinyTask = {
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: this.now().toISOString(),
      };
      await lock.assertActive();
      await writeJsonAtomic(taskFile(this.root, id), updated);
      return updated;
    });
  }

  async checkpoint(id: string, input: { summary: string; artifactType?: string; passIndex?: number; nextSteps?: string[]; evidenceRefs?: string[]; openQuestions?: string[]; verificationCommands?: string[] }): Promise<TaskCheckpoint> {
    assertTaskId(id);
    return withCheckpointLock(id, async () => {
      return withTinyStateLock(this.root, tinyStateTaskLockName(id), async (lock) => {
        const current = await this.get(id);
        if (!current) throw new Error(`Task not found: ${id}`);
        const raw = await readJsonFile<TinyTask | undefined>(taskFile(this.root, id), undefined);
        const inlineCheckpoints = raw ? normalizeTask(raw).checkpoints : [];
        const checkpoint: TaskCheckpoint = {
          sequence: nextCheckpointSequence(current.checkpoints),
          summary: input.summary,
          artifactType: input.artifactType,
          passIndex: input.passIndex,
          nextSteps: input.nextSteps ?? [],
          evidenceRefs: input.evidenceRefs ?? [],
          openQuestions: input.openQuestions ?? [],
          verificationCommands: input.verificationCommands ?? [],
          createdAt: this.now().toISOString(),
        };
        await lock.assertActive();
        await appendJsonLine(checkpointFile(this.root, id), checkpoint);
        const updated: TinyTask = {
          ...current,
          checkpoints: inlineCheckpoints,
          evidenceRefs: [...new Set([...current.evidenceRefs, ...checkpoint.evidenceRefs])].sort(),
          updatedAt: checkpoint.createdAt,
        };
        await lock.assertActive();
        await writeJsonAtomic(taskFile(this.root, id), updated, { compact: true });
        return checkpoint;
      });
    });
  }

  private async withSidecarCheckpoints(task: TinyTask): Promise<TinyTask> {
    const normalized = normalizeTask(task);
    const sidecar = await readJsonLines<TaskCheckpoint>(checkpointFile(this.root, normalized.id), []);
    const checkpoints = mergeCheckpoints(normalized.checkpoints, sidecar);
    const evidenceRefs = new Set(normalized.evidenceRefs);
    for (const checkpoint of checkpoints) {
      for (const ref of checkpoint.evidenceRefs) evidenceRefs.add(ref);
    }
    return { ...normalized, checkpoints, evidenceRefs: [...evidenceRefs].sort() };
  }
}
