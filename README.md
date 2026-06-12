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
