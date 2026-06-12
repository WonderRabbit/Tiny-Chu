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
- `public_dispatch`, `public_collect`, `public_retry`, `public_cancel`
- `context_bundle`, `context_digest`, `wiki_bundle`
- `resume_packet`, `chunked_write_plan`
- `orchestration_profile`, `artifact_check`, `mermaid_check`, `mermaid_fix`

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

When `transformUserMessage()` injects Tiny Infi context for `ulw`/`ultrawork` requests, it now appends this guide in a `<tiny-infi-powershell-tooling>` block so the active model can use these tools without re-deriving PowerShell-safe syntax every turn.

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
- search text with `rg --json`
- search TypeScript structure with `ast-grep`
- extract bounded source snippets with `context_digest` before making repository claims
- slice JSON/YAML/Markdown with `jq`, `yq`, and `mdq`
- delegate compact packets to the Qwen worker
- resume interrupted work with `resume_packet` instead of relying on memory
- split long generated Markdown with `chunked_write_plan` before writing files
- checkpoint after each pass so resumed work starts from the latest evidence
- validate Mermaid diagrams with `mermaid-cli` (`mmdc`) before publishing

The profile also exposes a 20-pass audit loop and artifact contracts for:

- AS-IS analysis
- UI definition documents
- Mermaid sequence diagrams
- Mermaid flowcharts
- user stories
- test cases
- Mermaid ERDs

Each pass follows a small-model-safe cycle: review the evidence map, plan one bounded improvement, apply or explicitly skip with evidence, validate the artifact/tool output, then checkpoint `passIndex`, `artifactType`, `evidenceRefs`, `verificationCommands`, `nextSteps`, and `openQuestions`.

`transformUserMessage()` also appends this profile in a `<tiny-infi-small-context>` block for `ulw`/`ultrawork` prompts.

## Small-model resilience tools

Use `context_digest` when the foreman model needs repository evidence but should not read an entire file into context. It returns bounded line snippets and citations.

Use `resume_packet` at session start, after compaction, or after a long command. It returns the active task, latest checkpoint, next steps, open questions, and evidence refs.

Use `chunked_write_plan` before writing long Markdown artifacts. It splits the intended output into bounded chunks so a small model can write and verify incrementally.

## Durable continuation checkpoints

Use `task_checkpoint` when the small foreman finishes a scan, starts a large command, delegates to a worker, or receives an artifact. Checkpoints are stored on the task JSON under `.tiny/tasks/`.

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
  artifactType: "as_is",
  markdown: "## Evidence\n- src/index.ts:1\n\n## Current Behavior\n...",
  evidenceRefs: ["src/index.ts:1"],
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
