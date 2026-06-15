# 07. 안정성 및 성능 계약

> 이 문서의 계약들은 취향이 아니라 **짐을 지는(load-bearing) 불변 조건**입니다. 어기면 시스템이 깨지거나, 증거 없는 결론이 흘러나오거나, 다중 사용자 환경에서 충돌합니다. 경계/루트 제약 로직을 변경하면 `*-hardening.test.mjs`와 `architecture-boundary.test.mjs`가 이를 강제합니다.

## 1. 루트 제약 계약 (fail-closed)

이것이 Tiny-Chu 보안의 핵심입니다. [06-state-layer.md](./06-state-layer.md)에서 메커니즘을 봤습니다; 여기서는 **왜 이것이 짐을 지는지**를 다룹니다.

### 불변 조건
> 명시적 사용자/인덱스 경로가 실제 경로에서 설정된 root를 벗어나면 **fail-closed** 합니다. 조용히 다른 경로로 우회하지 않고, 예외를 던지거나 `undefined`를 반환합니다.

### 적용 지점
| 입력 | 동작 |
|------|------|
| `wiki_bundle` refs | root 밖 → 제외/거부 |
| `git_weekly_report.repoPath` | root 밖 → 거부 |
| 마크다운 툴(`mermaid_check`/`fix`, `artifact_check`)의 `path` | root 밖 → 거부 |
| `context_bundle` targetPath | root 밖 → 컨텍스트 제외 |
| `atomic_markdown_write`/`write_loop_guard` 경로 | root 밖 → 거부 |

### 심볼릭 링크 정책
- **root 바깥을 가리키는 심볼릭 링크** → 건너뜀 (위험)
- **root 안쪽을 가리키는 심볼릭 링크** → 허용

이중 검사(어휘적 `resolvePathInsideRoot` + 실제 `resolveExistingPathInsideRoot`)가 심볼릭 링크 통한 탈출을 막습니다. `realpath()` 해결 후 다시 `isSafeRelative` 검사하기 때문입니다.

### 왜 fail-closed인가
대안인 "조용히 무시/수정/격리"는 위험합니다:
- 잘못된 상태를 숨기면 디버깅이 불가능
- 자동 복구는 데이터 손실로 이어질 수 있음
- 보안 경계 위반이 조용히 넘어가면 신뢰 붕괴

명시적 실패가 안전합니다.

## 2. JSON 무결성 계약

CLAUDE.md의 명시적 계약:

> 잘못된 형식의 런타임 JSON (`.tiny/tasks/*.json`, `.tiny/public-jobs/*.json`)은 `Malformed JSON in <path>`를 던집니다 — 조용히 건너뛰거나, 다시 쓰거나, 격리하지 않습니다.

| 상황 | 동작 |
|------|------|
| 파일 없음 (`ENOENT`) | 폴백 반환 (정상) |
| 파일 있음, JSON 유효 | 파싱 결과 반환 |
| 파일 있음, JSON 깨짐 | `MalformedJsonError` throw |
| JSONL 한 줄 깨짐 | `Malformed JSONL in <file> at line N` throw |

이 계약은 **정상 런타임 API가 결함 상태를 숨기지 않음**을 보장합니다. 외부 도구가 손상시킨 상태를 우연히 "수정"해버리는 일이 없습니다.

## 3. 결정론적 출력 계약

CLAUDE.md의 작성 규칙:

> 목록 스캔과 인덱스 직렬화는 정렬된 상태로 유지하세요 — 여러 테스트가 정확한 순서와 정확한 JSON 형태를 단언(assert)합니다.

### 적용 사례
| 코드 | 정렬 보장 |
|------|----------|
| `topologicalOrder()` | `ready`/`dependents`를 항상 `.sort()` (`feature-package-order.ts:62,68,73`) |
| `composeOrderedRegistry` | `nativeToolNames: [...set].sort()` (`feature-package.ts:88`) |
| `compactValue` (출력 예산) | 객체 키를 `Object.keys().sort()` (`output-budget.ts:37`) |
| `PublicDispatcher.list()` | `createdAt.localeCompare` 정렬 (`public-job.ts:175`) |
| `writeJsonAtomic` | 동일 입력 → 동일 직렬화 (2-space, 끝 `\n`) |
| `createTinyChuInstallCheck` | `[...toolNames].sort()`, `[...nativeToolNames].sort()` (`install-check.ts:25,27`) |

이 결정성이 테스트가 **정확한 JSON 문자열**을 단언할 수 있게 하고, 위상 정렬이 입력에 대해 결정론적이게 만듭니다.

> **주의**: `compactValue`가 객체를 순회할 때 키를 정렬하지만, **배열 순서는 보존**합니다 (슬라이스만). 따라서 배열의 의미 있는 순서(예: 위상 정렬 결과)는 유지됩니다.

## 4. 충돌 회피 계약 (단일 프로세스)

CLAUDE.md의 명시적 한계:

> 교차 프로세스 파일 잠금 없음. task/public-job/checkpoint id는 하나의 Node 프로세스 내에서만 충돌에 강합니다.

### 단일 프로세스 내 보장
- **task ID 시퀀스** — 모듈 카운터 기반, 프로세스 내 고유
- **public job ID** — `nextJobSequence` + 타임스탬프 (`J-<ISO>-<seq36>`)
- **임시 파일** — PID + UUID로 다중 동시 쓰기 충돌 회피 (`writeJsonAtomic`)

### 단일 프로세스 한계
- `nextJobSequence`는 모듈 변수 → 두 프로세스가 같은 시퀀스 할당 가능
- OS 수준 파일 잠금 없음 → 같은 파일 동시 쓰기 시 마지막 쓰기 승

### 다중 프로세스 호출자의 책임
동일 root에 여러 Node 프로세스가 접근하면:
1. 외부 조정 필요 (예: 단일 프로세스 직렬화, 분산 잠금)
2. 또는 root 분리 (프로세스별 다른 `.tiny/`)

Tiny-Chu 자체는 다중 프로세스 안전성을 제공하지 않습니다.

## 5. 출력 예산 계약

[05-plugin-and-hooks.md](./05-plugin-and-hooks.md)에서 메커니즘을 봤습니다. 계약 관점:

| 경로 | 예산 적용 |
|------|----------|
| 직접 API (`tiny.tools[name]`) | **없음** — 완전한 구조화 객체 |
| OpenCode 브리지 | **항상** — `renderBudgetedOutput()` |
| `tiny_chu_install_check` (OpenCode) | 특례: 20000자 / 200항목 |
| 그 외 OpenCode 툴 | 기본: 8000자 / 40항목 |

잘림 메타데이터(`truncated`, `omittedItems`, `fullSizeChars`, `outputSizeChars`)가 항상 `ToolResult.metadata`에 포함되므로, 호스트는 정보 손실 여부를 알 수 있습니다.

## 6. incremental_evidence_cache 정확성 계약

자주 오해되는 계약:

> `incremental_evidence_cache`는 **소스-해시 출령(staleness)만** 보고합니다 — git dirty-worktree 검사가 아닙니다. 실행자는 직접 `git status`/`git diff`를 실행해야 합니다.

이 도구는 "이 증거 파일이 참조하는 소스가 바뀌었나"만 알려줍니다. 작업 공리가 더럽혀졌는지(dirty)는 **별개의 질문**이며, 실행자가 `git status --short`와 `git diff -- <file>`로 직접 확인해야 합니다. 이 도구를 git 상태 검사로 오용하면 안 됩니다.

## 7. 라이브 프로바이더 호출 기본 금지 계약

CLAUDE.md의 강력한 금지:

> 기본 오프라인: 오케스트레이션 프로파일, agent-model 템플릿, Figma 매핑 키, Qwen 패킷 구성은 어댑터-대비만 된(adapter-ready) 메타데이터입니다. Tiny-Chu는 기본적으로 네트워크 API 호출을 하지 않으며, `provider_endpoint_preflight`만 사용자가 `networkMode`로 허용한 경우 로컬/명시 호스트 metadata probe를 수행할 수 있습니다. `doctor` 준비 게이트는 로컬 전용입니다.

### 의미
- `orchestration_profile`의 모델 정보(`gemma4-small`, `qwen3.6-35b-a3b`) — 메타데이터, 실제 호출 없음
- `qwen_retry_policy`의 rate limit(20 RPM, 20000 TPM) — 인코딩된 정책, 검증 아님
- UX 리포트의 Figma 키(`fileKey`, `nodeId`, ...) — 매핑 메타데이터만, API 호출/토큰 없음
- `provider_endpoint_preflight` — 기본 `networkMode: "disabled"`에서는 요청 없음. `loopback_only`/`explicit_hosts`로 명시 허용한 경우에만 provider metadata probe 가능
- agent-model 템플릿(OpenAI/Anthropic) — 검증 메타데이터만

이것은 Tiny-Chu가 **오프라인/폐쇄망에서 동작**하게 만드는 핵심 계약입니다. 메타데이터는 호스트가 실제 호출할 때 참고용으로 쓰입니다.

## 8. 증거 기반 분석 계약 (할루시네이션 방지)

추적/분석 툴들의 공통 계약:

| 툴 | 계약 |
|----|------|
| `evidence_qa` | 누락 증거 id, 할루시네이션 심볼, Unknown 갭 생략 trace 차단 |
| `ux_rationale_trace` | `Verified`/`Inferred`/`Unknown`/`Needs Verification`만 — LLM 전용 가설 금지 |
| `claim_evidence_check` | 지원되지 않는 심볼/누락 증거 참조 시 fail-closed |
| 모든 trace 툴 | 매칭 없으면 명시적 `Unknown` 갭, 추측 링크 금지 |
| `layout_truth_update` | 검증된 사실 다운그레이드 금지 |

> **핵심 원칙**: 모든 분석 결론은 소스 코드 증거에 기반해야 합니다. 소스 순서만으로는 `Verified`가 될 수 없고, 직접 레이아웃/교차 계층/현재 layout-truth 증거가 필요합니다.

## 9. 성능 기준치 계약 (SLA가 아님)

CLAUDE.md의 명시적 한계:

> 성능 베이스라인 (특성화 기준치이지 SLA가 아님)

```bash
node scripts/stability-performance-baseline.mjs --out .omo/evidence/stability-performance-baseline.json
node scripts/stability-performance-baseline.mjs --section scanners --out .omo/evidence/scanner-performance-baseline.json
```

이것들은 결정론적 fixture 개수와 경과 밀리초로 **관찰 산출물**을 새로고침하는 도구입니다. 성능 **보장**이 아니라 현재 상태의 **스냅샷**입니다. 특정 응답 시간을 약속하지 않습니다.

## 10. 산출물 분리 계약

| 디렉터리 | 성격 | 커밋 여부 |
|---------|------|----------|
| `.tiny/` | 런타임 상태 | 산출물 — 커밋 금지 (단, rules_snapshot 등 명시적 요청 제외) |
| `.omo/evidence/` | QA/성능 관찰 | 산출물 |
| `.analysis/` | 분석 산출물 | 산출물 — 호출자가 명시적으로 요청할 때만 파일 생성 |
| `.tiny/locks/` | safe-tooling 단기 잠금 | 런타임 전용 |
| `.tiny/artifacts/` | 게시 매니페스트 | 런타임 전용 |
| `.tiny/rules/` | 확인된 규칙 | 호출자가 의도적으로 영속화할 때 프로젝트 상태 |

> `.tiny/rules/architecture-patterns.md`는 `rules_snapshot`이 확인된 구현 패턴을 기록하므로, 호출자가 의도하면 프로젝트 상태로 커밋할 수 있습니다. 나머지 `.tiny/`는 런타임 산출물입니다.

## 하드닝 테스트가 강제하는 것

`*-hardening.test.mjs`와 `architecture-boundary.test.mjs`가 다음을 검증합니다:

- [x] 루트 탈출 경로 → fail-closed
- [x] 심볼릭 링크 정책 (root 밖 거부 / 안 허용)
- [x] 깨진 JSON → `MalformedJsonError`
- [x] 중복 패키지 id / 툴명 → 에러
- [x] 의존성 사이클 / 누락 → 에러
- [x] 위상 정렬 결정성
- [x] 아키텍처 경계 (예: shared-support이 feature/host를 import하지 않음)

> 경계 로직을 변경하면 이 테스트들이 깨집니다. 이것은 의도된 것입니다 — 계약 위반을 조기에 발견하기 위함입니다.

## 다음 읽을 문서

- → [08-design-decisions.md](./08-design-decisions.md): 왜 이 계약들이 이 형태인지, 무엇을 왜 제외했는지.
- → [06-state-layer.md](./06-state-layer.md): 이 계약들을 뒷받침하는 실제 메커니즘.
