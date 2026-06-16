import type { ToolPlanStep } from "./tool-plan.js";

function needsSmallContextCorrection(objective: string): boolean {
  return /\b(small-context|small context|operating-mode|operating mode|small model optimization|provider call)\b/i.test(objective);
}

function needsRepositoryAnalysisWorkflow(objective: string): boolean {
  return /\b(repository|repo|opencode|gemma4|gemma|tiny-chu)\b/i.test(objective);
}

function needsWikiContext(objective: string): boolean {
  return /\b(wiki|canonical|project knowledge|small model wiki|context budget|llm wiki|tiny-chu knowledge|tiny chu knowledge)\b/i.test(objective)
    || /프로젝트 지식|위키|문서 근거|근거 문서/.test(objective)
    || (/\b(repo|repository|analysis)\b/i.test(objective) && /\b(canonical docs?|policy|design decision|historical project knowledge)\b/i.test(objective));
}

export function withWikiContext(steps: readonly ToolPlanStep[], objective: string): readonly ToolPlanStep[] {
  if (!needsWikiContext(objective)) return steps;
  const afterTool = needsRepositoryAnalysisWorkflow(objective)
    ? "context_budget_simulation"
    : needsSmallContextCorrection(objective) ? "context_packet" : "repo_map";
  const index = steps.findIndex((step) => step.tinyTool === afterTool);
  if (index < 0) return steps;
  const wikiStep: ToolPlanStep = {
    order: 0,
    goal: "retrieve bounded canonical wiki evidence",
    tinyTool: "wiki_context",
    outputBudget: "cited chunks, warnings, omissions, and uncertainties only",
  };
  return [...steps.slice(0, index + 1), wikiStep, ...steps.slice(index + 1)];
}
