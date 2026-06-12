import path from "node:path";

export interface TinyInfiPaths {
  root: string;
  tasksDir: string;
  plansDir: string;
  boulderFile: string;
  tinyDir: string;
  publicJobsDir: string;
  memoryDir: string;
  wikiDir: string;
  wikiIndexFile: string;
}

export function resolveTinyInfiPaths(root = process.cwd()): TinyInfiPaths {
  const absoluteRoot = path.resolve(root);
  const tinyDir = path.join(absoluteRoot, ".tiny");
  const wikiDir = path.join(tinyDir, "wiki");
  return {
    root: absoluteRoot,
    tasksDir: path.join(tinyDir, "tasks"),
    plansDir: path.join(tinyDir, "plans"),
    boulderFile: path.join(tinyDir, "boulder.json"),
    tinyDir,
    publicJobsDir: path.join(tinyDir, "public-jobs"),
    memoryDir: path.join(tinyDir, "memory"),
    wikiDir,
    wikiIndexFile: path.join(wikiDir, "index.json"),
  };
}
