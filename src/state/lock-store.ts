import { randomUUID, createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir } from "./file-store.js";
import { resolveTinyChuPaths } from "./paths.js";

export const TINY_STATE_LOCK_STALE_MS = 30_000;
export const TINY_STATE_LOCK_TIMEOUT_MS = 10_000;
export const TINY_STATE_LOCK_POLL_MS = 25;
export const TINY_STATE_LOCK_RENEW_MS = 5_000;

interface LockOwner {
  readonly lockId: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly renewedAt: string;
  readonly expiresAt: string;
}

export interface TinyStateLockOptions {
  readonly staleMs?: number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly renewMs?: number;
  readonly nonBlocking?: boolean;
}

export interface TinyStateLock {
  readonly name: string;
  readonly path: string;
  readonly lockId: string;
  readonly compromisedError: Error | undefined;
  readonly assertActive: () => Promise<void>;
  readonly release: () => Promise<void>;
}

export class TinyStateLockTimeoutError extends Error {
  readonly code = "TINY_STATE_LOCK_TIMEOUT";
  readonly name = "TinyStateLockTimeoutError";

  constructor(name: string) {
    super(`Timed out waiting for Tiny-Chu state lock: ${name}`);
  }
}

export class TinyStateLockCompromisedError extends Error {
  readonly code = "TINY_STATE_LOCK_COMPROMISED";
  readonly name = "TinyStateLockCompromisedError";

  constructor(name: string, cause: unknown) {
    super(`Tiny-Chu state lock was compromised: ${name}`, { cause });
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function assertLockName(name: string): void {
  if (!/^[A-Za-z0-9._-]+\.lock$/.test(name) || name.includes("..")) throw new Error(`Invalid Tiny-Chu lock name: ${name}`);
}

function lockOptions(options: TinyStateLockOptions): Required<TinyStateLockOptions> {
  return {
    staleMs: options.staleMs ?? TINY_STATE_LOCK_STALE_MS,
    timeoutMs: options.timeoutMs ?? TINY_STATE_LOCK_TIMEOUT_MS,
    pollMs: options.pollMs ?? TINY_STATE_LOCK_POLL_MS,
    renewMs: options.renewMs ?? TINY_STATE_LOCK_RENEW_MS,
    nonBlocking: options.nonBlocking ?? false,
  };
}

function ownerFor(lockId: string, now: Date, staleMs: number): LockOwner {
  const iso = now.toISOString();
  return {
    lockId,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: iso,
    renewedAt: iso,
    expiresAt: new Date(now.getTime() + staleMs).toISOString(),
  };
}

function renewOwner(owner: LockOwner, now: Date, staleMs: number): LockOwner {
  return {
    ...owner,
    renewedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + staleMs).toISOString(),
  };
}

async function ensureLockRoot(root: string | undefined): Promise<string> {
  const paths = resolveTinyChuPaths(root);
  await ensureDir(paths.tinyDir);
  const tinyInfo = await lstat(paths.tinyDir);
  if (tinyInfo.isSymbolicLink() || !tinyInfo.isDirectory()) throw new Error(`Tiny-Chu state directory is not a safe directory: ${paths.tinyDir}`);
  await ensureDir(paths.locksDir);
  const locksInfo = await lstat(paths.locksDir);
  if (locksInfo.isSymbolicLink() || !locksInfo.isDirectory()) throw new Error(`Tiny-Chu locks directory is not a safe directory: ${paths.locksDir}`);
  return paths.locksDir;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetriableWindowsFsError(error: unknown): boolean {
  return process.platform === "win32"
    && error instanceof Error
    && "code" in error
    && (error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY" || error.code === "ENOTEMPTY");
}

async function withRetriableWindowsFsMutation<T>(operation: () => Promise<T>, pollMs: number): Promise<T> {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetriableWindowsFsError(error) || attempt === maxAttempts - 1) throw error;
      await sleep(pollMs * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

async function removeDirectoryIfExists(directory: string, pollMs: number): Promise<void> {
  await withRetriableWindowsFsMutation(() => rm(directory, { recursive: true, force: true }), pollMs);
}

async function readOwner(ownerFile: string): Promise<LockOwner | undefined> {
  let raw: string;
  try {
    raw = await readFile(ownerFile, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { lockId?: unknown }).lockId === "string"
    && typeof (value as { pid?: unknown }).pid === "number"
    && typeof (value as { hostname?: unknown }).hostname === "string"
    && typeof (value as { createdAt?: unknown }).createdAt === "string"
    && typeof (value as { renewedAt?: unknown }).renewedAt === "string"
    && typeof (value as { expiresAt?: unknown }).expiresAt === "string"
  ) {
    return value as LockOwner;
  }
  throw new Error(`Malformed Tiny-Chu lock owner: ${ownerFile}`);
}

async function writeOwner(lockDir: string, owner: LockOwner): Promise<void> {
  await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  const now = new Date(owner.renewedAt);
  await utimes(lockDir, now, now);
}

async function tryAcquireReaperLock(reaperDir: string, staleMs: number, pollMs: number): Promise<boolean> {
  for (;;) {
    try {
      await withRetriableWindowsFsMutation(() => mkdir(reaperDir, { recursive: false }), pollMs);
      return true;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const snapshot = await lstat(reaperDir).catch((statError: unknown) => {
        if (hasErrorCode(statError, "ENOENT")) return undefined;
        throw statError;
      });
      if (!snapshot) continue;
      if (snapshot.isSymbolicLink() || !snapshot.isDirectory()) throw new Error(`Tiny-Chu lock reaper path is not a safe directory: ${reaperDir}`);
      if (Date.now() - snapshot.mtimeMs <= staleMs) return false;
      await removeDirectoryIfExists(reaperDir, pollMs);
    }
  }
}

async function withLifecycleLock<T>(lockDir: string, staleMs: number, pollMs: number, wait: boolean, operation: () => Promise<T>): Promise<T | undefined> {
  const reaperDir = `${lockDir}.reaper`;
  for (;;) {
    if (await tryAcquireReaperLock(reaperDir, staleMs, pollMs)) break;
    if (!wait) return undefined;
    await sleep(pollMs);
  }
  try {
    return await operation();
  } finally {
    await removeDirectoryIfExists(reaperDir, pollMs);
  }
}

async function tryRemoveStaleLock(lockDir: string, staleMs: number, pollMs: number): Promise<boolean> {
  return (await withLifecycleLock(lockDir, staleMs, pollMs, false, async () => {
    try {
      const snapshot = await lstat(lockDir);
      if (snapshot.isSymbolicLink() || !snapshot.isDirectory()) throw new Error(`Tiny-Chu lock path is not a safe directory: ${lockDir}`);
      if (Date.now() - snapshot.mtimeMs <= staleMs) return false;
      await removeDirectoryIfExists(lockDir, pollMs);
      return true;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return true;
      throw error;
    }
  })) ?? false;
}

async function releaseLock(lockDir: string, owner: LockOwner, staleMs: number, pollMs: number): Promise<void> {
  await withLifecycleLock(lockDir, staleMs, pollMs, true, async () => {
    try {
      await verifyOwner(lockDir, owner);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT") || error instanceof SyntaxError) return;
      return;
    }
    await removeDirectoryIfExists(lockDir, pollMs);
  });
}

function assertOwnerLeaseActive(owner: LockOwner): void {
  const expiresAtMs = Date.parse(owner.expiresAt);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) throw new Error(`Tiny-Chu lock lease expired: ${owner.lockId}`);
}

async function assertOwnerActive(lockDir: string, owner: LockOwner): Promise<void> {
  const current = await readOwner(path.join(lockDir, "owner.json"));
  if (!current || current.lockId !== owner.lockId) throw new Error(`Tiny-Chu lock owner changed: ${lockDir}`);
  assertOwnerLeaseActive(current);
}

async function assertLockActive(name: string, lockDir: string, owner: LockOwner, compromised: Error | undefined): Promise<void> {
  if (compromised) throw compromised;
  try {
    await assertOwnerActive(lockDir, owner);
  } catch (error) {
    throw new TinyStateLockCompromisedError(name, error);
  }
}

async function verifyOwner(lockDir: string, owner: LockOwner): Promise<void> {
  const current = await readOwner(path.join(lockDir, "owner.json"));
  if (!current || current.lockId !== owner.lockId) throw new Error(`Tiny-Chu lock owner changed: ${lockDir}`);
}

async function renewLock(lockDir: string, owner: LockOwner, staleMs: number, pollMs: number): Promise<LockOwner> {
  const renewed = await withLifecycleLock(lockDir, staleMs, pollMs, true, async () => {
    await assertOwnerActive(lockDir, owner);
    const next = renewOwner(owner, new Date(), staleMs);
    await writeOwner(lockDir, next);
    return next;
  });
  if (!renewed) throw new Error(`Tiny-Chu lock renewal was interrupted: ${lockDir}`);
  return renewed;
}

function startRenewal(name: string, lockDir: string, initialOwner: LockOwner, staleMs: number, renewMs: number, pollMs: number): {
  readonly stop: () => Promise<void>;
  readonly compromisedError: () => Error | undefined;
  readonly owner: () => LockOwner;
} {
  let owner = initialOwner;
  let renewalPromise: Promise<void> | undefined;
  let compromised: Error | undefined;
  const timer = setInterval(() => {
    if (renewalPromise || compromised) return;
    renewalPromise = renewLock(lockDir, owner, staleMs, pollMs)
      .then((next) => {
        owner = next;
      })
      .catch((error: unknown) => {
        compromised = new TinyStateLockCompromisedError(name, error);
      })
      .finally(() => {
        renewalPromise = undefined;
      });
  }, renewMs);
  const maybeUnref = timer as { unref?: () => void };
  if (typeof maybeUnref === "object" && maybeUnref !== null && typeof maybeUnref.unref === "function") maybeUnref.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await renewalPromise;
    },
    compromisedError: () => compromised,
    owner: () => owner,
  };
}

export async function acquireTinyStateLock(root: string | undefined, name: string, options: TinyStateLockOptions = {}): Promise<TinyStateLock | undefined> {
  assertLockName(name);
  const resolved = lockOptions(options);
  const locksDir = await ensureLockRoot(root);
  const lockDir = path.join(locksDir, name);
  const startedAt = Date.now();
  for (;;) {
    const lockId = randomUUID();
    const owner = ownerFor(lockId, new Date(), resolved.staleMs);
    try {
      await mkdir(lockDir, { recursive: false });
      try {
        await writeOwner(lockDir, owner);
      } catch (error) {
        await removeDirectoryIfExists(lockDir, resolved.pollMs);
        throw error;
      }
      const renewal = startRenewal(name, lockDir, owner, resolved.staleMs, resolved.renewMs, resolved.pollMs);
      return {
        name,
        path: lockDir,
        lockId,
        get compromisedError() {
          return renewal.compromisedError();
        },
        assertActive: async () => {
          await assertLockActive(name, lockDir, renewal.owner(), renewal.compromisedError());
        },
        release: async () => {
          await renewal.stop();
          await releaseLock(lockDir, owner, resolved.staleMs, resolved.pollMs);
        },
      };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      if (await tryRemoveStaleLock(lockDir, resolved.staleMs, resolved.pollMs)) continue;
      if (resolved.nonBlocking) return undefined;
      if (Date.now() - startedAt > resolved.timeoutMs) throw new TinyStateLockTimeoutError(name);
      await sleep(resolved.pollMs);
    }
  }
}

export async function withTinyStateLock<T>(root: string | undefined, name: string, operation: (lock: TinyStateLock) => Promise<T>, options: TinyStateLockOptions = {}): Promise<T> {
  const lock = await acquireTinyStateLock(root, name, options);
  if (!lock) throw new TinyStateLockTimeoutError(name);
  try {
    await lock.assertActive();
    const result = await operation(lock);
    await lock.assertActive();
    return result;
  } finally {
    await lock.release();
  }
}

export function tinyStatePlanLockName(planRef: string): string {
  const hash = createHash("sha256").update(planRef).digest("hex").slice(0, 16);
  return `plan-${hash}.lock`;
}

export function tinyStateTaskLockName(taskId: string): string {
  return `task-${taskId}.lock`;
}

export function tinyStatePublicJobLockName(jobId: string): string {
  return `public-job-${jobId}.lock`;
}

export function tinyStateWorkflowLockName(runId: string): string {
  return `workflow-${runId}.lock`;
}
