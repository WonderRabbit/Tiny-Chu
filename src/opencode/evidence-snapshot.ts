import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolvePathInsideRoot } from "../state/path-safety.js";

export interface EvidenceSnapshotFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly preview: string;
}

export interface EvidenceSnapshotResult {
  readonly cacheKey: string;
  readonly evidenceDir: string;
  readonly files: readonly EvidenceSnapshotFile[];
  readonly omittedFiles: number;
  readonly sourceRefs: readonly string[];
  readonly status: "ready" | "empty";
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

async function walk(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!entries) return [];
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(dir, relative);
    if (entry.isDirectory()) files.push(...await walk(dir, relative));
    if (entry.isFile()) files.push(relative);
  }
  return files;
}

export async function createEvidenceSnapshot(root: string, input: Record<string, unknown>): Promise<EvidenceSnapshotResult> {
  const evidenceDir = typeof input.evidenceDir === "string" ? input.evidenceDir : ".omo/evidence";
  const absolute = resolvePathInsideRoot(root, evidenceDir);
  if (!absolute) throw new Error(`Evidence directory is outside configured root: ${evidenceDir}`);
  const maxFiles = positiveInteger(input.maxFiles, 20);
  const maxPreviewChars = positiveInteger(input.maxPreviewChars, 240);
  const allFiles = (await walk(absolute)).filter((file) => !file.includes("..")).sort();
  const files = await Promise.all(allFiles.slice(0, maxFiles).map(async (file) => {
    const absoluteFile = path.join(absolute, file);
    const [info, text] = await Promise.all([stat(absoluteFile), readFile(absoluteFile, "utf8").catch(() => "")]);
    const preview = text.slice(0, maxPreviewChars);
    return { path: `${evidenceDir.replace(/\\/g, "/").replace(/\/$/, "")}/${file.replace(/\\/g, "/")}`, bytes: info.size, sha256: createHash("sha256").update(text).digest("hex"), preview };
  }));
  return {
    cacheKey: createHash("sha256").update(files.map((file) => `${file.path}:${file.sha256}`).join("|")).digest("hex"),
    evidenceDir,
    files,
    omittedFiles: Math.max(0, allFiles.length - files.length),
    sourceRefs: files.flatMap((file) => file.preview.match(/[A-Za-z0-9_.\/-]+\.(?:ts|tsx|js|mjs|md|json):\d+/g) ?? []),
    status: files.length > 0 ? "ready" : "empty",
  };
}
