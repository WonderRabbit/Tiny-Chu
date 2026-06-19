import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TinyComposedRegistry } from "../opencode/feature-package.js";
import type { TinyChuRuntimeMode } from "../opencode/runtime-mode.js";
import { writeJsonAtomic, writeTextAtomic } from "../state/file-store.js";
import { resolveExistingPathInsideRoot } from "../state/path-safety.js";
import { resolveTinyChuPaths } from "../state/paths.js";

export interface ProjectSnapshotDoc {
  readonly path: string;
  readonly exists: boolean;
}

export interface ProjectSnapshotStateRefs {
  readonly tasks: ".tiny/tasks";
  readonly plans: ".tiny/plans";
  readonly publicJobs: ".tiny/public-jobs";
  readonly workflows: ".tiny/workflows";
  readonly wikiIndex: ".tiny/wiki/index.json";
  readonly projectSnapshot: ".tiny/project/snapshot.json";
  readonly projectSummary: ".tiny/project/summary.md";
}

export interface ProjectSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly root: string;
  readonly packageName: string;
  readonly version: string;
  readonly runtimeMode: TinyChuRuntimeMode;
  readonly packageIds: readonly string[];
  readonly toolNames: readonly string[];
  readonly nativeTools: readonly string[];
  readonly docs: readonly ProjectSnapshotDoc[];
  readonly stateRefs: ProjectSnapshotStateRefs;
}

export interface ProjectSnapshotInput {
  readonly root?: string;
  readonly registry: TinyComposedRegistry;
  readonly runtimeMode: TinyChuRuntimeMode;
  readonly generatedAt?: string;
}

export interface ProjectSnapshotResult {
  readonly paths: readonly [".tiny/project/snapshot.json", ".tiny/project/summary.md"];
  readonly snapshot: ProjectSnapshot;
}

const SNAPSHOT_PATH = ".tiny/project/snapshot.json";
const SUMMARY_PATH = ".tiny/project/summary.md";
const DEFAULT_DOC_PATHS: readonly string[] = [
  "README.md",
  "HOW_TO_USE.md",
  "INSTALL.md",
  "docs/architecture/README.md",
];

const STATE_REFS: ProjectSnapshotStateRefs = {
  tasks: ".tiny/tasks",
  plans: ".tiny/plans",
  publicJobs: ".tiny/public-jobs",
  workflows: ".tiny/workflows",
  wikiIndex: ".tiny/wiki/index.json",
  projectSnapshot: SNAPSHOT_PATH,
  projectSummary: SUMMARY_PATH,
};

export async function writeProjectSnapshot(input: ProjectSnapshotInput): Promise<ProjectSnapshotResult> {
  const paths = resolveTinyChuPaths(input.root);
  const packageMetadata = await readPackageMetadata(paths.root);
  const snapshot: ProjectSnapshot = {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    root: paths.root,
    packageName: packageMetadata.name,
    version: packageMetadata.version,
    runtimeMode: input.runtimeMode,
    packageIds: [...input.registry.packageIds].sort(),
    toolNames: [...input.registry.requiredToolNames].sort(),
    nativeTools: [...input.registry.nativeToolNames].sort(),
    docs: await collectProjectDocs(paths.root),
    stateRefs: STATE_REFS,
  };
  const projectDir = path.join(paths.tinyDir, "project");
  await writeJsonAtomic(path.join(projectDir, "snapshot.json"), snapshot);
  await writeTextAtomic(path.join(projectDir, "summary.md"), renderProjectSnapshotSummary(snapshot));
  return {
    paths: [SNAPSHOT_PATH, SUMMARY_PATH],
    snapshot,
  };
}

export function renderProjectSnapshotSummary(snapshot: ProjectSnapshot): string {
  return [
    "# Tiny-Chu Project Snapshot",
    "",
    "This summary is generated only from `.tiny/project/snapshot.json`.",
    "",
    `- Schema version: ${snapshot.schemaVersion}`,
    `- Generated at: ${snapshot.generatedAt}`,
    `- Root: ${snapshot.root}`,
    `- Package: ${snapshot.packageName}@${snapshot.version}`,
    `- Runtime mode: ${snapshot.runtimeMode}`,
    `- Packages: ${snapshot.packageIds.length}`,
    `- Tools: ${snapshot.toolNames.length}`,
    `- Native tools: ${snapshot.nativeTools.length === 0 ? "none" : snapshot.nativeTools.join(", ")}`,
    `- Docs tracked: ${snapshot.docs.length}`,
    "",
    "## Package IDs",
    "",
    ...snapshot.packageIds.map((id) => `- ${id}`),
    "",
    "## Tool Names",
    "",
    ...snapshot.toolNames.map((name) => `- ${name}`),
    "",
    "## State Refs",
    "",
    ...Object.entries(snapshot.stateRefs).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ].join("\n");
}

async function collectProjectDocs(root: string): Promise<readonly ProjectSnapshotDoc[]> {
  const docs: ProjectSnapshotDoc[] = [];
  for (const docPath of DEFAULT_DOC_PATHS) {
    docs.push({
      path: docPath,
      exists: await fileExists(path.join(root, docPath)),
    });
  }
  return docs;
}

interface PackageMetadata {
  readonly name: string;
  readonly version: string;
}

async function readPackageMetadata(root: string): Promise<PackageMetadata> {
  const fallback: PackageMetadata = { name: "unknown", version: "0.0.0" };
  try {
    const packagePath = await resolveExistingPathInsideRoot(root, "package.json");
    if (!packagePath) return fallback;
    const parsed: unknown = JSON.parse(await readFile(packagePath, "utf8"));
    if (!isPackageMetadata(parsed)) return fallback;
    return parsed;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

function isPackageMetadata(value: unknown): value is PackageMetadata {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || !("version" in value)) return false;
  return typeof value.name === "string" && typeof value.version === "string";
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await readFile(file, "utf8");
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
