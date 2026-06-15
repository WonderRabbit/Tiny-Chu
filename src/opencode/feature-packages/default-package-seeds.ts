import { BUTTON_WORKFLOW_DISPATCH_TOOLS, BUTTON_WORKFLOW_LOCAL_TOOLS, CORE_RUNTIME_TOOLS, DOCTOR_ARTIFACT_TOOLS, EXTENSION_UTILITY_TOOLS, LEGACY_ANALYSIS_TOOLS, NATIVE_PREVIEW_TOOLS, PUBLIC_QUEUE_TOOLS, SAFE_TOOLING_TOOLS, SMALL_MODEL_TOOLS, UX_REVERSE_ENGINEERING_TOOLS, WORKFLOW_ORCHESTRATION_TOOLS } from "./default-tool-seeds.js";
import { instruction, resource, type PackageSeed } from "./tool-seed.js";

export const DEFAULT_PACKAGE_SEEDS: readonly PackageSeed[] = [
  {
    id: "tiny-chu.core-runtime",
    title: "Core Runtime",
    category: "core-runtime",
    tools: CORE_RUNTIME_TOOLS,
    resources: [
      resource("core-state", "Task, public job, context, wiki, and plan state primitives.", "src/state"),
      resource("core-context", "Context, evidence packet, dispatcher, wiki, and checkbox-plan modules.", "src/context"),
    ],
    instructions: [instruction("core-runtime-rule", "Resolve state paths through resolveTinyChuPaths and keep JSON output deterministic.")],
  },
  {
    id: "tiny-chu.shared-support",
    title: "Shared Support",
    category: "support",
    dependsOn: ["tiny-chu.core-runtime"],
    tools: [],
    resources: [
      resource("shared-scanners", "Bounded scanner, legacy input, evidence, artifact, Mermaid, and PowerShell helpers.", "src/opencode"),
      resource("shared-markdown", "Mermaid Markdown syntax guard helpers.", "src/markdown"),
    ],
    instructions: [instruction("shared-boundary-rule", "Shared support may depend on core but must not import feature or host adapters.")],
  },
  {
    id: "tiny-chu.public-worker-queue",
    title: "Public Worker Queue",
    category: "core-runtime",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support"],
    tools: PUBLIC_QUEUE_TOOLS,
  },
  {
    id: "tiny-chu.legacy-analysis",
    title: "Legacy Analysis",
    category: "legacy-analysis",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support"],
    tools: LEGACY_ANALYSIS_TOOLS,
  },
  {
    id: "tiny-chu.extension-utilities",
    title: "Analysis Extension Utilities",
    category: "extension-utilities",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support", "tiny-chu.legacy-analysis"],
    tools: EXTENSION_UTILITY_TOOLS,
  },
  {
    id: "tiny-chu.button-workflow-hardening",
    title: "Button Workflow Hardening",
    category: "workflow-hardening",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support", "tiny-chu.legacy-analysis"],
    tools: BUTTON_WORKFLOW_LOCAL_TOOLS,
  },
  {
    id: "tiny-chu.button-workflow-dispatch",
    title: "Button Workflow Dispatch",
    category: "workflow-hardening",
    dependsOn: ["tiny-chu.public-worker-queue", "tiny-chu.button-workflow-hardening"],
    tools: BUTTON_WORKFLOW_DISPATCH_TOOLS,
  },
  {
    id: "tiny-chu.workflow-orchestration",
    title: "Workflow Orchestration",
    category: "workflow-orchestration",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support"],
    tools: WORKFLOW_ORCHESTRATION_TOOLS,
  },
  {
    id: "tiny-chu.small-model-resilience",
    title: "Small Model Resilience",
    category: "small-model-resilience",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support"],
    tools: SMALL_MODEL_TOOLS,
  },
  {
    id: "tiny-chu.ux-reverse-engineering",
    title: "UX Reverse Engineering",
    category: "ux-reverse-engineering",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support", "tiny-chu.legacy-analysis"],
    tools: UX_REVERSE_ENGINEERING_TOOLS,
  },
  {
    id: "tiny-chu.doctor-artifacts",
    title: "Doctor and Artifact Guards",
    category: "doctor-artifacts",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support", "tiny-chu.small-model-resilience"],
    tools: DOCTOR_ARTIFACT_TOOLS,
  },
  {
    id: "tiny-chu.host-opencode",
    title: "OpenCode Host Adapter",
    category: "support",
    dependsOn: [
      "tiny-chu.doctor-artifacts",
      "tiny-chu.extension-utilities",
      "tiny-chu.button-workflow-hardening",
      "tiny-chu.button-workflow-dispatch",
      "tiny-chu.ux-reverse-engineering",
      "tiny-chu.workflow-orchestration",
    ],
    tools: [],
    resources: [resource("opencode-adapter", "OpenCode bridge, output budget wrapper, install-check, and host hooks.", "src/opencode/plugin.ts")],
    instructions: [instruction("host-registry-rule", "OpenCode host adapters consume composed descriptors and do not own feature tool lists.")],
    hooks: {
      beforeRun: ["chat.message", "shell.env", "experimental.session.compacting"],
    },
  },
];

export const SAFE_TOOLING_PACKAGE_SEEDS: readonly PackageSeed[] = [
  {
    id: "tiny-chu.safe-tooling",
    title: "Safe Source Tooling",
    category: "safe-tooling",
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support"],
    tools: SAFE_TOOLING_TOOLS,
  },
  {
    id: "tiny-chu.native-previews",
    title: "Native Preview Tools",
    category: "safe-tooling",
    dependsOn: ["tiny-chu.safe-tooling"],
    tools: NATIVE_PREVIEW_TOOLS,
  },
];
