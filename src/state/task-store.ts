import { readdir } from "node:fs/promises";
import path from "node:path";
import { resolveTinyInfiPaths } from "./paths.js";
import { appendJsonLine, ensureDir, readJsonFile, readJsonLines, writeJsonAtomic } from "./file-store.js";

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

function taskId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `T-${stamp}`;
}

function assertTaskId(id: string): void {
  if (!/^T-[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid task id: ${id}`);
}

function taskFile(root: string | undefined, id: string): string {
  assertTaskId(id);
  return path.join(resolveTinyInfiPaths(root).tasksDir, `${id}.json`);
}

function checkpointFile(root: string | undefined, id: string): string {
  assertTaskId(id);
  return path.join(resolveTinyInfiPaths(root).tasksDir, `${id}.checkpoints.jsonl`);
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

export class TaskStore {
  readonly root?: string;
  private readonly now: () => Date;

  constructor(options: TaskStoreOptions = {}) {
    this.root = options.root;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: { title: string; priority?: TinyTask["priority"]; notes?: string[]; planRef?: string }): Promise<TinyTask> {
    const now = this.now();
    const iso = now.toISOString();
    const task: TinyTask = {
      id: taskId(now),
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
    await writeJsonAtomic(taskFile(this.root, task.id), task);
    return task;
  }

  async get(id: string): Promise<TinyTask | undefined> {
    const sentinel = Symbol("missing");
    const value = await readJsonFile<TinyTask | typeof sentinel>(taskFile(this.root, id), sentinel);
    if (value === sentinel) return undefined;
    return this.withSidecarCheckpoints(value);
  }

  async list(status?: TaskStatus): Promise<TinyTask[]> {
    const dir = resolveTinyInfiPaths(this.root).tasksDir;
    await ensureDir(dir);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const tasks = await Promise.all(files.map((file) => readJsonFile<TinyTask | undefined>(path.join(dir, file), undefined)));
    const normalized = await Promise.all(tasks.filter(isTinyTask).map((task) => this.withSidecarCheckpoints(task)));
    return normalized.filter((task) => !status || task.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(id: string, patch: Partial<Omit<TinyTask, "id" | "createdAt">>): Promise<TinyTask> {
    const current = await this.get(id);
    if (!current) throw new Error(`Task not found: ${id}`);
    const updated: TinyTask = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: this.now().toISOString(),
    };
    await writeJsonAtomic(taskFile(this.root, id), updated);
    return updated;
  }

  async checkpoint(id: string, input: { summary: string; artifactType?: string; passIndex?: number; nextSteps?: string[]; evidenceRefs?: string[]; openQuestions?: string[]; verificationCommands?: string[] }): Promise<TaskCheckpoint> {
    const current = await this.get(id);
    if (!current) throw new Error(`Task not found: ${id}`);
    const raw = await readJsonFile<TinyTask | undefined>(taskFile(this.root, id), undefined);
    const inlineCheckpoints = raw ? normalizeTask(raw).checkpoints : [];
    const existing = current.checkpoints ?? [];
    const checkpoint: TaskCheckpoint = {
      sequence: existing.length + 1,
      summary: input.summary,
      artifactType: input.artifactType,
      passIndex: input.passIndex,
      nextSteps: input.nextSteps ?? [],
      evidenceRefs: input.evidenceRefs ?? [],
      openQuestions: input.openQuestions ?? [],
      verificationCommands: input.verificationCommands ?? [],
      createdAt: this.now().toISOString(),
    };
    await appendJsonLine(checkpointFile(this.root, id), checkpoint);
    const updated: TinyTask = {
      ...current,
      checkpoints: inlineCheckpoints,
      evidenceRefs: [...new Set([...current.evidenceRefs, ...checkpoint.evidenceRefs])].sort(),
      updatedAt: checkpoint.createdAt,
    };
    await writeJsonAtomic(taskFile(this.root, id), updated, { compact: true });
    return checkpoint;
  }

  private async withSidecarCheckpoints(task: TinyTask): Promise<TinyTask> {
    const normalized = normalizeTask(task);
    const sidecar = await readJsonLines<TaskCheckpoint>(checkpointFile(this.root, normalized.id), []);
    const bySequence = new Map<number, TaskCheckpoint>();
    for (const checkpoint of normalized.checkpoints) bySequence.set(checkpoint.sequence, normalizeCheckpoint(checkpoint));
    for (const checkpoint of sidecar) bySequence.set(checkpoint.sequence, normalizeCheckpoint(checkpoint));
    return { ...normalized, checkpoints: [...bySequence.values()].sort((a, b) => a.sequence - b.sequence) };
  }
}
