import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTinyChuPaths } from "../state/paths.js";
import { ensureDir, writeTextAtomic } from "../state/file-store.js";
import { tinyStatePlanLockName, withTinyStateLock } from "../state/lock-store.js";
import { portableRelative } from "../state/path-safety.js";

export interface PlanCheckbox {
  section: string;
  text: string;
  checked: boolean;
  line: number;
}

export interface PlanStatus {
  path: string;
  total: number;
  done: number;
  open: number;
  checkboxes: PlanCheckbox[];
  complete: boolean;
}

export interface PlanFocus {
  readonly planRef: string;
  readonly total: number;
  readonly done: number;
  readonly open: number;
  readonly nextOpenItems: readonly PlanCheckbox[];
  readonly finalVerificationOpen: boolean;
  readonly truncated: boolean;
}

export function parsePlanMarkdown(markdown: string, planPath: string): PlanStatus {
  const lines = markdown.split(/\r?\n/);
  let section = "";
  const checkboxes: PlanCheckbox[] = [];
  lines.forEach((line, index) => {
    const heading = /^##\s+(.+)\s*$/.exec(line);
    if (heading) section = heading[1].trim();
    const checkbox = /^- \[( |x|X)\]\s+(.+)\s*$/.exec(line);
    if (checkbox) {
      checkboxes.push({ section, text: checkbox[2].trim(), checked: checkbox[1].toLowerCase() === "x", line: index + 1 });
    }
  });
  const done = checkboxes.filter((item) => item.checked).length;
  return { path: planPath, total: checkboxes.length, done, open: checkboxes.length - done, checkboxes, complete: checkboxes.length > 0 && done === checkboxes.length };
}

export function selectPlanFocus(status: PlanStatus, options: { readonly maxOpenItems?: number } = {}): PlanFocus {
  const maxOpenItems = typeof options.maxOpenItems === "number" && Number.isInteger(options.maxOpenItems) && options.maxOpenItems > 0 ? options.maxOpenItems : 3;
  const openItems = status.checkboxes.filter((item) => !item.checked);
  return {
    planRef: status.path,
    total: status.total,
    done: status.done,
    open: status.open,
    nextOpenItems: openItems.slice(0, maxOpenItems),
    finalVerificationOpen: openItems.some((item) => item.section === "Final Verification Wave" || /^F\d+\b/.test(item.text)),
    truncated: openItems.length > maxOpenItems,
  };
}

export async function readPlanStatus(root: string | undefined, planRef: string): Promise<PlanStatus> {
  const absolute = path.resolve(resolveTinyChuPaths(root).root, planRef);
  return parsePlanMarkdown(await readFile(absolute, "utf8"), planRef);
}

export async function writePlanTemplate(root: string | undefined, fileName: string, input: { title: string; goal: string; todos: string[]; evidence?: string[] }): Promise<string> {
  const paths = resolveTinyChuPaths(root);
  await ensureDir(paths.plansDir);
  const planPath = path.join(paths.plansDir, fileName);
  const markdown = [
    `# ${input.title}`,
    "",
    "## Goal",
    input.goal,
    "",
    "## Source of Truth",
    "- nearest AGENTS.md",
    "- project rules bundle",
    "- .tiny/wiki/index.json",
    "",
    "## TODOs",
    ...input.todos.map((todo, index) => `- [ ] ${index + 1}. ${todo}`),
    "",
    "## Evidence",
    ...(input.evidence ?? ["implementation diff reviewed", "tests pass", "wiki/ADR updated if needed"]).map((item, index) => `- [ ] E${index + 1}. ${item}`),
    "",
    "## Final Verification Wave",
    "- [ ] F1. targeted checks pass",
    "- [ ] F2. full regression gate considered",
    "- [ ] F3. final summary includes evidence",
    "",
  ].join("\n");
  const planRef = portableRelative(paths.root, planPath);
  await withTinyStateLock(root, tinyStatePlanLockName(planRef), async (lock) => {
    await lock.assertActive();
    await writeTextAtomic(planPath, markdown);
  });
  return planRef;
}
