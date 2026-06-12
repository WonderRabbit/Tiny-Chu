import { readdir } from "node:fs/promises";
import path from "node:path";
import { resolveTinyInfiPaths } from "./paths.js";
import { ensureDir, readJsonFile, writeJsonAtomic } from "./file-store.js";

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
}

export interface TaskStoreOptions {
  root?: string;
  now?: () => Date;
}

function taskId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `T-${stamp}`;
}

function taskFile(root: string | undefined, id: string): string {
  return path.join(resolveTinyInfiPaths(root).tasksDir, `${id}.json`);
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
    };
    await writeJsonAtomic(taskFile(this.root, task.id), task);
    return task;
  }

  async get(id: string): Promise<TinyTask | undefined> {
    const sentinel = Symbol("missing");
    const value = await readJsonFile<TinyTask | typeof sentinel>(taskFile(this.root, id), sentinel);
    return value === sentinel ? undefined : value;
  }

  async list(status?: TaskStatus): Promise<TinyTask[]> {
    const dir = resolveTinyInfiPaths(this.root).tasksDir;
    await ensureDir(dir);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const tasks = await Promise.all(files.map((file) => readJsonFile<TinyTask>(path.join(dir, file), undefined as never)));
    return tasks.filter((task) => !status || task.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
}
