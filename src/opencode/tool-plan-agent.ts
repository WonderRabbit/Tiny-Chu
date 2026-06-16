import type { AgentKind } from "./agent-model-options.js";

export function agentKind(objective: string): AgentKind | undefined {
  if (/\bwireframe\b/i.test(objective)) return "wireframe_planner";
  if (/\bux|layout|screen\b/i.test(objective)) return "ui_ux_analyst";
  if (/\bfact|research|collect repo\b/i.test(objective)) return "fact_researcher";
  if (/\breview\b/i.test(objective)) return "reviewer";
  if (/\bqa|test\b/i.test(objective)) return "qa_runner";
  if (/\bimplement|fix|code\b/i.test(objective)) return "implementation_worker";
  return undefined;
}
