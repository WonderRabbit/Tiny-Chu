import { loadContextBundle } from "../context/context-loader.js";
import { PublicDispatcher } from "../dispatcher/public-job.js";
import { checkMermaidMarkdown, fixMermaidMarkdown } from "../markdown/mermaid.js";
import { resolveTinyChuPaths } from "../state/paths.js";
import { TaskStore } from "../state/task-store.js";
import { WikiBundler } from "../wiki/wiki-bundler.js";
import { readPlanStatus } from "../ulw-loop/plan.js";
import { buildContextPacket } from "../context/evidence-packet.js";
import { checkArtifactMarkdown, createArtifactFormatTemplate } from "./artifact-contract.js";
import { createApiBackendTrace } from "./api-backend-trace.js";
import { createBusinessLogicMap } from "./business-logic-map.js";
import { aggregationDriftCheck, atomicMarkdownWrite, buttonWorkerResultCheck, buttonWorkflowDoneClaim, createButtonWorkerPacket, createButtonWorkflowPlan, dispatchButtonWorkflow, aggregateButtonTraces, markdownEnvelopeCheck, writeLoopGuard } from "./button-workflow.js";
import { createClaimEvidenceCheck } from "./claim-evidence-check.js";
import { createPowerShellCommandGuard } from "./command-guard.js";
import { createDoctor } from "./doctor.js";
import { createEvidenceSnapshot } from "./evidence-snapshot.js";
import { createEvidenceQa } from "./evidence-qa.js";
import { createArtifactPackManifest, createIncrementalEvidenceCache, createWorkerPacketOptimizer } from "./extension-artifacts.js";
import { createApiContractCatalog, createDtoSchemaMap } from "./extension-contracts.js";
import { createEnvironmentDoctor } from "./extension-environment.js";
import { createAuthPermissionTrace, createErrorTransactionMap, createReduxStateFlowMap, createTestImpactPlanner } from "./extension-flow.js";
import { composeFeaturePackages, type TinyComposedRegistry } from "./feature-package.js";
import { createDefaultTinyFeaturePackages } from "./feature-packages/default-packages.js";
import { createGitWeeklyReport } from "./git-weekly-report.js";
import { createIntegrationCatalog } from "./integration-catalog.js";
import { createDashboardSnapshot } from "./dashboard-snapshot.js";
import { createTinyChuInstallCheck } from "./install-check.js";
import { createLegacyRepoIndex } from "./legacy-repo-index.js";
import { createOrchestrationHealth } from "./orchestration-health.js";
import { POWERSHELL_TOOLING_PROFILE, renderCompactPowerShellToolingGuide } from "./powershell-tooling.js";
import { createProviderEndpointPreflight } from "./provider-endpoint-preflight.js";
import { createQwenRetryPolicy } from "./qwen-retry-policy.js";
import { createRepoMap } from "./repo-map.js";
import { isWorkerRuntimeMode, normalizeTinyChuRuntimeMode, TinyChuModeDispatchError } from "./runtime-mode.js";
import { writeRulesSnapshot } from "./rules-snapshot.js";
import { renderCompactSmallContextGuide } from "./small-context-compact.js";
import { createSmallContextOrchestrationProfile } from "./small-context-profile.js";
import { createContextBudgetSimulation, createEvidenceGate, createSmallModelReplay, createToolCallConformanceProbe } from "./small-model-reliability.js";
import { createSafeToolHandlers } from "./safe-tool-handlers.js";
import { createChunkedWritePlan, createContextDigest, createResumePacket } from "./small-model-tools.js";
import { createSessionPreflight } from "./session-preflight.js";
import { createTaskFocusPacket } from "./task-focus-packet.js";
import { createToolUsagePlan } from "./tool-plan.js";
import { createTraceabilityMatrix } from "./traceability-matrix.js";
import { createTraceDiagramRender } from "./trace-diagram-render.js";
import { createUiActionTrace } from "./ui-action-trace.js";
import { markdownInput, numberInput, publicJobFormatInput, stringInput, stringListInput, taskPatchInput, taskPriorityInput, taskStatusInput } from "./tiny-tool-inputs.js";
import type { OpenCodeRuntimeConfig, TinyChuConfig, TinyPluginModule, TinyToolContext, TinyToolHandler } from "./tiny-plugin-types.js";
import { wikiToolModule } from "./wiki-tool-loader.js";
import { reportLayoutTruth, updateLayoutTruth, verifyLayoutTruth } from "./layout-truth.js";
import { createUiLayoutCatalog, createUxRationaleTrace, createUxValidationMatrix } from "./ux-reverse-analysis.js";
import { createUxReverseReport } from "./ux-reverse-report.js";
import { createAnalysisWorkflowStart, createPublicJobResumePacket, createWorkflowProgressHeartbeat, createWorkflowSotAudit } from "./workflow-reliability.js";
import { createWorkflowToolHandlers } from "./workflow-tool-handlers.js";

export type { OpenCodeRuntimeConfig, OpenCodeShellRuntime, TinyChuConfig, TinyPluginModule, TinyToolContext, TinyToolHandler } from "./tiny-plugin-types.js";

export const POWERSHELL_OPENCODE_RUNTIME: OpenCodeRuntimeConfig = {
  shell: {
    name: "powershell",
    executable: "pwsh",
    version: "7.6.2",
    args: ["-NoLogo", "-NoProfile"],
  },
  tooling: POWERSHELL_TOOLING_PROFILE,
};

export function createTinyChuPlugin(config: TinyChuConfig = {}): TinyPluginModule {
  const root = config.root;
  const runtimeMode = normalizeTinyChuRuntimeMode(config.mode);
  const tasks = new TaskStore({ root });
  let dispatcher: PublicDispatcher | undefined;
  const publicDispatcher = (): PublicDispatcher => {
    if (!dispatcher) dispatcher = new PublicDispatcher({ root, ...config.publicDispatcher });
    return dispatcher;
  };
  const wiki = new WikiBundler(root);
  const orchestrationProfile = createSmallContextOrchestrationProfile(POWERSHELL_OPENCODE_RUNTIME, runtimeMode);
  const workflowTools = createWorkflowToolHandlers(root);
  let registry: TinyComposedRegistry;

  const tools: Record<string, TinyToolHandler> = {
      task_create: async (input) => tasks.create({
        title: stringInput(input, "title"),
        priority: taskPriorityInput(input.priority) ?? "normal",
        notes: Array.isArray(input.notes) ? input.notes.map(String) : [],
        planRef: typeof input.planRef === "string" ? input.planRef : undefined,
      }),
      task_get: async (input) => tasks.get(stringInput(input, "id")),
      task_list: async (input) => tasks.list(taskStatusInput(input.status)),
      task_checkpoint: async (input) => tasks.checkpoint(stringInput(input, "id"), {
        summary: stringInput(input, "summary"),
        artifactType: typeof input.artifactType === "string" ? input.artifactType : undefined,
        passIndex: numberInput(input, "passIndex"),
        nextSteps: stringListInput(input, "nextSteps"),
        evidenceRefs: stringListInput(input, "evidenceRefs"),
        openQuestions: stringListInput(input, "openQuestions"),
        verificationCommands: stringListInput(input, "verificationCommands"),
      }),
      task_update: async (input) => {
        const id = stringInput(input, "id");
        return tasks.update(id, taskPatchInput(input));
      },
      public_dispatch: async (input) => publicDispatcher().dispatch({
        taskId: typeof input.taskId === "string" ? input.taskId : undefined,
        prompt: stringInput(input, "prompt"),
        rulesRefs: Array.isArray(input.rulesRefs) ? input.rulesRefs.map(String) : [],
        wikiRefs: Array.isArray(input.wikiRefs) ? input.wikiRefs.map(String) : [],
        planRef: typeof input.planRef === "string" ? input.planRef : undefined,
        checkpointSummary: typeof input.checkpointSummary === "string" ? input.checkpointSummary : undefined,
        mustReturn: stringListInput(input, "mustReturn"),
        artifactType: typeof input.artifactType === "string" ? input.artifactType : undefined,
        format: publicJobFormatInput(input.format),
      }),
      public_collect: async (input) => publicDispatcher().get(stringInput(input, "id")),
      public_checkpoint: async (input) => publicDispatcher().checkpoint(stringInput(input, "id"), stringInput(input, "summary"), typeof input.result === "string" ? input.result : undefined),
      public_retry: async (input) => publicDispatcher().retry(stringInput(input, "id"), typeof input.reason === "string" ? input.reason : undefined),
      public_cancel: async (input) => publicDispatcher().cancel(stringInput(input, "id"), typeof input.reason === "string" ? input.reason : undefined),
      public_complete: async (input) => publicDispatcher().complete(stringInput(input, "id"), stringInput(input, "result")),
      public_job_resume_packet: async (input) => createPublicJobResumePacket(root, input),
      context_bundle: async (input, context) => loadContextBundle(root, typeof input.targetPath === "string" ? input.targetPath : context?.targetPath ?? "."),
      context_packet: async (input, context) => buildContextPacket({ root: resolveTinyChuPaths(root).root, targetPath: typeof input.targetPath === "string" ? input.targetPath : context?.targetPath ?? ".", maxChars: numberInput(input, "maxChars"), evidenceRefs: stringListInput(input, "evidenceRefs"), notes: stringListInput(input, "notes") }),
      context_budget_simulation: async (input) => createContextBudgetSimulation(input),
      context_digest: async (input) => createContextDigest(resolveTinyChuPaths(root).root, input),
      repo_map: async (input) => createRepoMap(resolveTinyChuPaths(root).root, input),
      business_logic_map: async (input) => createBusinessLogicMap(resolveTinyChuPaths(root).root, input),
      legacy_repo_index: async (input) => createLegacyRepoIndex(resolveTinyChuPaths(root).root, input),
      ui_action_trace: async (input) => createUiActionTrace(resolveTinyChuPaths(root).root, input),
      api_backend_trace: async (input) => createApiBackendTrace(resolveTinyChuPaths(root).root, input),
      integration_catalog: async (input) => createIntegrationCatalog(resolveTinyChuPaths(root).root, input),
      traceability_matrix: async (input) => createTraceabilityMatrix(input),
      evidence_qa: async (input) => createEvidenceQa(input),
      evidence_gate: async (input) => createEvidenceGate(input),
      evidence_snapshot: async (input) => createEvidenceSnapshot(resolveTinyChuPaths(root).root, input),
      doctor: async (input) => createDoctor(root, input),
      claim_evidence_check: async (input) => createClaimEvidenceCheck(input),
      provider_endpoint_preflight: async (input) => createProviderEndpointPreflight(input),
      tool_call_conformance_probe: async (input) => createToolCallConformanceProbe(input),
      session_preflight: async (input) => {
        const task = await tasks.get(stringInput(input, "id"));
        if (!task) throw new Error(`Task not found: ${stringInput(input, "id")}`);
        return createSessionPreflight(task, input);
      },
      powershell_command_guard: async (input) => createPowerShellCommandGuard(input),
      trace_diagram_render: async (input) => createTraceDiagramRender(input),
      tiny_chu_install_check: async () => createTinyChuInstallCheck(registry.requiredToolNames, registry.packages, registry.nativeToolNames, runtimeMode),
      environment_doctor: async (input) => createEnvironmentDoctor(input),
      ...createSafeToolHandlers(root),
      api_contract_catalog: async (input) => createApiContractCatalog(resolveTinyChuPaths(root).root, input),
      dto_schema_map: async (input) => createDtoSchemaMap(resolveTinyChuPaths(root).root, input),
      redux_state_flow_map: async (input) => createReduxStateFlowMap(resolveTinyChuPaths(root).root, input),
      auth_permission_trace: async (input) => createAuthPermissionTrace(resolveTinyChuPaths(root).root, input),
      error_transaction_map: async (input) => createErrorTransactionMap(resolveTinyChuPaths(root).root, input),
      test_impact_planner: async (input) => createTestImpactPlanner(resolveTinyChuPaths(root).root, input),
      worker_packet_optimizer: async (input) => {
        if (isWorkerRuntimeMode(runtimeMode) && input.dispatch === true) throw new TinyChuModeDispatchError(runtimeMode, "worker_packet_optimizer");
        return createWorkerPacketOptimizer(resolveTinyChuPaths(root).root, input);
      },
      artifact_pack_manifest: async (input) => createArtifactPackManifest(input),
      incremental_evidence_cache: async (input) => createIncrementalEvidenceCache(resolveTinyChuPaths(root).root, input),
      button_workflow_plan: async (input) => createButtonWorkflowPlan(resolveTinyChuPaths(root).root, input),
      button_worker_packet: async (input) => createButtonWorkerPacket(input),
      button_workflow_dispatch: async (input) => dispatchButtonWorkflow(resolveTinyChuPaths(root).root, input),
      markdown_envelope_check: async (input) => markdownEnvelopeCheck(input),
      button_worker_result_check: async (input) => buttonWorkerResultCheck(input),
      button_trace_aggregate: async (input) => aggregateButtonTraces(input),
      aggregation_drift_check: async (input) => aggregationDriftCheck(input),
      atomic_markdown_write: async (input) => atomicMarkdownWrite(resolveTinyChuPaths(root).root, input),
      write_loop_guard: async (input) => writeLoopGuard(resolveTinyChuPaths(root).root, input),
      button_workflow_done_claim: async (input) => buttonWorkflowDoneClaim(input),
      git_weekly_report: async (input) => createGitWeeklyReport(root, input),
      wiki_bundle: async (input) => wiki.bundle(Array.isArray(input.refs) ? input.refs.map(String) : []),
      wiki_search: async (input) => (await wikiToolModule()).createWikiSearch(root, input),
      wiki_context: async (input) => (await wikiToolModule()).createWikiContext(root, input),
      orchestration_profile: async () => orchestrationProfile,
      qwen_retry_policy: async (input) => createQwenRetryPolicy(input, runtimeMode),
      orchestration_health: async () => createOrchestrationHealth(root, runtimeMode),
      dashboard_snapshot: async (input) => createDashboardSnapshot(root, { ...input, mode: runtimeMode }),
      rules_snapshot: async (input) => writeRulesSnapshot(root, input),
      tool_usage_plan: async (input) => createToolUsagePlan(input, runtimeMode),
      ui_layout_catalog: async (input) => createUiLayoutCatalog(resolveTinyChuPaths(root).root, input),
      ux_rationale_trace: async (input) => createUxRationaleTrace(resolveTinyChuPaths(root).root, input),
      ux_validation_matrix: async (input) => createUxValidationMatrix(resolveTinyChuPaths(root).root, input),
      layout_truth_update: async (input) => updateLayoutTruth(resolveTinyChuPaths(root).root, input),
      layout_truth_verify: async (input) => verifyLayoutTruth(resolveTinyChuPaths(root).root, input),
      layout_truth_report: async (input) => reportLayoutTruth(resolveTinyChuPaths(root).root, input),
      ux_reverse_report: async (input) => createUxReverseReport(input),
      resume_packet: async (input) => {
        const task = await tasks.get(stringInput(input, "id"));
        if (!task) throw new Error(`Task not found: ${stringInput(input, "id")}`);
        return createResumePacket(task);
      },
      task_focus_packet: async (input) => createTaskFocusPacket(root, tasks, input),
      chunked_write_plan: async (input) => createChunkedWritePlan(input),
      small_model_replay: async (input) => createSmallModelReplay(input),
      artifact_format_template: async (input) => createArtifactFormatTemplate(root, input),
      artifact_check: async (input) => checkArtifactMarkdown({
        artifactType: stringInput(input, "artifactType"),
        markdown: await markdownInput(root, input),
        evidenceRefs: stringListInput(input, "evidenceRefs"),
      }),
      mermaid_check: async (input) => checkMermaidMarkdown(await markdownInput(root, input)),
      mermaid_fix: async (input) => fixMermaidMarkdown(await markdownInput(root, input)),
      analysis_workflow_start: async (input) => createAnalysisWorkflowStart(root, input),
      workflow_progress_heartbeat: async (input) => createWorkflowProgressHeartbeat(root, input),
      workflow_sot_audit: async (input) => createWorkflowSotAudit(root, input),
      ...workflowTools,
    };
  registry = composeFeaturePackages(createDefaultTinyFeaturePackages(tools, {
    safeTooling: config.safeTooling,
    nativePreviews: config.safeTooling === true && config.nativePreviews === true,
    mode: runtimeMode,
  }));

  return {
    name: "tiny-chu",
    runtimeMode,
    opencode: POWERSHELL_OPENCODE_RUNTIME,
    registry,
    tools: registry.tools,
    hooks: {
      async transformUserMessage(message, context) {
        if (!/\b(ulw|ultrawork)\b/i.test(message)) return message;
        const packet = await buildContextPacket({ root: resolveTinyChuPaths(root).root, targetPath: context?.targetPath ?? ".", maxChars: orchestrationProfile.packetStrategy.maxContextChars });
        if (isWorkerRuntimeMode(runtimeMode)) {
          return `${message}\n\n<tiny-chu-context>\n${JSON.stringify(packet, null, 2)}\n</tiny-chu-context>\n\n<tiny-chu-powershell-tooling>\n${renderCompactPowerShellToolingGuide()}\n</tiny-chu-powershell-tooling>`;
        }
        const compactGuide = renderCompactSmallContextGuide(orchestrationProfile);
        return `${message}\n\n<tiny-chu-context>\n${JSON.stringify(packet, null, 2)}\n</tiny-chu-context>\n\n<tiny-chu-powershell-tooling>\n${renderCompactPowerShellToolingGuide()}\n</tiny-chu-powershell-tooling>\n\n<tiny-chu-small-context>\n${compactGuide.text}\n</tiny-chu-small-context>`;
      },
      async onSessionIdle(input) {
        if (!input.planRef) return { shouldContinue: false, reason: "no active plan" };
        const status = await readPlanStatus(root, input.planRef);
        if (status.complete) return { shouldContinue: false, reason: "plan complete" };
        return { shouldContinue: true, reason: `${status.open} open checkbox item(s) remain` };
      },
    },
  };
}
