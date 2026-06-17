# Small Model Contribution Evaluation

Date: 2026-06-17

This is the canonical current checklist for judging whether a Tiny-Chu change materially helps a small-model foreman. It supersedes docs-only judgment by producing one offline score, load-factor diagnostics, `blockedReasons`, and `fixPaths`. Prior audit context: [small-model-opencode-audit.md](./small-model-opencode-audit.md).

## Score Contract

Each rubric row is scored `0/1/2`.

| Score | Meaning |
|-------|---------|
| 0 | Missing, unverified, or increases small-model load. |
| 1 | Partial infrastructure exists, but the model still needs careful manual recovery or extra context. |
| 2 | Implemented, bounded, evidenced, and reusable in a small-model run. |

`rawScore` is the sum of row scores. `maxScore` is `44` for the 22 required rows. `normalizedScore = Math.round(rawScore / maxScore * 100)`.

Score bands:

| Band | Range | Interpretation |
|------|-------|----------------|
| `material_help` | 82-100 | Directly improves small-model success under realistic load. |
| `infrastructure_help` | 55-81 | Useful foundation, but still needs recovery or benchmark hardening. |
| `weak_scaffold` | 28-54 | Some structure exists, but a small model remains likely to stall or overrun. |
| `decorative` | 0-27 | Mostly documentation or shape without reliable execution help. |

## Rubric Table

| Row | Category | Requirement |
|-----|----------|-------------|
| A01 | Working-set reduction | Bounded context packet exists. |
| A02 | Working-set reduction | Context discovery is deterministic. |
| A03 | Working-set reduction | Wiki retrieval is bounded and citation-bearing. |
| A04 | Working-set reduction | Prompt injection stays compact. |
| B05 | Durable continuation | Task state survives compaction and interruption. |
| B06 | Durable continuation | Plan progress is machine-readable. |
| B07 | Durable continuation | Workflow SOT prevents premature final answers. |
| B08 | Durable continuation | State writes are safe under concurrency. |
| C09 | Tool-use reliability | Tool-call conformance is measurable offline. |
| C10 | Tool-use reliability | Tool output is budgeted at the OpenCode bridge. |
| C11 | Tool-use reliability | Tool surface is narrowed before action. |
| C12 | Tool-use reliability | Runtime modes prevent accidental delegation. |
| D13 | Evidence and anti-hallucination | Claims require citations or evidence refs. |
| D14 | Evidence and anti-hallucination | Replay catches deterministic behavior drift. |
| D15 | Evidence and anti-hallucination | Artifact and Mermaid outputs are validated. |
| E16 | Delegation and rate recovery | Public jobs are compact packets, not raw task dumps. |
| E17 | Delegation and rate recovery | Rate limit recovery is explicit. |
| E18 | Delegation and rate recovery | Delegation is routed by task type. |
| F19 | Benchmark alignment | Repeated-trial reliability is tracked. |
| F20 | Benchmark alignment | Freshness and contamination are controlled. |
| F21 | Benchmark alignment | Format sensitivity is tested. |
| F22 | Benchmark alignment | Terminal execution is measured by final state. |

## Load Factors

The evaluator accepts these load-factor kinds: `skill`, `command`, `tool`, `prompt`, `file_write`, `provider_call`, `context`, `recovery`, and `evidence`.

| Kind | Factor ids | Thresholds |
|------|------------|------------|
| `skill` | `skill_overload` | Loaded skill references must be narrowed before action. |
| `command` | `command_output_overload` | Output above 8000 chars must be rerun with focused readback. |
| `tool` | `tool_surface_overload` | More than 40 visible tools is a warning; more than 88 is a failure. |
| `prompt` | `prompt_over_budget` | More than 6000 chars is a warning; more than 12000 is a failure. |
| `file_write` | `file_write_too_large` | Write chunks above 2000 chars fail. |
| `provider_call` | `provider_call_attempted` | Any provider execution attempt fails; threshold is 0. |
| `context` | `context_split_required`, `stale_context` | Split-required context fails; stale context warns until refreshed. |
| `recovery` | `missing_recovery_state`, `blocked_reason_missing`, `resume_entry_missing`, `retry_policy_missing` | Missing checkpoint, resume entry, retry policy, or blocked reason fails. |
| `evidence` | `missing_evidence_ref` | Required evidence refs must be present; missing evidence fails. |

`blockedReasons` is the sorted unique set of human-readable reasons a run cannot be trusted yet. `fixPaths` is the sorted remediation list. Each fix path names a Tiny-Chu tool and a concrete next command, for example `context_packet` with "regenerate a bounded context packet with maxChars 6000" or `chunked_write_plan` with "split the generated artifact into sub-2000 character chunks".

## CLI And Evidence

Build first when `dist/` may be stale:

```bash
npm run build
```

Healthy fixture:

```bash
node scripts/evaluate-small-model-contribution.mjs --fixture test/fixtures/small-model-contribution/healthy.json --out .omo/evidence/small-model-contribution-eval/healthy.json
```

Load-risk fixture, allowing the expected failing score to be recorded:

```bash
node scripts/evaluate-small-model-contribution.mjs --fixture test/fixtures/small-model-contribution/load-risk.json --out .omo/evidence/small-model-contribution-eval/load-risk.json --allow-fail
```

Evidence directory: `.omo/evidence/small-model-contribution-eval/`.

The CLI prints `status=<status> normalizedScore=<n> band=<band> blockedReasons=<count>` and writes stable pretty JSON. It exits nonzero on failing evaluations unless `--allow-fail` is present.

## Operating Rules

Memory substitute rules:

- Use `task_checkpoint`, `resume_packet`, `task_focus_packet`, and `public_job_resume_packet` as the durable memory substitute.
- Do not rely on conversational memory after compaction, interruption, or a failed long command.
- Treat `.omo/evidence/` artifact paths as the proof ledger, not as trusted truth until the command is rerun or read back.

Compact prompt/write rules:

- Use `context_packet` and `context_budget_simulation` before sending large project context.
- Keep prompt payloads below 6000 chars when possible; split before 12000 chars.
- Use `chunked_write_plan` before medium or large Markdown writes; keep chunks under 2000 chars.
- Prefer focused `rg`, exact `sed` ranges, and bounded tool inputs over whole-file or whole-report dumps.

Recovery/resume recipes:

- If evidence is missing, run `evidence_gate`, capture the failing command output under `.omo/evidence/`, then rerun the evaluator.
- If context is too large, regenerate `context_packet` with a lower `maxChars`, rerun `context_budget_simulation`, and continue from `task_focus_packet`.
- If a retry or provider-facing step is needed, call `qwen_retry_policy`, write `task_checkpoint`, then resume from the latest packet.
- If a public worker stalls, use `public_job_resume_packet`, preserve the checkpoint, and evaluate the recovered fixture before finalizing.

## Caveats And Gaps

No live Qwen caveat: this evaluator never calls Qwen, OpenAI, Ollama, or any live provider. `requestAttempted` must remain `false`; provider attempts are represented only by offline fixtures and fail with `provider_call_forbidden`.

Future live Qwen repeated-trial benchmark gap: the current score verifies deterministic fixture behavior, not repeated live Qwen success rates across fresh tasks, temperature settings, rate-limit windows, and terminal-state outcomes.
