# Tiny-Chu

Tiny-Chu는 OpenCode 스타일 에이전트 작업 흐름에 필요한 최소한의 파일 기반 오케스트레이션 기능을 제공하는 작은 TypeScript 라이브러리다. 로컬 foreman 모델이 작업 상태, 컨텍스트, 계획, public worker 큐, wiki 번들을 잃지 않도록 돕는 데 집중한다.

의도적으로 Team Mode, Hyperplan, Atlas/parallel hooks, 원본 delegate-task 엔진 같은 큰 오케스트레이션 시스템은 포함하지 않는다.

## 빠른 시작

다른 OpenCode 프로젝트에서 registry를 사용할 수 있으면 대상 프로젝트 root에서 installer를 실행한다. 이 명령은 `.opencode/package.json`, plugin shim, TUI config를 만들고 `.opencode` 안에서 `npm install`까지 실행한다.

```bash
npx tiny-chu install
```

설치 후 package entrypoint를 확인한다.

```bash
node --input-type=module -e "import { createTinyChuPlugin } from 'tiny-chu'; console.log(typeof createTinyChuPlugin)"
node --input-type=module -e "import { TinyChuOpenCodePlugin } from 'tiny-chu/opencode'; console.log(typeof TinyChuOpenCodePlugin)"
node --input-type=module -e "const m = await import('tiny-chu/tui'); console.log(m.default.id, typeof m.default.tui)"
```

저장소를 개발 환경에서 확인할 때는 아래 두 명령을 먼저 실행한다.

```bash
npm run build
npm test
```

폐쇄망, 내부 registry, developer local checkout 경로를 선택해야 한다면 설치 절차의 canonical source인 [INSTALL.md](./INSTALL.md)를 따른다. 운영 사용법과 작은 모델 운용 흐름은 [HOW_TO_USE.md](./HOW_TO_USE.md)를 참고한다. 내부 구조와 설계 배경은 [docs/architecture/README.md](./docs/architecture/README.md)에 모여 있다.

기여와 운영 거버넌스는 [CONTRIBUTING.md](./CONTRIBUTING.md), [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), [SECURITY.md](./SECURITY.md), [CHANGELOG.md](./CHANGELOG.md)를 기준으로 한다. `docs/` 아래에서 이력을 찾는 경우 [docs/HISTORY.md](./docs/HISTORY.md)를 입구로 사용한다. `.github/`와 `.idea/`는 개인/호스트별 메타데이터로 취급해 Git 추적 대상에서 제외한다.

계획이나 리서치는 진행했지만 아직 제품 기능으로 들어오지 않은 항목은 [docs/feature/2026-06-15-unimplemented-features.md](./docs/feature/2026-06-15-unimplemented-features.md)에 별도로 정리한다.

## 라이선스

Tiny-Chu는 `Apache-2.0` 라이선스로 배포된다. 전체 라이선스 문구는 [LICENSE](./LICENSE)를 확인한다.

## 범위

Tiny-Chu가 제공하는 핵심 기능은 아래와 같다.

- 가장 가까운 `AGENTS.md`와 프로젝트 규칙 파일을 모아 컨텍스트 번들을 만든다.
- `.tiny/tasks/*.json`에 작업 상태와 checkpoint를 저장한다.
- `.tiny/plans/*.md`의 Markdown checkbox 계획을 읽어 이어서 실행할 상태를 판단한다.
- `.tiny/workflows/runs/*.json`을 workflow JSON source of truth로 사용한다.
- `.tiny/workflows/reports/**/*.md`에 단계별 workflow report projection을 저장한다.
- `.tiny/public-jobs/*.json`에 public worker용 큐 패킷을 저장한다.
- `.tiny/wiki/index.json`을 기준으로 canonical wiki 문서를 선택하고 번들링한다.
- `createTinyChuPlugin()`으로 `task_*`, `public_*`, `context_bundle`, `wiki_bundle`, workflow, evidence, doctor 계열 도구를 노출한다.

## 최소 라이브러리 사용

```ts
import { createTinyChuPlugin } from "tiny-chu";

const tiny = createTinyChuPlugin({
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

## OpenCode 적용

이 저장소는 프로젝트 로컬 OpenCode plugin shim과 TUI dashboard 설정을 포함한다.

```text
.opencode/
  package.json
  tui.json
  plugins/
    tiny-chu.ts
    tiny-chu-tui.ts
```

서버 shim은 TypeScript plugin adapter를 직접 export한다.

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "../../src/opencode/plugin.ts";
```

TUI shim은 dashboard plugin을 export한다.

```ts
export { default } from "../../src/opencode/tui-plugin.ts";
```

이 저장소 루트에서 OpenCode를 실행하면 `.opencode/plugins/tiny-chu.ts`가 Tiny-Chu 도구를 활성화한다. `.opencode/tui.json`은 `.opencode/plugins/tiny-chu-tui.ts`를 켜고, TUI plugin은 `home_logo`를 `TinyChu`로 두며 `home_prompt_right`, `sidebar_title`, `sidebar_content`, `sidebar_footer`, `home_bottom`에 task, workflow, public job, context/evidence, health 상태를 표시한다.

다른 프로젝트에는 `templates/opencode/`를 복사하거나 [INSTALL.md](./INSTALL.md)의 단계별 절차를 따른다. 폐쇄망 운영 설치는 offline bundle과 `.opencode/vendor/`의 local tarball dependency를 사용한다. developer local checkout은 Tiny-Chu 자체 개발이나 로컬 소스 검증에만 쓴다.

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "tiny-chu": "file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz"
  }
}
```

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "tiny-chu/opencode";
```

TUI dashboard를 켤 때는 `.opencode/tui.json`과 TUI shim을 함께 둔다.

```json
{
  "plugin": ["./plugins/tiny-chu-tui.ts"]
}
```

```ts
export { default } from "tiny-chu/tui";
```

Dashboard는 OpenCode-visible `dashboard_snapshot` 도구가 만든다. 이 도구는 기존 `.tiny` task, public job, workflow, evidence, context 상태를 읽어 보여주며 별도 dashboard state store를 만들지 않는다. provider/network preflight는 기본값에서 실행하지 않고 `includeProviderPreflight`가 명시된 경우에만 수행한다.

## 직접 의존성과 버전 추적

Tiny-Chu의 직접 런타임 의존성은 세 개다.

- `@opencode-ai/plugin`: OpenCode plugin bridge와 `tiny-chu/opencode` export를 위한 런타임 의존성이다. 현재 `package.json` range는 `^1.17.4`이고, `package-lock.json`은 현재 설치 해석을 별도로 고정한다.
- `@opentui/solid`: `tiny-chu/tui` export와 TUI dashboard runtime을 위한 런타임 의존성이다.
- `typescript`: root export의 `extractNamingSymbols()`가 TypeScript compiler API로 source symbol을 읽기 때문에 package import 시 함께 설치되어야 하는 런타임 의존성이다.

문서에 registry 최신값을 적을 때는 range나 lockfile resolution과 혼동하지 않는다. 예를 들어 `npm view @opencode-ai/plugin version --json` 결과는 `1.17.7`로 observed as of 2026-06-16이지만, 이것은 현재 `package.json`의 `^1.17.4` range나 `package-lock.json` resolution을 자동으로 바꾼다는 뜻이 아니다.

최신값을 갱신할 때는 아래 명령을 다시 실행하고, 문서에는 항상 `observed as of YYYY-MM-DD` 날짜와 refresh command를 함께 남긴다.

```bash
npm view @opencode-ai/plugin version --json
npm view @opencode-ai/plugin@1.17.7 peerDependencies dependencies version --json
```

## 설치 확인

설치 후 대상 프로젝트의 `.opencode`에서 package import와 install-check를 확인한다.

```bash
node --input-type=module -e "import { createTinyChuPlugin } from 'tiny-chu'; console.log(typeof createTinyChuPlugin)"
node --input-type=module -e "import { TinyChuOpenCodePlugin } from 'tiny-chu/opencode'; console.log(typeof TinyChuOpenCodePlugin)"
node --input-type=module -e "const m = await import('tiny-chu/tui'); console.log(m.default.id, typeof m.default.tui)"
node --input-type=module -e "import { createTinyChuPlugin } from 'tiny-chu'; const tiny=createTinyChuPlugin({ root: process.cwd() }); console.log(await tiny.tools.tiny_chu_install_check({}));"
```

첫 두 명령의 기대값은 `function`이다. TUI 명령은 `tiny-chu.logo function`을 출력해야 한다. `tiny_chu_install_check` 결과에는 OpenCode tool 노출 상태, package metadata, `dashboard_snapshot` 포함 여부가 드러난다.

## Runtime mode

Tiny-Chu runtime mode는 OpenCode의 top-level mode object가 아니라 Tiny-Chu plugin option으로 고른다. mode 1은 worker-only이고 mode 2는 기존 orchestrator + worker surface이며 기본값이다.

```json
{
  "plugin": [["tiny-chu", { "mode": 1 }]]
}
```

```json
{
  "plugin": [["tiny-chu", { "mode": 2 }]]
}
```

로컬 shim에서는 OpenCode options를 보존하면서 Tiny-Chu adapter에 mode를 고정할 수 있다.

```ts
export const TinyChu = (input, options) =>
  TinyChuOpenCodePlugin(input, { ...options, mode: 1 });
```

라이브러리 직접 구성은 이름 기반 mode도 받는다.

```ts
createTinyChuPlugin({ mode: "worker" });
createTinyChuPlugin({ mode: "orchestrator_worker" });
```

## 안전한 소스 도구

기본 registry는 그대로 둔다. 작은 모델이 소스 파일을 직접 덮어쓰지 못하게 하고 싶을 때만 `safeTooling`과 `nativePreviews`를 켠다.

```ts
const tiny = createTinyChuPlugin({
  root: process.cwd(),
  safeTooling: true,
  nativePreviews: true,
});
```

`safeTooling: true`는 `safe_patch_check`, `safe_patch_apply`, `artifact_workspace_prepare`, `artifact_workspace_commit`, `artifact_publish_manifest`, `artifact_publish_apply`, `powershell_toolchain_probe`, `run_diagnostics`를 추가한다.

`safeTooling: true`와 `nativePreviews: true`를 함께 켜면 `structural_search_ast`, `structural_rewrite_preview`, `json_yaml_transform_preview`, `json_patch_preview`도 추가된다. 이 preview 도구들은 `ast-grep`, `jq`, Mike Farah `yq`, `jd` 같은 native executable을 선택적으로 사용한다. 실행 파일이 없으면 unavailable/degraded 결과를 반환하고 npm dependency로 자동 추가하지 않는다.

안전한 edit 순서는 다음과 같다.

1. patch를 만들거나 preview 도구로 변경 후보를 확인한다.
2. `safe_patch_check`로 대상 파일, allowlist, 현재 `sha256:<hex>` expected hash를 검증한다.
3. 검증된 patch만 `safe_patch_apply`로 적용한다.
4. 생성 문서와 report는 `artifact_workspace_prepare`의 격리 workspace에서 만들고, 필요하면 `artifact_workspace_commit`으로 그 workspace 내부에서만 commit한다.
5. source repo에 publish할 때는 `artifact_publish_manifest`와 `artifact_publish_apply`를 사용한다.

`run_diagnostics`는 advisory tool이며 mutation gate가 아니다. 기본 확인 순서는 `npm run build`, `npm test`다.

## OpenCode 도구 표면

OpenCode plugin은 task, public job, context, wiki, workflow, evidence, doctor, UX reverse, safe tooling 계열 도구를 노출한다. 대표적인 도구는 아래와 같다.

- `task_create`, `task_get`, `task_list`, `task_update`, `task_checkpoint`
- `public_dispatch`, `public_collect`, `public_checkpoint`, `public_retry`, `public_cancel`, `public_complete`, `public_job_resume_packet`
- `context_bundle`, `context_packet`, `context_digest`, `code_context_scan`, `repo_map`, `business_logic_map`, `wiki_bundle`, `wiki_search`, `wiki_context`
- `naming_lookup`, `naming_propose`, `naming_context`, `naming_add`
- `doctor`, `session_preflight`, `task_focus_packet`, `powershell_command_guard`, `tiny_chu_install_check`
- `dashboard_snapshot`, `rules_snapshot`, `project_snapshot`, `docs_consistency_check`, `provider_endpoint_preflight`, `tool_call_conformance_probe`, `context_budget_simulation`, `evidence_gate`, `small_model_replay`
- `analysis_workflow_start`, `workflow_create`, `workflow_status`, `workflow_checkpoint`, `workflow_close`, `workflow_audit`, `workflow_resume_packet`, `workflow_packet_fit_check`, `workflow_next`, `workflow_progress_heartbeat`, `workflow_sot_audit`
- `ui_layout_catalog`, `ux_rationale_trace`, `ux_validation_matrix`, `layout_truth_update`, `layout_truth_verify`, `layout_truth_report`, `ux_reverse_report`
- `orchestration_profile`, `artifact_format_template`, `artifact_check`, `mermaid_check`, `mermaid_fix`

정확한 현재 노출 목록은 실행 중인 package registry와 `tiny_chu_install_check` 결과를 기준으로 확인한다.

LLM wiki retrieval은 `wiki_bundle`의 기존 full bundle 계약을 유지하면서 `wiki_search`/`wiki_context`를 citation-bearing bounded evidence 계약으로 분리한다. `code_context_scan`은 `@TC:NOTE`, `@TC:WARN`, `@TC:ANCHOR`, `@TC:TODO`, `@TC:REASON`과 호환 `@MX:` 태그를 읽어 `evidenceKind: "navigation_hint"`만 반환한다. Registry parity는 기본 99개 tool 기준으로 확인한다. `public_dispatch.wikiRefs`는 metadata only 경계로 유지하며, `context_packet`이나 `transformUserMessage`가 automatic full-wiki injection을 수행한다고 문서화하지 않는다.

Naming dictionary 도구는 새 변수, 함수, 메소드, 상수, tool 이름을 만들기 전에 `naming_context` 또는 `naming_lookup`으로 canonical spelling과 blocked variant를 확인하고, 후보가 있으면 `naming_propose`로 진단을 본 뒤 `naming_add`로 `.tiny/naming/events.jsonl`에 proposal event만 남긴다. `naming_add`는 `docs/naming/dictionary.json`을 직접 수정하지 않는다.

### Git weekly reports

`git_weekly_report`는 OpenCode-visible Tiny-Chu tool이다. 선택한 `ref`에서 접근 가능한 최근 5 business days의 로컬 Git activity를 요약해 `.tiny/reports/git-weekly` 아래에 report, evidence, QA, index, audit artifact를 쓴다.

이 tool은 로컬 Git history를 읽는다. remote push, pull request, review, CI, deployment, branch protection 상태를 증명하지 않는다. 기본 입력은 `repoPath: "."`, `ref: "HEAD"`, `businessDays: 5`, `reportMode: "summary_only"`, `includePatches: false`다.

## Feature package 구조

OpenCode tool 목록은 내부 `TinyFeaturePackage` descriptor에서 compose된다. `createTinyChuPlugin().registry`가 direct tools, OpenCode tool specs, package ownership metadata, install-check diagnostics, permission hints, small-model hints, resources, instructions의 단일 기준이다.

기본 package graph는 dependency-topological order로 구성되며 다음 package id를 포함한다.

- `tiny-chu.core-runtime`
- `tiny-chu.public-worker-queue`
- `tiny-chu.shared-support`
- `tiny-chu.legacy-analysis`
- `tiny-chu.extension-utilities`
- `tiny-chu.button-workflow-hardening`
- `tiny-chu.button-workflow-dispatch`
- `tiny-chu.small-model-resilience`
- `tiny-chu.project-governance`
- `tiny-chu.workflow-orchestration`
- `tiny-chu.ux-reverse-engineering`
- `tiny-chu.doctor-artifacts`
- `tiny-chu.host-opencode`
- `tiny-chu.host-mcp`

새 기능을 추가할 때는 `src/opencode/feature-packages/` 아래 descriptor와 tool seed를 바꾸고, composer/parity 테스트와 기능 테스트를 함께 갱신한다. `tiny-plugin.ts`, `plugin.ts`, `install-check.ts`의 병렬 목록을 각각 손으로 맞추는 방식은 피한다.

## Workflow orchestration

작은 foreman 모델이 저장소 분석을 시작할 때는 `analysis_workflow_start`가 Tiny-Chu task와 `analysis` workflow run을 만든다. 직접 workflow를 만들 때는 `workflow_create` 또는 library helper `createWorkflow`를 사용한다.

Workflow run JSON은 `.tiny/workflows/runs/<runId>.json`에 저장되며 source of truth다. `.tiny/plans/`와 `.tiny/workflows/reports/`의 Markdown은 사람과 재진입 prompt를 위한 projection이다.

대표 실행 순서는 다음과 같다.

1. `analysis_workflow_start({ objective, targetPath, workerAgent })`
2. `provider_endpoint_preflight({ endpoint, networkMode: "disabled" })`
3. `tool_call_conformance_probe({ fixture, allowedTools })`
4. `context_budget_simulation({ model, packets, maxContextTokens })`
5. `workflow_packet_fit_check({ packet, workerAgent })`
6. `workflow_next({ runId, workerAgent })`
7. `workflow_checkpoint({ runId, nodeId, summary, evidenceRefs, nextSteps, status: "done" })`
8. `workflow_progress_heartbeat({ runId })`
9. `workflow_audit({ runId })`
10. `evidence_gate({ required, checks })`
11. `workflow_sot_audit({ runId, finalResponse, evidenceGate })`
12. `workflow_close({ runId, evidenceGate, summary })`

각 단계는 `workflow_checkpoint(..., status: "done")`으로 멈춘 뒤 다음 packet을 요청한다. 중단이나 compaction 뒤에는 `workflow_resume_packet`을 먼저 호출하고 `workflow_next`로 이어간다.

## 안정성 및 상태 레이아웃

파일 기반 경계는 configured root 안으로 제한한다. wiki ref나 `git_weekly_report.repoPath`처럼 사용자가 지정한 path가 real path 기준으로 root 밖이면 fail closed한다. `.tiny/tasks/*.json`과 `.tiny/public-jobs/*.json`이 malformed JSON이면 정상 runtime API는 `Malformed JSON in <path>` 오류로 실패한다.

Tiny-Chu는 `.tiny/locks/` 아래 directory-based advisory lock을 사용해 주요 상태 writer를 cross-process로 직렬화한다. lock은 `owner.json`에 `lockId`, `pid`, `hostname`, `createdAt`, `renewedAt`, `expiresAt` lease metadata를 쓰고, 기본값은 stale 30초, timeout 10초, poll 25ms, renew 5초다. 이 계약은 local filesystem advisory semantics에 한정되며 NFS/분산 파일시스템 안전성을 주장하지 않는다.

잠금이 적용되는 writer:

- task create/update/checkpoint (`tasks-create.lock`, `task-<taskId>.lock`)
- public job create/lifecycle update (`public-jobs-create.lock`, `public-job-<jobId>.lock`)
- workflow create/checkpoint와 `.tiny/plans/<runId>.md` projection (`workflows-create.lock`, `workflow-<runId>.lock`, `plan-<hash>.lock`)
- wiki index write/upsert (`wiki-index.lock`)
- safe-tooling apply/publish gate (`safe-tooling.lock`, contention은 기존처럼 `locked` diagnostic으로 반환)

의도적으로 잠그지 않는 writer도 있다. git weekly report, rules snapshot, layout truth, wiki error book JSONL, generic markdown write는 현재 cross-process serialized state surface가 아니므로 별도 제품 계약으로 다룬다.

```text
.tiny/
  artifacts/
  locks/
  plans/
  public-jobs/
  rules/
  tasks/
  wiki/
    index.json
  workflows/
    reports/
    runs/
```

성능 검증은 SLA가 아니라 characterization baseline이다. 관찰 artifact가 필요하면 deterministic fixture count와 elapsed milliseconds를 기록하는 스크립트를 실행한다.

```bash
node scripts/stability-performance-baseline.mjs --out .omo/evidence/stability-performance-baseline.json
node scripts/stability-performance-baseline.mjs --section scanners --out .omo/evidence/scanner-performance-baseline.json
```

## PowerShell 런타임

`createTinyChuPlugin()`은 OpenCode session이 PowerShell runtime을 사용해야 한다는 설정을 노출한다. 소비자는 `POWERSHELL_OPENCODE_RUNTIME`을 확인하거나 OpenCode 설정에 전달할 수 있다.

```ts
import { POWERSHELL_OPENCODE_RUNTIME, createTinyChuPlugin } from "tiny-chu";

const tiny = createTinyChuPlugin();

console.log(tiny.opencode.shell);
console.log(POWERSHELL_OPENCODE_RUNTIME.shell.version);
```

PowerShell에서 native tool을 실행할 때는 `$`, `{}`, `[]`, `|`가 포함된 filter, selector, regex, structural pattern을 single quote로 감싸고, 필요하면 `$PSNativeCommandArgumentPassing = 'Standard'`를 설정한다. `jq`, `yq`, `mdq`, `fd`, `ast-grep`, `rg`는 PowerShell alias가 아니라 실제 native executable을 호출해야 한다.

## 아직 구현하지 않은 기능

다음 항목은 현재 문서화된 보류 범위이며 기본 Tiny-Chu 제품 API로 제공하지 않는다. 세부 배경과 향후 검토 조건은 [docs/feature/2026-06-15-unimplemented-features.md](./docs/feature/2026-06-15-unimplemented-features.md)를 본다.

- `run_tests`
- `diff_preview`
- `js_ts_codemod_preview`
- `merge_preview`
- `semantic_diff_preview`
- `delta`
- `difftastic`
- `mergiraf`
- `dynamic package discovery`
- `npm subpackage loading`
- `MCP HTTP/SSE transports and registry publish`
- `Figma API calls`
- `provider chat/generate/completion calls`
- `compact tool index`
- `content-aware packet fit`

예외적으로 `provider_endpoint_preflight`는 명시적으로 켜는 metadata readiness probe다. chat 또는 generation prompt를 보내 provider readiness를 증명하는 기능은 아니다.
