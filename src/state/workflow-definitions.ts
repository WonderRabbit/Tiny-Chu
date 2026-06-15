import type { WorkflowDefinition, WorkflowDefinitionPhase, WorkflowNodeInput } from "./workflow-types.js";

export const ANALYSIS_WORKFLOW_PHASE_IDS = [
  "project_init",
  "architecture_map",
  "development_rules",
  "web_route_inventory",
  "page_layout_flow",
  "api_backend_trace",
  "dao_sql_business_logic",
  "final_deliverables",
] as const;

const ANALYSIS_PHASES: readonly WorkflowDefinitionPhase[] = [
  {
    nodeId: "project_init",
    type: "analysis.project_init",
    title: "Project definition and init context",
    description: "Identify project purpose, runtime, package scripts, state directories, and local instructions before deeper analysis.",
    expectedOutputs: ["project overview", "runtime and script summary", "instruction bundle summary"],
  },
  {
    nodeId: "architecture_map",
    type: "analysis.architecture",
    title: "Architecture map",
    description: "Map major modules, boundaries, data stores, entry points, and dependency direction.",
    dependencies: ["project_init"],
    expectedOutputs: ["module map", "entry point list", "architecture evidence refs"],
  },
  {
    nodeId: "development_rules",
    type: "analysis.rules",
    title: "Development patterns and rules",
    description: "Extract repeated implementation patterns and convert them into reusable development rules.",
    dependencies: ["architecture_map"],
    expectedOutputs: ["pattern inventory", "rule candidates", "rules projection draft"],
  },
  {
    nodeId: "web_route_inventory",
    type: "analysis.web_routes",
    title: "Web pages and route relationships",
    description: "Inventory visible pages, routes, navigation links, ownership, and page-to-page relationships.",
    dependencies: ["development_rules"],
    expectedOutputs: ["page inventory", "route relationship map", "navigation evidence refs"],
  },
  {
    nodeId: "page_layout_flow",
    type: "analysis.page_flow",
    title: "Page layout, controls, data flow, and business logic",
    description: "For each page, describe layout, buttons, event handlers, data flow, and local business logic.",
    dependencies: ["web_route_inventory"],
    expectedOutputs: ["layout notes", "button-to-handler traces", "page business logic refs"],
  },
  {
    nodeId: "api_backend_trace",
    type: "analysis.api_backend",
    title: "API call and backend trace",
    description: "Trace API callers through routes, services, integrations, and backend control flow.",
    dependencies: ["page_layout_flow"],
    expectedOutputs: ["API trace map", "service flow notes", "integration evidence refs"],
  },
  {
    nodeId: "dao_sql_business_logic",
    type: "analysis.dao_sql",
    title: "DAO, SQL, and business logic analysis",
    description: "Trace DAO calls, SQL statements, data mappings, and business rules that determine persisted behavior.",
    dependencies: ["api_backend_trace"],
    expectedOutputs: ["DAO trace", "SQL evidence", "business rule summary"],
  },
  {
    nodeId: "final_deliverables",
    type: "analysis.deliverables",
    title: "Analysis deliverables",
    description: "Assemble evidence-backed output documents, unresolved questions, and next-step packets.",
    dependencies: ["dao_sql_business_logic"],
    expectedOutputs: ["final analysis report", "evidence index", "follow-up task packets"],
  },
];

export function createAnalysisWorkflowDefinition(): WorkflowDefinition {
  return {
    workflowId: "analysis",
    title: "Project analysis workflow",
    description: "Eight-phase repository analysis workflow for small serial workers.",
    phases: ANALYSIS_PHASES.map(copyPhase),
  };
}

export function createWorkflowDefinition(workflowId: string): WorkflowDefinition {
  if (workflowId === "analysis") return createAnalysisWorkflowDefinition();
  throw new Error(`Unsupported workflow id: ${workflowId}`);
}

export function createWorkflowDefinitionNodes(workflowId: string): readonly WorkflowNodeInput[] {
  return createWorkflowDefinition(workflowId).phases.map((phase) => ({
    nodeId: phase.nodeId,
    type: phase.type,
    title: phase.title,
    dependencies: [...(phase.dependencies ?? [])],
  }));
}

function copyPhase(phase: WorkflowDefinitionPhase): WorkflowDefinitionPhase {
  return {
    nodeId: phase.nodeId,
    type: phase.type,
    title: phase.title,
    description: phase.description,
    dependencies: [...(phase.dependencies ?? [])],
    expectedOutputs: [...phase.expectedOutputs],
  };
}
