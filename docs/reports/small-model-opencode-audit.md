# Small Model OpenCode Suitability Audit

Date: 2026-06-15

## Summary

Tiny-Chu is already broadly suitable for running a small foreman model in OpenCode when the model follows the intended tool path: bounded context packets, resume checkpoints, workflow packet fit checks, output budgets, safe write guards, artifact checks, and public-worker budgets are all present.

The remaining risk is not one missing primitive. The risk is that the available tool and documentation surface is now large enough that a small model can still choose too much work, read too much context, or write a long artifact in fragile partial chunks.

This run made one runtime optimization in that exact failure class: `chunked_write_plan` now prefers newline boundaries for intermediate Markdown chunks while preserving the existing character budget and exact round-trip content.

## 잘 하고 있는 점

- Context is bounded instead of memory-based. `buildContextPacket()` enforces `maxChars`, truncates bundled rule documents, records omissions, and rejects evidence paths outside the configured root. Evidence: `src/context/evidence-packet.ts:64`, `src/context/evidence-packet.ts:70`, `src/context/evidence-packet.ts:77`.
- OpenCode output is budgeted at the bridge. `renderBudgetedOutput()` caps output size and array length and returns truncation metadata, so large tool results are explicit instead of silent. Evidence: `src/opencode/output-budget.ts:56`, `src/opencode/output-budget.ts:63`, `src/opencode/output-budget.ts:72`.
- The small-context profile is operational, not just descriptive. It names the first tools, packet caps, no-reread rules, Qwen limits, checkpoint rules, and artifact validation gates. Evidence: `src/opencode/small-context-profile.ts:101`, `src/opencode/small-context-profile.ts:121`, `src/opencode/small-context-profile.ts:128`, `src/opencode/small-context-profile.ts:186`.
- Workflow orchestration is small-worker aware. Packet fit checks estimate token use, reject oversized packets, warn on mixed UI/backend scope, and return split candidates. Evidence: `src/state/workflow-helpers.ts:108`, `src/state/workflow-helpers.ts:153`, `src/state/workflow-helpers.ts:174`, `src/state/workflow-helpers.ts:189`.
- The OpenCode shell injects compact guidance for `ulw`/`ultrawork` prompts and exposes a single composed registry rather than hand-maintained parallel tool lists. Evidence: `src/opencode/tiny-plugin.ts:183`, `src/opencode/tiny-plugin.ts:194`, `src/opencode/tiny-plugin.ts:198`.
- Resume and focus packets reduce reliance on model memory. `resume_packet` returns the active task, latest checkpoint, next steps, open questions, and deduplicated evidence refs. Evidence: `src/opencode/small-model-tools.ts:74`, `src/opencode/small-model-tools.ts:81`, `src/opencode/small-model-tools.ts:87`.

## 모자른 점

- The baseline OpenCode tool surface is large. Tests currently expect 85 direct tools, and safe tooling/native previews expand that to 93/97. A small model can still spend context choosing tools unless `analysis_workflow_start`, `tool_usage_plan`, registry metadata, or an operating-mode gate narrows the menu first. Evidence: `test/module-registry.test.mjs`, `test/safe-tooling-registry.test.mjs`, `README.md`.
- Documentation is useful but heavy. `README.md` and `HOW_TO_USE.md` contain repeated tool lists, operating rules, and workflow recipes. Loading either wholesale can recreate the context-pressure problem the runtime tools are trying to solve. Evidence: `README.md:83`, `README.md:265`, `HOW_TO_USE.md:200`.
- `transformUserMessage()` injects three blocks for ULW prompts: context packet JSON, PowerShell tooling, and compact small-context guide. The blocks are bounded, but still add prompt mass at the exact moment the session may already be context-heavy. Evidence: `src/opencode/tiny-plugin.ts:194`, `src/opencode/tiny-plugin.ts:196`, `src/opencode/tiny-plugin.ts:198`.
- Packet fitting is intentionally static. That is deterministic and cheap, but it cannot yet distinguish dense source snippets, long natural-language evidence refs, or Markdown structures that consume different practical attention budgets. Evidence: `src/state/workflow-helpers.ts:149`, `src/state/workflow-helpers.ts:153`.
- Safe source mutation exists, but the default direct editing path can still be bypassed by an agent that does not choose `safe_patch_check` / `safe_patch_apply`. Evidence: `README.md:108`, `README.md:110`, `src/opencode/small-context-profile.ts:129`.

## 이번에 개선한 점

- `chunked_write_plan` no longer slices long Markdown only by raw character count. It now advances with a flexible `start` cursor, searches for the last newline inside the allowed window, and ends intermediate chunks at that newline when possible. Evidence: `src/opencode/small-model-tools.ts:96`, `src/opencode/small-model-tools.ts:98`, `src/opencode/small-model-tools.ts:102`.
- The new regression test proves the behavior a small writer needs: chunks stay within `maxChunkChars`, concatenate back to the exact original Markdown, and intermediate chunks end at newline boundaries. Evidence: `test/small-model-resilience.test.mjs:75`, `test/small-model-resilience.test.mjs:95`, `test/small-model-resilience.test.mjs:98`.
- Failing-first proof was captured before production code changed. RED evidence: `.omo/ulw-loop/small-model-opencode-audit-20260615/evidence/C002-red.txt`. GREEN evidence: `.omo/ulw-loop/small-model-opencode-audit-20260615/evidence/C002-chunked-write-proof.txt`.

## 남은 개선 필요점

- Add a generated compact tool index for small foreman models: top-level intent, required first tool, write risk, and max output mode per tool. This should be shorter than the README tool list and derived from the package registry.
- Reduce automatic ULW prompt injection further by replacing full JSON context blocks with a smaller digest unless the model explicitly asks for full context.
- Make workflow packet fit checks content-aware without losing determinism: line counts, Markdown heading/fence counts, evidence text length, and scope-kind density would be more useful than character-only token estimates.
- Make safe source mutation harder to bypass in OpenCode sessions that opt into `safeTooling`, especially for generated reports and source edits from small models.
- Split repeated guidance in `README.md` and `HOW_TO_USE.md` into one canonical compact operating contract plus links to longer references.
- Add a watchdog or recovery guide for long-running file read/write commands so a small model does not wait for hours without checkpointing, evidence capture, or cancellation guidance.

## Evidence

- `npm run build` plus focused `chunked_write_plan` tests: `.omo/ulw-loop/small-model-opencode-audit-20260615/evidence/C002-chunked-write-proof.txt`.
- Full-suite regression evidence for this report and optimization: `.omo/ulw-loop/small-model-opencode-audit-20260615/evidence/C003-full-test-proof.txt`.
- Report presence and required-section proof: `.omo/ulw-loop/small-model-opencode-audit-20260615/evidence/C001-report-proof.txt`.
