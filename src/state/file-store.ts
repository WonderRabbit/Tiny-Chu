import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

class MalformedJsonError extends Error {
  readonly name = "MalformedJsonError";

  constructor(readonly file: string, cause: SyntaxError) {
    super(`Malformed JSON in ${file}`, { cause });
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return fallback;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) throw new MalformedJsonError(file, error);
    throw error;
  }
}

export async function writeJsonAtomic(file: string, value: unknown, options: { readonly compact?: boolean } = {}): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(value, null, options.compact ? 0 : 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

export async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonLines<T>(file: string, fallback: readonly T[]): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [...fallback];
    throw error;
  }
  const records: T[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Malformed JSONL in ${file} at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return records;
}

export async function removeIfExists(file: string): Promise<boolean> {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}
