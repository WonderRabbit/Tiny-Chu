import path from "node:path";

export interface TinyChuPaths {
  root: string;
  tasksDir: string;
  plansDir: string;
  boulderFile: string;
  tinyDir: string;
  locksDir: string;
  publicJobsDir: string;
  memoryDir: string;
  workflowsDir: string;
  workflowDefinitionsDir: string;
  workflowRunsDir: string;
  workflowPacketsDir: string;
  workflowReportsDir: string;
  wikiDir: string;
  wikiIndexFile: string;
}

export function resolveTinyChuPaths(root = process.cwd()): TinyChuPaths {
  const absoluteRoot = path.resolve(root);
  const tinyDir = path.join(absoluteRoot, ".tiny");
  const workflowsDir = path.join(tinyDir, "workflows");
  const wikiDir = path.join(tinyDir, "wiki");
  return {
    root: absoluteRoot,
    tasksDir: path.join(tinyDir, "tasks"),
    plansDir: path.join(tinyDir, "plans"),
    boulderFile: path.join(tinyDir, "boulder.json"),
    tinyDir,
    locksDir: path.join(tinyDir, "locks"),
    publicJobsDir: path.join(tinyDir, "public-jobs"),
    memoryDir: path.join(tinyDir, "memory"),
    workflowsDir,
    workflowDefinitionsDir: path.join(workflowsDir, "definitions"),
    workflowRunsDir: path.join(workflowsDir, "runs"),
    workflowPacketsDir: path.join(workflowsDir, "packets"),
    workflowReportsDir: path.join(workflowsDir, "reports"),
    wikiDir,
    wikiIndexFile: path.join(wikiDir, "index.json"),
  };
}
