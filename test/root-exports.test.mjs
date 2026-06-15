import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as tinyRoot from "../dist/index.js";
import { TinyChuOpenCodePlugin } from "../dist/opencode/plugin.js";
import { TinyChuOpenCodeTuiPlugin } from "../dist/opencode/tui-plugin.js";

const EXPECTED_INSTALL_MODES = ["offline-bundle", "internal-registry", "developer-file"];
const EXPECTED_ROOT_EXPORT_NAMES = [
  "ANALYSIS_WORKFLOW_PHASE_IDS",
  "ARTIFACT_CONTRACTS",
  "ARTIFACT_TYPES",
  "DEFAULT_SMALL_CONTEXT_MODELS",
  "POWERSHELL_OPENCODE_RUNTIME",
  "POWERSHELL_TOOLING_PROFILE",
  "PublicDispatcher",
  "QWEN_PUBLIC_LIMITS",
  "SAFE_TOOLING_LIMITS",
  "TaskStore",
  "TinyChuModeDispatchError",
  "TinyChuOpenCodePlugin",
  "TinyChuOpenCodeTuiPlugin",
  "TinyChuRuntimeModeError",
  "WikiBundler",
  "WorkflowStore",
  "acquireSafeToolingLock",
  "aggregateButtonTraces",
  "aggregationDriftCheck",
  "appendJsonLine",
  "atomicMarkdownWrite",
  "boundedText",
  "buildContextPacket",
  "buttonWorkerResultCheck",
  "buttonWorkflowDoneClaim",
  "checkArtifactMarkdown",
  "checkMermaidMarkdown",
  "createAnalysisWorkflowDefinition",
  "createAnalysisWorkflowStart",
  "createApiBackendTrace",
  "createApiContractCatalog",
  "createArtifactFormatTemplate",
  "createArtifactPackManifest",
  "createArtifactPublishApply",
  "createArtifactPublishManifest",
  "createArtifactWorkspaceCommit",
  "createArtifactWorkspacePrepare",
  "createAuthPermissionTrace",
  "createBusinessLogicMap",
  "createButtonWorkerPacket",
  "createButtonWorkflowPlan",
  "createChunkedWritePlan",
  "createClaimEvidenceCheck",
  "createContextBudgetSimulation",
  "createContextDigest",
  "createDashboardSnapshot",
  "createDefaultAgentModelTemplates",
  "createDefaultSmallContextRunGate",
  "createDoctor",
  "createDtoSchemaMap",
  "createEnvironmentDoctor",
  "createErrorTransactionMap",
  "createEvidenceGate",
  "createEvidenceQa",
  "createEvidenceSnapshot",
  "createGitWeeklyReport",
  "createIncrementalEvidenceCache",
  "createIntegrationCatalog",
  "createJsonPatchPreview",
  "createJsonYamlTransformPreview",
  "createLegacyRepoIndex",
  "createOrchestrationHealth",
  "createPowerShellCommandGuard",
  "createPowerShellToolchainProbe",
  "createProviderEndpointPreflight",
  "createPublicJobResumePacket",
  "createQwenRetryPolicy",
  "createReduxStateFlowMap",
  "createRepoMap",
  "createResumePacket",
  "createRunDiagnostics",
  "createSafePatchApply",
  "createSafePatchCheck",
  "createSessionPreflight",
  "createSmallContextOrchestrationProfile",
  "createSmallContextRunGate",
  "createSmallModelReplay",
  "createStructuralRewritePreview",
  "createStructuralSearchAst",
  "createTestImpactPlanner",
  "createTinyChuInstallCheck",
  "createTinyChuPlugin",
  "createToolCallConformanceProbe",
  "createToolUsagePlan",
  "createTraceDiagramRender",
  "createTraceabilityMatrix",
  "createUiActionTrace",
  "createUiLayoutCatalog",
  "createUxRationaleTrace",
  "createUxReverseReport",
  "createUxValidationMatrix",
  "createWorkerPacketOptimizer",
  "createWorkflow",
  "createWorkflowCheckpoint",
  "createWorkflowDefinition",
  "createWorkflowDefinitionNodes",
  "createWorkflowNextPacket",
  "createWorkflowPacketFitCheck",
  "createWorkflowProgressHeartbeat",
  "createWorkflowResumePacket",
  "createWorkflowSotAudit",
  "createWorkflowStatus",
  "dispatchButtonWorkflow",
  "ensureDir",
  "fixMermaidMarkdown",
  "hashSourceTarget",
  "isPathInsideRoot",
  "isWorkerRuntimeMode",
  "loadContextBundle",
  "markdownEnvelopeCheck",
  "normalizeMermaidMarkdown",
  "normalizeSafeRelativePath",
  "normalizeTinyChuRuntimeMode",
  "parsePlanMarkdown",
  "readJsonFile",
  "readJsonLines",
  "readPlanStatus",
  "readWorkspaceFile",
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

test("root module keeps the public ABI stable", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.exports["."], "./dist/index.js");
  assert.equal(packageJson.exports["./opencode"], "./dist/opencode/plugin.js");
  assert.equal(packageJson.exports["./tui"], "./dist/opencode/tui-plugin.js");
  assert.equal(typeof tinyRoot.createTinyChuPlugin, "function");
  assert.equal(typeof tinyRoot.createGitWeeklyReport, "function");
  assert.equal(tinyRoot.TinyChuOpenCodePlugin, TinyChuOpenCodePlugin);
  assert.equal(tinyRoot.TinyChuOpenCodeTuiPlugin, TinyChuOpenCodeTuiPlugin);
  assert.equal(tinyRoot.POWERSHELL_OPENCODE_RUNTIME.shell.executable, "pwsh");
  const directInstall = tinyRoot.createTinyChuInstallCheck();
  assert.equal(directInstall.requiredTools.length, 86);
  assert.equal(directInstall.runtimeMode, "orchestrator_worker");
  assert.equal(directInstall.packageName, "tiny-chu");
  assert.equal(directInstall.opencodeEntrypoint, "./dist/opencode/plugin.js");
  assert.equal(directInstall.opencodeTuiEntrypoint, "./dist/opencode/tui-plugin.js");
  assert.equal(directInstall.status, "ready");
  assert.equal(directInstall.installDocs, "INSTALL.md");
  assert.equal(directInstall.opencodeShim, "templates/opencode/plugins/tiny-chu.ts");
  assert.equal(directInstall.opencodeTuiConfig, "templates/opencode/tui.json");
  assert.equal(directInstall.opencodeTuiShim, "templates/opencode/plugins/tiny-chu-tui.ts");
  assert.equal(directInstall.offlineBundleName, "tiny-chu-offline-vX.Y.Z.tar.gz");
  assert.deepEqual(directInstall.installModes, EXPECTED_INSTALL_MODES);
  assert.deepEqual(Object.keys(tinyRoot).sort(), EXPECTED_ROOT_EXPORT_NAMES);
});
