import { resolveTinyChuPaths } from "../state/paths.js";
import { createArtifactPublishApply, createArtifactPublishManifest } from "./artifact-publish.js";
import { createArtifactWorkspaceCommit, createArtifactWorkspacePrepare } from "./artifact-workspace.js";
import { createRunDiagnostics } from "./diagnostics-policy.js";
import { createJsonPatchPreview, createJsonYamlTransformPreview, createStructuralRewritePreview, createStructuralSearchAst } from "./native-tool-wrappers.js";
import { createPowerShellToolchainProbe } from "./powershell-toolchain-probe.js";
import { optionalBoolean, optionalNumber, publishEntries, stringArray, stringRecord } from "./safe-tool-inputs.js";
import { createSafePatchApply, createSafePatchCheck } from "./safe-patch.js";
import { stringInput } from "./tiny-tool-inputs.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";

export function createSafeToolHandlers(root: string | undefined): Readonly<Record<string, TinyToolHandler>> {
  const rootPath = () => resolveTinyChuPaths(root).root;
  return {
    powershell_toolchain_probe: async () => createPowerShellToolchainProbe(),
    run_diagnostics: async () => createRunDiagnostics(rootPath()),
    safe_patch_check: async (input) => createSafePatchCheck(rootPath(), {
      patch: stringInput(input, "patch"),
      allowedTargets: stringArray(input.allowedTargets),
      expectedFiles: stringRecord(input.expectedFiles),
      maxPatchBytes: optionalNumber(input.maxPatchBytes),
      maxFiles: optionalNumber(input.maxFiles),
    }),
    safe_patch_apply: async (input) => createSafePatchApply(rootPath(), {
      patch: stringInput(input, "patch"),
      allowedTargets: stringArray(input.allowedTargets),
      expectedFiles: stringRecord(input.expectedFiles),
      maxPatchBytes: optionalNumber(input.maxPatchBytes),
      maxFiles: optionalNumber(input.maxFiles),
    }),
    artifact_workspace_prepare: async (input) => createArtifactWorkspacePrepare(rootPath(), {
      allowedInputs: stringArray(input.allowedInputs),
      copyInputs: stringArray(input.copyInputs),
      initGit: optionalBoolean(input.initGit),
      purpose: typeof input.purpose === "string" ? input.purpose : undefined,
    }),
    artifact_workspace_commit: async (input) => createArtifactWorkspaceCommit(rootPath(), {
      workspaceRoot: stringInput(input, "workspaceRoot"),
      message: typeof input.message === "string" ? input.message : undefined,
    }),
    artifact_publish_manifest: async (input) => createArtifactPublishManifest(rootPath(), {
      workspaceRoot: stringInput(input, "workspaceRoot"),
      entries: publishEntries(input.entries),
      allowedTargets: stringArray(input.allowedTargets),
    }),
    artifact_publish_apply: async (input) => createArtifactPublishApply(rootPath(), {
      manifestPath: stringInput(input, "manifestPath"),
      dryRun: optionalBoolean(input.dryRun),
    }),
    structural_search_ast: async (input) => createStructuralSearchAst(rootPath(), {
      pattern: stringInput(input, "pattern"),
      language: stringInput(input, "language"),
      paths: stringArray(input.paths),
    }),
    structural_rewrite_preview: async (input) => createStructuralRewritePreview(rootPath(), {
      pattern: stringInput(input, "pattern"),
      rewrite: stringInput(input, "rewrite"),
      language: stringInput(input, "language"),
      paths: stringArray(input.paths),
    }),
    json_yaml_transform_preview: async (input) => createJsonYamlTransformPreview(rootPath(), {
      tool: input.tool === "yq" ? "yq" : "jq",
      expression: stringInput(input, "expression"),
      input: stringInput(input, "input"),
    }),
    json_patch_preview: async (input) => createJsonPatchPreview(rootPath(), {
      before: stringInput(input, "before"),
      after: stringInput(input, "after"),
    }),
  };
}
