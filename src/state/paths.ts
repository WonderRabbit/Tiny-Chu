import path from "node:path";

export interface TinyInfiPaths {
  root: string;
  omoDir: string;
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
  const omoDir = path.join(absoluteRoot, ".omo");
  const tinyDir = path.join(absoluteRoot, ".tiny-infi");
  const wikiDir = path.join(tinyDir, "wiki");
  return {
    root: absoluteRoot,
    omoDir,
    tasksDir: path.join(omoDir, "tasks"),
    plansDir: path.join(omoDir, "plans"),
    boulderFile: path.join(omoDir, "boulder.json"),
    tinyDir,
    publicJobsDir: path.join(tinyDir, "public-jobs"),
    memoryDir: path.join(tinyDir, "memory"),
    wikiDir,
    wikiIndexFile: path.join(wikiDir, "index.json"),
  };
}
