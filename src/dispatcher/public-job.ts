import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveTinyChuPaths } from "../state/paths.js";
import { ensureDir, readJsonFile, writeJsonAtomic } from "../state/file-store.js";
import { tinyStatePublicJobLockName, withTinyStateLock } from "../state/lock-store.js";

export type PublicJobStatus = "queued" | "running" | "checkpointed" | "retry_wait" | "done" | "failed" | "cancelled";

export interface PublicJobBudget {
  inputTokensMax: number;
  outputTokensMax: number;
  totalTokensHard: number;
}

export interface PublicJob {
  id: string;
  taskId?: string;
  kind: "public.analysis" | "public.review" | "public.plan";
  status: PublicJobStatus;
  owner: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  retryAt?: string;
  resumeFrom?: string;
  budget: PublicJobBudget;
  context: {
    rulesRefs: string[];
    wikiRefs: string[];
    planRef?: string;
    checkpointSummary?: string;
    prompt: string;
  };
  contract: {
    mustReturn: string[];
    format: "markdown_sections" | "json";
    artifactType?: string;
    formatTemplate?: {
      artifactType: string;
      preparationTool: "artifact_format_template";
      requiredBefore: "artifact_generation";
    };
  };
  result?: string;
  error?: string;
}

export interface RateGateSnapshot {
  now: string;
  requestCount: number;
  tokenCount: number;
  softRpm: number;
  softTpm: number;
  hardRpm: number;
  hardTpm: number;
  allowed: boolean;
  reason?: string;
}

export interface PublicDispatcherOptions {
  root?: string;
  now?: () => Date;
  softRpm?: number;
  softTpm?: number;
  hardRpm?: number;
  hardTpm?: number;
  owner?: string;
}

interface RateEvent {
  at: string;
  tokens: number;
}

function jobIdCandidate(now: Date, sequence: number): string {
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  return `J-${stamp}-${sequence.toString(36).padStart(4, "0")}`;
}

function assertJobId(id: string): void {
  if (!/^J-[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid public job id: ${id}`);
}

function jobFile(root: string | undefined, id: string): string {
  assertJobId(id);
  return path.join(resolveTinyChuPaths(root).publicJobsDir, `${id}.json`);
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

async function nextJobId(root: string | undefined, now: Date): Promise<string> {
  for (let sequence = 1; ; sequence += 1) {
    const id = jobIdCandidate(now, sequence);
    if (!(await fileExists(jobFile(root, id)))) return id;
  }
}

function isPublicJob(job: PublicJob | undefined): job is PublicJob {
  return job !== undefined;
}

export class PublicDispatcher {
  readonly root?: string;
  private readonly now: () => Date;
  private readonly softRpm: number;
  private readonly softTpm: number;
  private readonly hardRpm: number;
  private readonly hardTpm: number;
  private readonly owner: string;
  private events: RateEvent[] = [];

  constructor(options: PublicDispatcherOptions = {}) {
    this.root = options.root;
    this.now = options.now ?? (() => new Date());
    this.softRpm = options.softRpm ?? 12;
    this.softTpm = options.softTpm ?? 14_000;
    this.hardRpm = options.hardRpm ?? 16;
    this.hardTpm = options.hardTpm ?? 18_000;
    this.owner = options.owner ?? "public-qwen";
  }

  async dispatch(input: {
    taskId?: string;
    kind?: PublicJob["kind"];
    prompt: string;
    rulesRefs?: string[];
    wikiRefs?: string[];
    planRef?: string;
    checkpointSummary?: string;
    budget?: Partial<PublicJobBudget>;
    mustReturn?: string[];
    artifactType?: string;
    format?: "markdown_sections" | "json";
  }): Promise<PublicJob> {
    return withTinyStateLock(this.root, "public-jobs-create.lock", async (lock) => {
      const now = this.now();
      const iso = now.toISOString();
      const mustReturn = input.mustReturn && input.mustReturn.length > 0 ? input.mustReturn : ["findings", "changed_files", "risks", "next_step"];
      const budget: PublicJobBudget = {
        inputTokensMax: input.budget?.inputTokensMax ?? 2400,
        outputTokensMax: input.budget?.outputTokensMax ?? 1200,
        totalTokensHard: input.budget?.totalTokensHard ?? 4000,
      };
      const job: PublicJob = {
        id: await nextJobId(this.root, now),
        taskId: input.taskId,
        kind: input.kind ?? "public.analysis",
        status: "queued",
        owner: this.owner,
        attempt: 1,
        createdAt: iso,
        updatedAt: iso,
        budget,
        context: {
          rulesRefs: input.rulesRefs ?? [],
          wikiRefs: input.wikiRefs ?? [],
          planRef: input.planRef,
          checkpointSummary: input.checkpointSummary,
          prompt: input.prompt,
        },
        contract: {
          mustReturn,
          format: input.format ?? "markdown_sections",
          artifactType: input.artifactType,
          ...(input.artifactType ? { formatTemplate: { artifactType: input.artifactType, preparationTool: "artifact_format_template", requiredBefore: "artifact_generation" as const } } : {}),
        },
      };
      await lock.assertActive();
      await writeJsonAtomic(jobFile(this.root, job.id), job);
      return job;
    });
  }

  async get(id: string): Promise<PublicJob | undefined> {
    const sentinel = Symbol("missing");
    const value = await readJsonFile<PublicJob | typeof sentinel>(jobFile(this.root, id), sentinel);
    return value === sentinel ? undefined : value;
  }

  async list(status?: PublicJobStatus): Promise<PublicJob[]> {
    const dir = resolveTinyChuPaths(this.root).publicJobsDir;
    await ensureDir(dir);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const jobs = await Promise.all(files.map((file) => readJsonFile<PublicJob | undefined>(path.join(dir, file), undefined)));
    return jobs.filter(isPublicJob).filter((job) => !status || job.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async checkpoint(id: string, summary: string, partialResult?: string): Promise<PublicJob> {
    return this.mutate(id, (job) => ({
      ...job,
      status: "checkpointed",
      updatedAt: this.now().toISOString(),
      context: { ...job.context, checkpointSummary: summary },
      result: partialResult ?? job.result,
    }));
  }

  async retry(id: string, reason = "retry requested"): Promise<PublicJob> {
    return this.mutate(id, (job) => {
      const delaySeconds = Math.min(90, [15, 30, 60][Math.max(0, Math.min(job.attempt - 1, 2))] ?? 90);
      const retryAt = new Date(this.now().getTime() + delaySeconds * 1000).toISOString();
      return { ...job, status: "retry_wait", attempt: job.attempt + 1, retryAt, updatedAt: this.now().toISOString(), error: reason };
    });
  }

  async complete(id: string, result: string): Promise<PublicJob> {
    return this.mutate(id, (job) => ({ ...job, status: "done", result, updatedAt: this.now().toISOString(), error: undefined }));
  }

  async cancel(id: string, reason = "cancelled"): Promise<PublicJob> {
    return this.mutate(id, (job) => ({ ...job, status: "cancelled", error: reason, updatedAt: this.now().toISOString() }));
  }

  checkRateGate(tokens: number): RateGateSnapshot {
    const now = this.now();
    const cutoff = now.getTime() - 60_000;
    this.events = this.events.filter((event) => Date.parse(event.at) >= cutoff);
    const requestCount = this.events.length;
    const tokenCount = this.events.reduce((sum, event) => sum + event.tokens, 0);
    const projectedRequests = requestCount + 1;
    const projectedTokens = tokenCount + tokens;
    if (projectedRequests > this.hardRpm || projectedTokens > this.hardTpm) {
      return this.snapshot(now, requestCount, tokenCount, false, "hard_limit");
    }
    if (projectedRequests > this.softRpm || projectedTokens > this.softTpm) {
      return this.snapshot(now, requestCount, tokenCount, false, "soft_limit");
    }
    return this.snapshot(now, requestCount, tokenCount, true);
  }

  recordUsage(tokens: number): RateGateSnapshot {
    const snapshot = this.checkRateGate(tokens);
    if (snapshot.allowed) this.events.push({ at: this.now().toISOString(), tokens });
    return snapshot;
  }

  private snapshot(now: Date, requestCount: number, tokenCount: number, allowed: boolean, reason?: string): RateGateSnapshot {
    return { now: now.toISOString(), requestCount, tokenCount, softRpm: this.softRpm, softTpm: this.softTpm, hardRpm: this.hardRpm, hardTpm: this.hardTpm, allowed, reason };
  }

  private async require(id: string): Promise<PublicJob> {
    const job = await this.get(id);
    if (!job) throw new Error(`Public job not found: ${id}`);
    return job;
  }

  private async save(job: PublicJob): Promise<PublicJob> {
    await writeJsonAtomic(jobFile(this.root, job.id), job);
    return job;
  }

  private async mutate(id: string, update: (job: PublicJob) => PublicJob): Promise<PublicJob> {
    assertJobId(id);
    return withTinyStateLock(this.root, tinyStatePublicJobLockName(id), async (lock) => {
      const updated = update(await this.require(id));
      await lock.assertActive();
      return this.save(updated);
    });
  }
}
