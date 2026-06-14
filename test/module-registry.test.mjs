import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tinyRoot from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";

const EXPECTED_ROOT_EXPORT_NAMES = [
  "ARTIFACT_CONTRACTS",
  "ARTIFACT_TYPES",
  "DEFAULT_SMALL_CONTEXT_MODELS",
  "POWERSHELL_OPENCODE_RUNTIME",
  "POWERSHELL_TOOLING_PROFILE",
  "PublicDispatcher",
  "QWEN_PUBLIC_LIMITS",
  "TaskStore",
  "TinyChuOpenCodePlugin",
  "WikiBundler",
  "aggregateButtonTraces",
  "aggregationDriftCheck",
  "appendJsonLine",
  "atomicMarkdownWrite",
  "buildContextPacket",
  "buttonWorkerResultCheck",
  "buttonWorkflowDoneClaim",
  "checkArtifactMarkdown",
  "checkMermaidMarkdown",
  "createApiBackendTrace",
  "createApiContractCatalog",
  "createArtifactFormatTemplate",
  "createArtifactPackManifest",
  "createAuthPermissionTrace",
  "createBusinessLogicMap",
  "createButtonWorkerPacket",
  "createButtonWorkflowPlan",
  "createChunkedWritePlan",
  "createClaimEvidenceCheck",
  "createContextDigest",
  "createDefaultAgentModelTemplates",
  "createDefaultSmallContextRunGate",
  "createDoctor",
  "createDtoSchemaMap",
  "createEnvironmentDoctor",
  "createErrorTransactionMap",
  "createEvidenceQa",
  "createEvidenceSnapshot",
  "createGitWeeklyReport",
  "createIncrementalEvidenceCache",
  "createIntegrationCatalog",
  "createLegacyRepoIndex",
  "createOrchestrationHealth",
  "createPowerShellCommandGuard",
  "createQwenRetryPolicy",
  "createReduxStateFlowMap",
  "createRepoMap",
  "createResumePacket",
  "createSessionPreflight",
  "createSmallContextOrchestrationProfile",
  "createSmallContextRunGate",
  "createTestImpactPlanner",
  "createTinyChuInstallCheck",
  "createTinyChuPlugin",
  "createToolUsagePlan",
  "createTraceDiagramRender",
  "createTraceabilityMatrix",
  "createUiActionTrace",
  "createUiLayoutCatalog",
  "createUxRationaleTrace",
  "createUxReverseReport",
  "createUxValidationMatrix",
  "createWorkerPacketOptimizer",
  "dispatchButtonWorkflow",
  "ensureDir",
  "fixMermaidMarkdown",
  "isPathInsideRoot",
  "loadContextBundle",
  "markdownEnvelopeCheck",
  "normalizeMermaidMarkdown",
  "parsePlanMarkdown",
  "readJsonFile",
  "readJsonLines",
  "readPlanStatus",
  "recommendModelOptionControls",
  "removeIfExists",
  "renderBudgetedOutput",
  "renderCompactPowerShellToolingGuide",
  "renderCompactSmallContextGuide",
  "renderPowerShellToolingGuide",
  "renderSmallContextGuide",
  "reportLayoutTruth",
  "resolvePathInsideRoot",
  "resolveTinyChuPaths",
  "selectPlanFocus",
  "updateLayoutTruth",
  "uxSourceFingerprint",
  "validateAgentModelTemplate",
  "verifyLayoutTruth",
  "writeJsonAtomic",
  "writeLoopGuard",
  "writePlanTemplate",
  "writeRulesSnapshot",
  "writeTextAtomic",
];

const EXPECTED_TOOL_NAMES = [
  "aggregation_drift_check",
  "api_backend_trace",
  "api_contract_catalog",
  "artifact_check",
  "artifact_format_template",
  "artifact_pack_manifest",
  "atomic_markdown_write",
  "auth_permission_trace",
  "business_logic_map",
  "button_trace_aggregate",
  "button_worker_packet",
  "button_worker_result_check",
  "button_workflow_dispatch",
  "button_workflow_done_claim",
  "button_workflow_plan",
  "chunked_write_plan",
  "claim_evidence_check",
  "context_bundle",
  "context_digest",
  "context_packet",
  "doctor",
  "dto_schema_map",
  "environment_doctor",
  "error_transaction_map",
  "evidence_qa",
  "evidence_snapshot",
  "git_weekly_report",
  "incremental_evidence_cache",
  "integration_catalog",
  "layout_truth_report",
  "layout_truth_update",
  "layout_truth_verify",
  "legacy_repo_index",
  "markdown_envelope_check",
  "mermaid_check",
  "mermaid_fix",
  "orchestration_health",
  "orchestration_profile",
  "powershell_command_guard",
  "public_cancel",
  "public_checkpoint",
  "public_collect",
  "public_complete",
  "public_dispatch",
  "public_retry",
  "qwen_retry_policy",
  "redux_state_flow_map",
  "repo_map",
  "resume_packet",
  "rules_snapshot",
  "session_preflight",
  "task_checkpoint",
  "task_create",
  "task_focus_packet",
  "task_get",
  "task_list",
  "task_update",
  "test_impact_planner",
  "tiny_chu_install_check",
  "tool_usage_plan",
  "trace_diagram_render",
  "traceability_matrix",
  "ui_action_trace",
  "ui_layout_catalog",
  "ux_rationale_trace",
  "ux_reverse_report",
  "ux_validation_matrix",
  "wiki_bundle",
  "worker_packet_optimizer",
  "write_loop_guard",
];

const EXPECTED_INSTALL_MODES = ["offline-bundle", "internal-registry", "developer-file"];

test("root module keeps the public ABI stable", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.exports["."], "./dist/index.js");
  assert.equal(packageJson.exports["./opencode"], "./dist/opencode/plugin.js");
  assert.equal(typeof tinyRoot.createTinyChuPlugin, "function");
  assert.equal(typeof tinyRoot.createGitWeeklyReport, "function");
  assert.equal(tinyRoot.TinyChuOpenCodePlugin, TinyChuOpenCodePlugin);
  assert.equal(tinyRoot.POWERSHELL_OPENCODE_RUNTIME.shell.executable, "pwsh");
  const directInstall = tinyRoot.createTinyChuInstallCheck();
  assert.equal(directInstall.requiredTools.length, 70);
  assert.equal(directInstall.packageName, "tiny-chu");
  assert.equal(directInstall.opencodeEntrypoint, "./dist/opencode/plugin.js");
  assert.equal(directInstall.status, "ready");
  assert.equal(directInstall.installDocs, "INSTALL.md");
  assert.equal(directInstall.opencodeShim, "templates/opencode/plugins/tiny-chu.ts");
  assert.equal(directInstall.offlineBundleName, "tiny-chu-offline-vX.Y.Z.tar.gz");
  assert.deepEqual(directInstall.installModes, EXPECTED_INSTALL_MODES);
  assert.deepEqual(Object.keys(tinyRoot).sort(), EXPECTED_ROOT_EXPORT_NAMES);
});

test("direct, install-check, and OpenCode tool registries stay in parity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-chu-module-registry-"));
  const tiny = tinyRoot.createTinyChuPlugin({ root });
  const hooks = await TinyChuOpenCodePlugin({
    project: { root },
    directory: root,
    worktree: root,
    client: { app: { log: async () => undefined } },
    $: async () => undefined,
  });
  const directToolNames = Object.keys(tiny.tools).sort();
  const bridgeToolNames = Object.keys(hooks.tool).sort();
  const install = await tiny.tools.tiny_chu_install_check({});

  assert.equal(typeof tiny.tools.git_weekly_report, "function");
  assert.equal(typeof hooks.tool.git_weekly_report?.execute, "function");
  assert.equal(directToolNames.length, 70);
  assert.equal(bridgeToolNames.length, 70);
  assert.equal(tiny.registry.packages.length, 9);
  assert.equal(tiny.registry.toolSpecs.length, 70);
  assert.equal(new Set(tiny.registry.toolSpecs.map((spec) => spec.packageId)).size, 7);
  assert.ok(tiny.registry.packageIds.includes("tiny-chu.legacy-analysis"));
  assert.ok(tiny.registry.packageIds.includes("tiny-chu.button-workflow-hardening"));
  assert.equal(tiny.registry.packageIds.includes("tiny-chu.workflow-hardening"), false);
  assert.equal(tiny.registry.toolSpecs.find((spec) => spec.name === "button_workflow_plan")?.packageId, "tiny-chu.button-workflow-hardening");
  assert.ok(tiny.registry.toolSpecs.every((spec) => spec.smallModel?.deterministic === true));
  assert.equal(tiny.registry.packages.find((item) => item.id === "tiny-chu.core-runtime")?.compatibility?.manifestVersion, 1);
  assert.equal(tiny.registry.packages.find((item) => item.id === "tiny-chu.host-opencode")?.compatibility?.hostApiVersion, "opencode-plugin-v1");
  assert.deepEqual(tiny.registry.packages.find((item) => item.id === "tiny-chu.core-runtime")?.compatibility?.optionalHooks, []);
  assert.deepEqual(tiny.registry.packages.find((item) => item.id === "tiny-chu.host-opencode")?.compatibility?.optionalHooks, [
    "chat.message",
    "experimental.session.compacting",
    "shell.env",
  ]);
  assert.equal(install.requiredTools.length, 70);
  assert.equal(install.packageName, "tiny-chu");
  assert.equal(install.opencodeEntrypoint, "./dist/opencode/plugin.js");
  assert.equal(install.status, "ready");
  assert.equal(install.installDocs, "INSTALL.md");
  assert.equal(install.opencodeShim, "templates/opencode/plugins/tiny-chu.ts");
  assert.equal(install.offlineBundleName, "tiny-chu-offline-vX.Y.Z.tar.gz");
  assert.deepEqual(install.installModes, EXPECTED_INSTALL_MODES);
  assert.deepEqual(install.exposedPackages.map((item) => item.id), tiny.registry.packageIds);
  assert.ok(install.nativeTools.includes("rg"));
  assert.deepEqual(directToolNames, EXPECTED_TOOL_NAMES);
  assert.deepEqual(bridgeToolNames, EXPECTED_TOOL_NAMES);
  assert.deepEqual(install.requiredTools, EXPECTED_TOOL_NAMES);
  assert.deepEqual(install.requiredTools, [...install.requiredTools].sort());

  const bridgeInstall = await hooks.tool.tiny_chu_install_check.execute(
    { input: {} },
    {
      sessionID: "s1",
      messageID: "m1",
      agent: "test",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    },
  );
  const bridgeInstallOutput = JSON.parse(bridgeInstall.output);
  assert.equal(bridgeInstallOutput.installDocs, "INSTALL.md");
  assert.deepEqual(bridgeInstallOutput.installModes, EXPECTED_INSTALL_MODES);
});
