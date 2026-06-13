# Tiny Infi

Tiny Infi is a small, file-backed OpenCode-style orchestration shell inspired by the Light edition architecture in `oh-my-openagent`.

It deliberately keeps only the portable pieces needed for a local foreman model plus a single public worker API:

- nearest `AGENTS.md` and project rules context bundling
- `.tiny/tasks/*.json` task persistence
- `.tiny/plans/*.md` checkbox-driven continuation state
- `.tiny/public-jobs/*.json` public-worker queue packets
- `.tiny/wiki/index.json` canonical wiki bundle selection
- a thin `createTinyInfiPlugin()` shell exposing `task_*`, `public_*`, `context_bundle`, and `wiki_bundle` tools

It intentionally does not include Team Mode, Hyperplan, Atlas/parallel hooks, or the original delegate-task engine.

## Quick start

```bash
npm run build
npm test
```

## Minimal plugin usage

```ts
import { createTinyInfiPlugin } from "tiny-chu";

const tiny = createTinyInfiPlugin({
  root: process.cwd(),
  publicDispatcher: {
    softRpm: 12,
    softTpm: 14_000,
    hardRpm: 16,
    hardTpm: 18_000,
  },
});

await tiny.tools.task_create({ title: "Refactor auth boundary" });
```

## Use in OpenCode

This repository includes a project-local OpenCode plugin shim at `.opencode/plugins/tiny-chu.ts`:

```text
.opencode/
  package.json
  plugins/
    tiny-chu.ts
```

OpenCode automatically loads project-local plugins from `.opencode/plugins/`, so starting OpenCode from this repository root activates Tiny-Chu without editing `opencode.json`.

The local shim imports the TypeScript plugin adapter directly:

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "../../src/opencode/plugin.ts";
```

For another project, add Tiny-Chu to that project's `.opencode/package.json` and point a local plugin shim at the package subpath:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@opencode-ai/plugin": "^1.17.4",
    "tiny-chu": "file:/absolute/path/to/Tiny-Chu"
  }
}
```

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "tiny-chu/opencode";
```

The OpenCode plugin exposes the same durable tools as the library shell:

- `task_create`, `task_get`, `task_list`, `task_update`, `task_checkpoint`
- `public_dispatch`, `public_collect`, `public_checkpoint`, `public_retry`, `public_cancel`, `public_complete`
- `context_bundle`, `context_packet`, `context_digest`, `repo_map`, `business_logic_map`, `wiki_bundle`
- `legacy_repo_index`, `ui_action_trace`, `api_backend_trace`, `integration_catalog`, `traceability_matrix`, `evidence_qa`, `evidence_snapshot`
- `doctor`, `claim_evidence_check`, `session_preflight`, `task_focus_packet`, `powershell_command_guard`, `trace_diagram_render`, `tiny_chu_install_check`
- `environment_doctor`, `api_contract_catalog`, `dto_schema_map`, `redux_state_flow_map`, `auth_permission_trace`, `error_transaction_map`, `test_impact_planner`, `worker_packet_optimizer`, `artifact_pack_manifest`, `incremental_evidence_cache`
- `button_workflow_plan`, `button_worker_packet`, `button_workflow_dispatch`, `markdown_envelope_check`, `button_worker_result_check`, `button_trace_aggregate`, `aggregation_drift_check`, `atomic_markdown_write`, `write_loop_guard`, `button_workflow_done_claim`
- `tool_usage_plan`, `resume_packet`, `chunked_write_plan`, `qwen_retry_policy`, `orchestration_health`, `rules_snapshot`
- `ui_layout_catalog`, `ux_rationale_trace`, `ux_validation_matrix`, `layout_truth_update`, `layout_truth_verify`, `layout_truth_report`, `ux_reverse_report`
- `orchestration_profile`, `artifact_format_template`, `artifact_check`, `mermaid_check`, `mermaid_fix`

It also sets `TINY_CHU_ROOT` and `TINY_CHU_OPENCODE_PLUGIN` through the OpenCode `shell.env` hook, and adds a compact continuation reminder during OpenCode session compaction.

After building, smoke-test the plugin entrypoint with:

```bash
npm run build
node --input-type=module -e "import { TinyChuOpenCodePlugin } from './dist/opencode/plugin.js'; console.log(typeof TinyChuOpenCodePlugin)"
```

## OpenCode shell runtime

`createTinyInfiPlugin()` declares that OpenCode sessions should run on the PowerShell runtime. The exported runtime setting pins the shell name, executable, startup arguments, and PowerShell version so consumers can inspect or pass it through to their OpenCode configuration.

```ts
import { POWERSHELL_OPENCODE_RUNTIME, createTinyInfiPlugin } from "tiny-chu";

const tiny = createTinyInfiPlugin();

console.log(tiny.opencode.shell);
// { name: "powershell", executable: "pwsh", version: "7.6.2", args: ["-NoLogo", "-NoProfile"] }
console.log(POWERSHELL_OPENCODE_RUNTIME.shell.version);
// "7.6.2"
```


## PowerShell native-tool profile

Tiny Infi also exports a compact PowerShell tooling profile for small foreman models. The profile records the shell parsing rules and safe defaults that usually cause mistakes when Unix-oriented tools are called from `pwsh`:

- use real native executables (`jq`, `yq`, `mdq`, `fd`, `ast-grep`, `rg`) instead of PowerShell aliases or Unix-only commands such as `grep -R`, `find -name`, and `xargs` pipelines
- single-quote filters, selectors, regexes, and structural patterns so PowerShell does not expand `$`, `[]`, `{}`, `|`, or backticks before the native tool receives them
- insert the native tool's own `--` separator before positional patterns or paths that begin with `-`
- prefer machine-readable output (`--json`, `--json=stream`, `-o json`, `-c`) and deterministic no-color environment defaults
- set `$PSNativeCommandArgumentPassing = 'Standard'` for PowerShell 7+ sessions with complex native arguments

```ts
import { POWERSHELL_TOOLING_PROFILE, renderPowerShellToolingGuide } from "tiny-chu";

console.log(POWERSHELL_TOOLING_PROFILE.nativeTools.map((tool) => tool.name));
// ["jq", "yq", "mdq", "fd", "ast-grep", "ripgrep"]

console.log(renderPowerShellToolingGuide());
```

When `transformUserMessage()` injects Tiny Infi context for `ulw`/`ultrawork` requests, it now appends a compact version of this guide in a `<tiny-infi-powershell-tooling>` block. The compact block keeps the quoting and shell-safety rules that small models commonly miss, while the full `renderPowerShellToolingGuide()` API remains available for explicit inspection.

## Small-context orchestration profile

Tiny Infi now exposes an orchestration profile for a small local foreman model and a larger delegated analysis agent. It is designed for Windows 10, PowerShell 7.6, and OpenCode plugin sessions where the foreman should avoid reading whole repositories into context.

```ts
const profile = await tiny.tools.orchestration_profile({});

console.log(profile.models.foreman);
// { provider: "ollama", model: "gemma4-small", ... }

console.log(profile.models.delegate.model);
// "qwen3.6-35b-a3b"
```

The profile gives the foreman a deterministic sequence:

- inventory files with `fd`
- choose the next bounded step with `tool_usage_plan`
- map architecture and UI/API/database flow candidates with `repo_map`
- extract business variables, database-style columns, and comparison expressions with `business_logic_map`
- search text with `rg --json`
- search TypeScript structure with `ast-grep`
- extract bounded source snippets with `context_digest` before making repository claims
- resume and compact with bounded `context_packet` and `task_focus_packet` instead of re-reading full context
- summarize previous `.omo/evidence` artifacts with `evidence_snapshot` before repeating scan-heavy work
- slice JSON/YAML/Markdown with `jq`, `yq`, and `mdq`
- delegate compact packets to the Qwen worker, using `qwen_retry_policy` for the public limit of 20 requests/min and 20000 tokens/min
- resume interrupted work with `resume_packet` instead of relying on memory
- split long generated Markdown with `chunked_write_plan` before writing files
- check `orchestration_health` after failed, interrupted, checkpointed, or retry-wait worker jobs
- write confirmed implementation patterns with `rules_snapshot` so future changes can load `.tiny/rules/architecture-patterns.md`
- checkpoint after each pass so resumed work starts from the latest evidence
- validate Mermaid diagrams with `mermaid-cli` (`mmdc`) before publishing
- call `artifact_format_template` before artifact generation, then `artifact_check` after generation

The profile also exposes a 20-pass audit loop and artifact contracts for:

- AS-IS analysis
- UI definition documents
- Mermaid sequence diagrams
- Mermaid flowcharts
- user stories
- test cases
- Mermaid ERDs
- UX reverse analysis with layout truth

Each pass follows a small-model-safe cycle: review the evidence map, plan one bounded improvement, apply or explicitly skip with evidence, validate the artifact/tool output, then checkpoint `passIndex`, `artifactType`, `evidenceRefs`, `verificationCommands`, `nextSteps`, and `openQuestions`.

`transformUserMessage()` appends a compact operating brief in a `<tiny-infi-small-context>` block for `ulw`/`ultrawork` prompts. The injected brief includes `profileMode: compact`, model budgets, required first tools, omitted full-profile counts, checkpoint/retry reminders, and a pointer to call `orchestration_profile` only when full contract detail is needed.

## Small-model resilience tools

### Small-context operating-mode correction gate

Use `doctor` as the Small-context operating-mode correction gate before a small foreman starts project-wide work. The gate is local-only: Tiny-Chu makes no live provider call while proving readiness, shaping Qwen packets, or checking stale evidence.

Exact no-live-provider sequence:

1. `doctor`
2. `session_preflight` when a task id exists
3. `context_packet`
4. `incremental_evidence_cache`
5. `tool_usage_plan`
6. `worker_packet_optimizer({ dispatch: false })`
7. `qwen_retry_policy`
8. `claim_evidence_check`
9. `artifact_pack_manifest`
10. `task_checkpoint` or `resume_packet`

`incremental_evidence_cache` reports source hash staleness only. It is not a git dirty-worktree detector. Executors must run `git status --short` before editing and inspect `git diff -- <file>` for every dirty tracked file in scope.

Use `context_digest` when the foreman model needs repository evidence but should not read an entire file into context. It returns bounded line snippets and citations.

Use `tool_usage_plan` when the foreman model is unsure which command or Tiny-Chu tool to run next. It returns a short ordered plan with native commands, Tiny-Chu tools, output budgets, `omittedSteps`, `nextRequiredTool`, and `deterministicCaps`.

`tool_usage_plan` also returns a `verification` block. The `steps` array stays capped for small models, but the foreman must still run `verification.requiredTools` after implementation before stopping or checkpointing final output.

OpenCode tool executions also apply a final output budget at the plugin bridge. Direct library calls still return normal structured objects, but OpenCode `ToolResult.output` is bounded by `maxOutputChars` and `maxArrayItems` inputs when supplied, with truncation metadata in `ToolResult.metadata`.

Use `repo_map` before explaining architecture or tracing data flow. It scans bounded files, classifies UI/API/database/domain/config/test layers, and returns recommended `fd`, `rg`, `ast-grep`, and `context_digest` follow-up commands.

Use `business_logic_map` before explaining complex business rules. It returns bounded variables, database-style column names, comparison operators, and line evidence so a small model can compare business logic without loading whole files.

Use the legacy analysis tool chain when a small foreman model needs Button to FE action/saga/API to backend service to MyBatis/RFC traceability:

1. `legacy_repo_index` builds a deterministic evidence index from React, Redux-Saga, Axios, Java Spring/Vert.x-style routes, MyBatis XML, and SAP JCo-style RFC candidates.
2. `ui_action_trace` links a UI event to handler, Redux action, Saga watcher/worker, and API client when evidence exists.
3. `api_backend_trace` links an HTTP method/path to backend route, service, mapper, and RFC facts; unmatched endpoints stay explicit.
4. `integration_catalog` catalogs MyBatis mapper SQL and RFC calls separately.
5. `traceability_matrix` merges the verified links into JSON rows and Markdown-ready table data.
6. `evidence_qa` blocks missing evidence ids, hallucinated symbols, and partial traces that omit Unknown gaps.

Use the UX reverse-engineering chain when the foreman must explain why search conditions or result fields exist, why they appear in source order, and how validation/messages are derived:

1. `ui_layout_catalog` scans React/JS/TS source only and catalogs search conditions, action controls, result fields, and message keys with line evidence.
2. `ux_rationale_trace` creates conservative `Verified`, `Inferred`, `Unknown`, or `Needs Verification` reasons. It does not emit LLM-only hypotheses.
3. `ux_validation_matrix` separates value kind, client rules, server DTO/MyBatis evidence, message evidence, and unknowns.
4. `ux_reverse_report` renders Markdown for the `ux_reverse_analysis` artifact contract.
5. `layout_truth_verify` checks existing `.tiny/ux/layout-truth.json` before reuse.
6. `layout_truth_update` stores stronger evidence without downgrading verified layout truth.
7. `layout_truth_report` renders `.tiny/ux/layout-truth.md` for review.

Figma is intentionally adapter-ready only in this first implementation. The UX report includes mapping keys such as `fileKey`, `nodeId`, `figmaNodeName`, `truthId`, `component`, and `variables`, but Tiny-Chu does not call Figma APIs or require tokens.

Generated analysis deliverables should use `.analysis/` only when a caller explicitly asks for files. Tiny-Chu orchestration state remains under `.tiny/`.

For stricter small-model runs, start with `environment_doctor`, then use `session_preflight` and `incremental_evidence_cache` before reusing old context. Use `api_contract_catalog`, `dto_schema_map`, `redux_state_flow_map`, `auth_permission_trace`, and `error_transaction_map` to turn repeated source inspection into bounded JSON. Before publishing, run `claim_evidence_check`, `trace_diagram_render`, and `artifact_pack_manifest` so named claims, Mermaid diagrams, and grouped design outputs stay evidence-bound.

Use `doctor` as the canonical readiness facade when a run needs one normalized status across command availability, read-only runtime state, PowerShell runtime expectations, and session preflight. `environment_doctor` remains the focused command check, and `orchestration_health` remains the recovery check after failed or checkpointed work.

For multi-button legacy UI analysis, use the button workflow tools instead of sending all buttons to one worker. `button_workflow_plan` creates one work item per control, `button_worker_packet` and `button_workflow_dispatch` keep worker jobs JSON-only and sequential by default, `button_worker_result_check` gates `public_complete`, and `button_workflow_done_claim` verifies that all planned buttons, artifacts, drift checks, and checkpoints are complete.

Use `artifact_format_template` before drafting AS-IS, UI, story, testcase, Mermaid, ERD, or UX reverse artifacts. A project may override built-ins with `.tiny/artifacts/templates/<artifactType>.md`; templates are preparation inputs and are not counted as produced artifacts by `artifact_pack_manifest`.

Agent model option templates are exposed on `orchestration_profile.agentTemplates` with data-only helpers for provider capability validation and UI control recommendations. OpenAI and Anthropic entries are adapter-ready validation metadata only; Tiny-Chu makes no live provider API calls.

Use `qwen_retry_policy` whenever `qwen3.6-35b-a3b` delegation may hit the shared public limit. The encoded limit is 20 requests/min and 20000 tokens/min; the policy returns spacing, retry delays, minimum chunk count, and a non-stop recovery protocol.

Use `orchestration_health` after failures or interruptions. It summarizes `.tiny/tasks` and `.tiny/public-jobs`, highlights retryable or checkpointed jobs, and returns recovery steps that preserve progress.

Use `rules_snapshot` after confirming repository architecture patterns. It writes `.tiny/rules/architecture-patterns.md` so future implementation requests reuse known Tiny-Chu patterns instead of asking the model to rediscover them.

Use `resume_packet` at session start, after compaction, or after a long command. Use `task_focus_packet` when the foreman needs the active task plus the next open plan checkbox and latest checkpoint in one bounded object.

Use `chunked_write_plan` before writing long Markdown artifacts. Generated Markdown writes should go through `atomic_markdown_write` and `write_loop_guard` when Tiny-Chu is responsible for the file, so identical writes are skipped, empty overwrites are blocked, and no `.bak` files are created.

Use `layout_truth_verify` before trusting saved UX rationale. If source fingerprints changed, stale records must be reviewed before `layout_truth_update` evolves `.tiny/ux/layout-truth.json`.

## Durable continuation checkpoints

Use `task_checkpoint` when the small foreman finishes a scan, starts a large command, delegates to a worker, or receives an artifact. New checkpoints are appended to `.tiny/tasks/<task-id>.checkpoints.jsonl`; `TaskStore.get()` and `TaskStore.list()` still return merged checkpoint history while keeping the main task JSON compact.

```ts
const task = await tiny.tools.task_create({ title: "Analyze repository" });

await tiny.tools.task_checkpoint({
  id: task.id,
  summary: "selected source entry points with fd and rg",
  artifactType: "as_is",
  passIndex: 3,
  nextSteps: ["run ast-grep over plugin tools", "ask Qwen for design risks"],
  evidenceRefs: ["fd://src/**/*.ts", "rg://createTinyInfiPlugin"],
  openQuestions: ["which docs need Mermaid diagrams?"],
  verificationCommands: ["rg --json createTinyInfiPlugin src"],
});
```

## Artifact guard

Use `artifact_check` before accepting generated repository artifacts from a small model or delegated worker. The checker rejects unsupported artifact types, missing evidence references, missing required sections, missing inline citations, missing Mermaid blocks, and obvious Mermaid syntax errors.

```ts
const result = await tiny.tools.artifact_check({
  artifactType: "ux_reverse_analysis",
  markdown: "## Screen Summary\nsrc/ui/OrderSearch.jsx:6\n\n## Layout Inventory\nSource-order elements.\n\n## Layout Truth\nEvidence-backed source order only.\n\n## Existence Rationale\nVerified/Inferred/Unknown only.\n\n## Position Rationale\nSource-order rationale.\n\n## Validation Matrix\nClient and server rules are split.\n\n## Messages\n- Unknown\n\n## Unknowns\n- None\n\n## Evidence\n- src/ui/OrderSearch.jsx:6",
  evidenceRefs: ["src/ui/OrderSearch.jsx:6"],
});

// result.valid === true
```

For Mermaid-backed artifacts (`sequence_diagram`, `flowchart`, `erd`), `artifact_check` reuses the Mermaid guard and enforces the expected diagram declaration.

## Mermaid guard

The plugin includes lightweight Mermaid fence and syntax checks that catch common small-model formatting mistakes before `mmdc` runs. When reading Markdown from a `path`, the path is confined to the configured plugin root.

```ts
const result = await tiny.tools.mermaid_check({
  markdown: "```Mermaid\nflowchart TD\nA-->B\n",
});

// result.valid === false
// result.diagnostics includes "non_normalized_fence" and "unclosed_fence"

const fixed = await tiny.tools.mermaid_fix({
  markdown: "```Mermaid\nflowchart TD\nA-->B\n",
});

console.log(fixed.markdown);
// ```mermaid
// flowchart TD
// A-->B
// ```
```

## State layout

```text
.tiny/
  plans/
  public-jobs/
  rules/
  tasks/
  wiki/
    index.json
```
