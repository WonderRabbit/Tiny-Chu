# Tiny Infi

Tiny Infi is a small, file-backed OpenCode-style orchestration shell inspired by the Light edition architecture in `oh-my-openagent`.

It deliberately keeps only the portable pieces needed for a local foreman model plus a single public worker API:

- nearest `AGENTS.md` and project rules context bundling
- `.omo/tasks/*.json` task persistence
- `.omo/plans/*.md` checkbox-driven continuation state
- `.tiny-infi/public-jobs/*.json` public-worker queue packets
- `.tiny-infi/wiki/index.json` canonical wiki bundle selection
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

## State layout

```text
.omo/
  plans/
  tasks/
.tiny-infi/
  public-jobs/
  wiki/
    index.json
```
