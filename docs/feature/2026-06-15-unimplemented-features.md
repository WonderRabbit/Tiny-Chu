# 2026-06-15 미구현 기능 인벤토리

이 문서는 계획이나 리서치 단계에서 다뤄졌지만 Tiny-Chu 제품 기능으로 들어오지 않은 항목을 보관한다. README와 설치 문서는 현재 제공 범위를 설명하고, 이 파일은 후속 검토가 필요한 보류 범위를 분리한다.

## 현재 상태

- Tiny-Chu의 기본 기능은 파일 기반 task/context/wiki/public job/workflow 상태 관리와 OpenCode plugin shell이다.
- 안전한 소스 변경 흐름은 `safeTooling`과 `nativePreviews` opt-in으로 제한된다.
- 현재 안전 도구 표면은 `safe_patch_check`, `safe_patch_apply`, `artifact_workspace_prepare`, `artifact_workspace_commit`, `artifact_publish_manifest`, `artifact_publish_apply`, `powershell_toolchain_probe`, `run_diagnostics`, `structural_search_ast`, `structural_rewrite_preview`, `json_yaml_transform_preview`, `json_patch_preview` 중심이다.
- `provider_endpoint_preflight`는 metadata readiness probe일 뿐 provider chat이나 generation prompt를 보내지 않는다.
- 여러 process가 같은 `.tiny` state를 동시에 쓰는 경우의 cross-process file locking은 호출자 쪽 직렬화가 필요하다.

## 미구현 범위

아래 항목은 2026-06-15 기준으로 제품 API나 기본 OpenCode tool surface에 넣지 않은 보류 항목이다. 각 항목은 현재 상태, 근거, 아직 구현하지 않는 범위, 향후 검토 조건을 따로 둔다.

### deferred safe/source tooling

#### `run_tests`

- 현재 상태: `run_diagnostics`가 advisory 성격으로 build/test script 순서를 제안하고 실행 결과를 보고한다.
- 근거: safe tooling seed에는 `run_diagnostics`가 있고 별도 테스트 실행 전용 seed는 없다.
- 아직 구현하지 않는 범위: 테스트 선택, 실패 재시도, coverage gate, mutation gate를 하나의 `run_tests` tool로 묶지 않았다.
- 향후 검토 조건: test runner 선택, timeout, stdout budget, 실패 artifact 경로, source mutation과의 관계가 정해질 때 재검토한다.

#### `diff_preview`

- 현재 상태: patch preview는 호출자가 만들고 `safe_patch_check`가 allowlist와 hash를 검증한다.
- 근거: native diff executable 계약이 현재 tool seed와 install-check metadata에 없다.
- 아직 구현하지 않는 범위: staged/unstaged diff preview, side-by-side diff, binary diff 제외 규칙을 제품 tool로 두지 않았다.
- 향후 검토 조건: PowerShell-safe invocation, deterministic output, large diff truncation, source path confinement 기준을 정한 뒤 검토한다.

#### `js_ts_codemod_preview`

- 현재 상태: TypeScript/JavaScript 구조 탐색은 `structural_search_ast`와 `structural_rewrite_preview` preview로 제한된다.
- 근거: 현재 native preview 범위는 `ast-grep`, `jq`, `yq`, `jd` 중심이다.
- 아직 구현하지 않는 범위: jscodeshift, ts-morph, Babel codemod 같은 JS/TS 전용 codemod preview adapter를 두지 않았다.
- 향후 검토 조건: parser version, formatting strategy, dry-run output, rollback path를 테스트로 고정할 수 있을 때 재검토한다.

#### `merge_preview`

- 현재 상태: Tiny-Chu는 source mutation을 hash-checked patch apply와 artifact publish 경로로 제한한다.
- 근거: merge conflict model, index state, worktree stage 상태를 다루는 handler가 없다.
- 아직 구현하지 않는 범위: branch merge preview, conflict hunk classification, merge result apply gate를 제품 tool로 묶지 않았다.
- 향후 검토 조건: git index 격리, conflict marker detection, rollback, 사용자 승인 흐름이 정리되면 검토한다.

#### `semantic_diff_preview`

- 현재 상태: AST 검색과 rewrite preview는 있으나 의미 기반 diff 결과를 표준 schema로 내지 않는다.
- 근거: docs와 seed 모두 semantic diff 전용 output contract를 정의하지 않는다.
- 아직 구현하지 않는 범위: symbol rename, import graph 영향, type-aware diff를 독립 tool로 제공하지 않는다.
- 향후 검토 조건: language별 LSP/AST backend와 false positive 처리 기준을 정한 뒤 검토한다.

#### `delta`

- 현재 상태: PowerShell/native tooling guide에는 주로 `jq`, `yq`, `mdq`, `fd`, `ast-grep`, `rg`가 잡혀 있다.
- 근거: `delta`는 current install-check native tool 목록과 preview seed에 없다.
- 아직 구현하지 않는 범위: `delta`를 diff renderer나 required native executable로 넣지 않았다.
- 향후 검토 조건: optional renderer로 둘지, CI 없는 로컬 환경에서 degraded 처리할지 결정한 뒤 검토한다.

#### `difftastic`

- 현재 상태: 구조 diff 후보로 리서치됐지만 current registry나 install-check 표면에는 없다.
- 근거: safe tooling 문서는 `difftastic` binary 존재를 전제로 하지 않는다.
- 아직 구현하지 않는 범위: `difftastic` 기반 syntax-aware diff preview를 제품 tool로 두지 않았다.
- 향후 검토 조건: language coverage, output parsing 안정성, missing binary behavior를 검증한 뒤 검토한다.

#### `mergiraf`

- 현재 상태: merge 보조 native executable 후보로만 남아 있다.
- 근거: current merge workflow나 safe tooling mutation gate에 `mergiraf` 호출이 없다.
- 아직 구현하지 않는 범위: `mergiraf` 기반 merge preview 또는 conflict resolution apply를 넣지 않았다.
- 향후 검토 조건: conflict resolution 책임, git index 격리, 사용자 확인 UX가 명확해지면 검토한다.

### package/plugin expansion

#### `dynamic package discovery`

- 현재 상태: package graph는 내부 `TinyFeaturePackage` descriptor compose로 고정한다.
- 근거: README와 architecture 문서는 default package graph를 dependency-topological order로 구성한다고 설명한다.
- 아직 구현하지 않는 범위: runtime에서 외부 package descriptor를 자동 발견하거나 로드하지 않는다.
- 향후 검토 조건: package trust boundary, duplicate tool conflict, version compatibility, install-check metadata를 정의하면 검토한다.

#### `npm subpackage loading`

- 현재 상태: OpenCode shim은 `tiny-chu/opencode`와 `tiny-chu/tui` package subpath를 정적으로 import한다.
- 근거: 설치 문서는 local tarball dependency와 project-local shim을 기준으로 한다.
- 아직 구현하지 않는 범위: runtime에서 npm subpackage를 찾아 feature package로 attach하지 않는다.
- 향후 검토 조건: offline bundle packaging, dependency pinning, ESM loading failure isolation이 정리되면 검토한다.

#### `runtime disabling of default feature packages`

- 현재 상태: mode 1/2는 tool surface를 제한하지만 default feature package graph 자체를 임의로 끄는 기능은 아니다.
- 근거: registry composer는 duplicate, missing dependency, cycle을 검증한 뒤 default graph를 만든다.
- 아직 구현하지 않는 범위: 사용자가 runtime option으로 default package 일부를 disable하는 기능을 두지 않았다.
- 향후 검토 조건: dependency closure, hidden tool diagnostics, install-check expectation, backward compatibility를 테스트로 고정하면 검토한다.

### external adapter boundaries

#### `MCP server adapters`

- 현재 상태: Tiny-Chu는 OpenCode plugin tool surface를 제공하며 별도 MCP server adapter를 만들지 않는다.
- 근거: 현재 설치 문서는 `.opencode/plugins/` shim과 package subpath import를 기준으로 한다.
- 아직 구현하지 않는 범위: MCP server lifecycle, schema export, auth, transport 설정을 제품 기능으로 묶지 않았다.
- 향후 검토 조건: host별 adapter boundary, security model, offline behavior, schema drift 검증이 준비되면 검토한다.

#### `Figma API calls`

- 현재 상태: UX reverse 흐름은 mapping key를 남길 수 있지만 Figma token을 읽거나 API를 호출하지 않는다.
- 근거: HOW_TO_USE는 Figma를 adapter-ready JSON 경계로만 설명한다.
- 아직 구현하지 않는 범위: Figma file/node fetch, variable read, token handling, rate limit 처리를 넣지 않았다.
- 향후 검토 조건: credential storage, network mode, cached evidence, layout truth와의 충돌 해결 기준이 정해지면 검토한다.

### provider/network behavior

#### `provider chat/generate/completion calls`

- 현재 상태: provider readiness는 `provider_endpoint_preflight` metadata probe로 제한한다.
- 근거: workflow sequence는 no-live-provider 검증을 기본으로 하고, prompt 전송을 readiness 증명으로 삼지 않는다.
- 아직 구현하지 않는 범위: OpenAI/Anthropic/Ollama chat, generate, completion prompt 호출을 Tiny-Chu tool로 넣지 않았다.
- 향후 검토 조건: explicit network consent, token redaction, cost controls, retry semantics, transcript evidence policy가 생기면 검토한다.

### concurrency/state hardening

#### `cross-process file locking`

- 현재 상태: 하나의 Node.js process 안에서 task id, public job id, checkpoint sequence 충돌을 피한다.
- 근거: README 안정성 계약은 여러 process 동시 write를 호출자 외부 직렬화 책임으로 둔다.
- 아직 구현하지 않는 범위: OS file lock, stale lock recovery, multi-process write serialization을 넣지 않았다.
- 향후 검토 조건: lock lifetime, crash recovery, Windows/macOS/Linux 파일 시스템 차이, partial write 복구를 검증하면 검토한다.

### small-model optimization follow-ups

#### `compact tool index`

- 현재 상태: `tiny_chu_install_check`와 registry metadata로 현재 tool/package owner를 확인한다.
- 근거: small-model 리서치에서는 축약 index 후보가 있었지만 public API 계약으로 옮기지 않았다.
- 아직 구현하지 않는 범위: 작은 모델 전용 compact tool index schema와 generation tool을 만들지 않았다.
- 향후 검토 조건: output budget, package ownership grouping, stale index detection, docs sync 테스트를 정의하면 검토한다.

#### `ULW prompt injection follow-up`

- 현재 상태: Tiny-Chu는 `transformUserMessage()`로 작은 모델용 compact operating brief와 PowerShell tooling guide를 주입한다.
- 근거: small-model audit report는 prompt injection 감소를 follow-up 후보로 기록했지만, README/HOW_TO_USE는 현재 주입 block의 범위만 설명한다.
- 아직 구현하지 않는 범위: ULW prompt injection을 별도 hardening feature, policy engine, 공격 fixture suite로 제품화하지 않았다.
- 향후 검토 조건: injection fixture, allowed/blocked prompt boundary, regression replay, host별 prompt merge 순서를 정의하면 검토한다.

#### `content-aware packet fit`

- 현재 상태: `workflow_packet_fit_check`는 정적 context-window 추정과 packet split을 중심으로 한다.
- 근거: workflow 문서는 `workerAgent.config.maxContextTokens` 기반 estimation을 현재 계약으로 설명한다.
- 아직 구현하지 않는 범위: packet 내용의 의미/중요도를 분석해 자동으로 재배열하거나 압축하는 기능을 넣지 않았다.
- 향후 검토 조건: evidence priority model, deterministic truncation, worker result quality metrics, replay tests가 준비되면 검토한다.

### documentation/operations follow-ups

#### `long-running command recovery guide follow-up`

- 현재 상태: HOW_TO_USE는 `orchestration_health`, `resume_packet`, `workflow_resume_packet`, `workflow_progress_heartbeat` 같은 복구 도구를 설명한다.
- 근거: small-model audit report는 장기 실행 command guide를 별도 follow-up 후보로 기록했지만, 현재 제품 문서는 각 도구의 사용 위치만 설명한다.
- 아직 구현하지 않는 범위: 장기 실행 명령 복구를 위한 독립 운영 가이드, checklist, 자동 진단 report를 별도 문서나 tool로 제공하지 않는다.
- 향후 검토 조건: 실패 유형 taxonomy, timeout/retry policy, evidence snapshot 흐름, 운영자 재진입 절차를 검증하면 검토한다.

## 근거

- README와 HOW_TO_USE의 phase 1 설명은 내부 `TinyFeaturePackage` descriptor compose와 고정된 default package graph를 기준으로 한다.
- 안전 도구 범위는 `SAFE_TOOLING_TOOLS`와 `NATIVE_PREVIEW_TOOLS` seed에 묶여 있으며, native executable이 없을 때 unavailable/degraded 결과를 반환하는 방식이다.
- architecture 문서는 `requiredRuntime` 같은 package metadata가 advisory 성격이며 host enforcement나 runtime package disabling과 다르다고 설명한다.
- small-model 관련 리서치 문서에는 `compact tool index`, `content-aware packet fit`, prompt-injection 감소 같은 후보가 있지만 현재 public API 계약으로 옮기지 않았다.

## 향후 검토 조건

- 제품 code path, OpenCode tool spec, install-check metadata, 문서, 테스트가 같은 이름과 동작 계약을 공유해야 한다.
- 보류 항목을 제품 기능으로 승격할 때는 `src/opencode/feature-packages/` descriptor, focused tests, registry parity test, README/HOW_TO_USE/INSTALL 관련 문서를 함께 갱신한다.
- native executable 기반 기능은 PowerShell quoting, missing binary degraded behavior, deterministic output, source mutation gate를 먼저 정의해야 한다.
- provider나 MCP/Figma 같은 외부 연동은 token handling, network mode, failure isolation, no-live-provider 검증 경로를 명확히 한 뒤에만 검토한다.
- cross-process state mutation은 lock lifetime, stale lock recovery, partial write 복구, Windows/macOS/Linux 파일 시스템 차이를 검증할 때까지 보류한다.
