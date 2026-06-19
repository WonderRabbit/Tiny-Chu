# 08. 설계 결정

> Tiny-Chu의 정체성은 **무엇을 넣었느냐**만큼 **무엇을 빼었느냐**, 그리고 **왜 그렇게 했느냐**로 정의됩니다. 이 문서는 핵심 설계 결정과 그 근거, 그리고 명시적 비목표(non-goals)를 다룹니다.

## 결정 1: 단일 레지스트리에서 세 표면으로의 생성 (Generation over Edition)

### 결정
평평한 핸들러 맵 → 검증된 레지스트리 → 세 소비 지점. **편집이 아니라 생성**.

### 근거
세 표면(직접 API, OpenCode 브리지, install-check)이 같은 툴 목록을 가져야 합니다. 과거 수동 편집 방식은 inevitably 드리프트(drift)가 발생했습니다 — 한 곳을 고치고 다른 곳을 잊는 실수. 생성은 이를 **구조적으로 불가능**하게 만듭니다.

### 대안과 기각 이유
- **수동 병렬 배열**: 드리프트 위험. 기각.
- **런타임 동적 디스커버리**: 복잡성 증가, 결정성 상실. Tiny-Chu는 "작게 유지"를 표방하므로 기각.
- **코드 생성(스크립트)**: 빌드 단계 복잡화. 대신 컴포즈는 런타임에 한 번 수행 (`createTinyChuPlugin` 호출 시).

자세한 메커니즘은 [02-registry-pattern.md](./02-registry-pattern.md)를 보세요.

## 결정 2: 파일 기반 상태, DB 없음

### 결정
모든 상태는 `.tiny/` 아래 JSON/JSONL/Markdown 파일. 데이터베이스 없음.

### 근거
- **휴대성**: SQLite조차 필요 없음, Node 내장 `fs`만으로 동작
- **폐쇄망 친화적**: 외부 서비스/런타임 의존성 최소
- **검사 가능**: 상태가 일반 텍스트 파일이라 사람이/git이 읽을 수 있음
- **원자적 쓰기**: temp-rename 패턴이 DB 트랜잭션 없이도 부분 쓰기 방지

### 비용 (수용된 한계)
- local filesystem advisory lock에 한정 (분산 잠금/DB 트랜잭션 아님)
- 대규모 동시 쓰기에는 부적합
- 쿼리能力은 파일 스캔에 의존

이 한계들은 Tiny-Chu의 대상(로컬 foreman + 단일 worker)에 맞습니다.

## 결정 3: PowerShell을 1차 셸로 고정

### 결정
`POWERSHELL_OPENCODE_RUNTIME`으로 PowerShell 7.6(`pwsh`)을 고정. Unix 도구를 가정하지 않음.

### 근거
- **대상 환경**: Windows 10 + PowerShell 7.6이 명시적 1차 대상
- **오류 패턴**: Unix 중심 도구(`grep -R`, `find`, `xargs`)가 `pwsh`에서 흔히 실패
- **소형 모델 보호**: PowerShell 따옴표/확장 규칙을 명시적 프로파일로 인코딩하여 소형 모델의 실수 방지

### 비용
- Unix 전용 환경에서는 일부 도구 프로파일이 과잉
- 단, `path-safety.ts`는 Windows/POSIX 모두 처리하므로 코드 자체는 이식 가능

### 동시 설계: 네이티브 툴 메타데이터
PowerShell 별칭이 아닌 **실제 실행 파일**(`jq`, `yq`, `mdq`, `fd`, `ast-grep`, `rg`)을 참조. 이 도구들은 npm 의존성이 아니라 **선택적 시스템 의존성** — 누락 시 degraded/unavailable 반환, 강제 설치 없음.

## 결정 4: 기본 오프라인, provider preflight만 선택적 네트워크

### 결정
Tiny-Chu는 기본적으로 네트워크 API 호출을 하지 않음. 모델/프로바이더 정보는 어댑터-대비 메타데이터이며, `provider_endpoint_preflight`만 사용자가 `networkMode`로 명시 허용한 경우 chat/generate가 아닌 metadata endpoint probe를 수행할 수 있음.

### 근거
- **폐쇄망 동작**: 핵심 사용 사례 중 하나가 오프라인/내부망
- **테스트 용이성**: 기본 경로는 네트워크 모킹 없이 테스트 가능하고, provider preflight도 disabled/blocked 경로가 요청을 보내지 않는지 검증
- **비용/키 관리 부담 제거**: chat/generate 호출을 하지 않으므로 API 키/토큰 관리 불필요
- **결정성**: 기본 입력 → 동일 출력. 선택적 provider preflight의 네트워크 변동은 status/diagnostics로 격리

### 메타데이터만 제공하는 것들
- `orchestration_profile`: foreman/delegate 모델 정보 (호스트가 실제 호출)
- `qwen_retry_policy`: rate limit 정책 (20 RPM, 20000 TPM 인코딩)
- Figma 매핑 키: `fileKey`, `nodeId`, `figmaNodeName` (API 호출/토큰 없음)
- agent-model 템플릿: OpenAI/Anthropic 검증 메타데이터
- `provider_endpoint_preflight`: 기본 `networkMode: "disabled"`에서는 요청 없음. 명시 허용 시 provider readiness를 위한 metadata probe만 수행하며 chat/generate 호출은 하지 않음

### 의미
Tiny-Chu는 **순수 로컬 오케스트레이션 프레임**입니다. 실제 LLM 호출은 호스트(OpenCode)가 하고, Tiny-Chu는 그 호출을 위한 패킷/정책/컨텍스트를 준비합니다.

## 결정 5: 강타입 입력 대신 런타임 검증

### 결정
툴 핸들러가 `Record<string, unknown>`을 받고, `stringInput()`/`numberInput()`/`stringListInput()`으로 런타임 검증.

### 근거
- **기본 93개 툴의 일관된 노출**: 각 툴마다 상세 JSON 스키마를 유지하는 부담 회피
- **핸들러 단순성**: 비즈니스 로직에 집중
- **OpenCode 브리지 단순화**: 모든 툴이 동일한 자유 형식 객체 입력

### 예외
safe-tooling 툴(`safe_patch_check` 등)은 상세 `inputSchema`를 가집니다 (`default-tool-seeds.ts:99`). 소스 변경은 고위험이므로 입력 검증이 더 엄격합니다.

### 비용
- 호출자가 입력 형태를 책임져야 함
- IDE 자동완성 지원 약함

## 결정 6: 출력 예산의 이원화

### 결정
직접 API는 전체 객체, OpenCode 브리지는 `renderBudgetedOutput()` 통과.

### 근거
- **직접 API**: 프로그래밍 사용자는 전체 데이터가 필요 (잘림이 정보 손실)
- **OpenCode**: LLM 컨텍스트는 유한, 소형 모델 보호 필요

동일 핸들러가 두 용도에 모두 쓰이면서, 잘림은 브리지에서만 적용합니다. 자세한 내용은 [05-plugin-and-hooks.md](./05-plugin-and-hooks.md).

## 결정 7: safe tooling은 옵트인

### 결정
`config.safeTooling: true`일 때만 소스 변경 도구가 레지스트리에 포함.

### 근거
- **기본 안전**: 기본 레지스트리는 읽기 전용 + 상태 쓰기만
- **명시적 동의**: 소스 변경은 고위험이므로 사용자가 의식적으로 켜야
- **단계적 노출**: `nativePreviews`는 `safeTooling` 위에 또 한 단계

### 안전 워크플로 설계
```
미리보기/패치 구성 → safe_patch_check (해시 검증) → safe_patch_apply (allowlist 타겟만)
산출물: artifact_workspace_prepare (격리) → commit → publish_manifest → publish_apply
```
생성 Git 작업은 소스 리포지토리 **밖**에서, 최종 apply만 소스에 기록. 이 격리가 실수로 인한 소스 오염을 막습니다.

## 결정 8: 증거 기반 분석, 할루시네이션 금지

### 결정
모든 추적/분석 툴은 소스 증거에 기반. 매칭 없으면 명시적 `Unknown`. LLM 전용 가설 금지.

### 근거
- **신뢰**: 분석 결과가 검증 가능해야 함
- **소형 모델 한계**: LLM 가설은 소형 모델에서 특히 위험 (할루시네이션)
- **감사 가능성**: `evidence_qa`/`claim_evidence_check`가 증거 부재를 강제

### 적용
- `ux_rationale_trace`: `Verified`/`Inferred`/`Unknown`/`Needs Verification` 상태만
- `layout_truth_update`: 검증된 사실 다운그레이드 금지
- `evidence_qa`: Unknown 갭 생략 차단

## 결정 9: Team Mode / Hyperplan / Atlas / delegate-task 제외

이것이 Tiny-Chu의 "Tiny"를 정의하는 핵심 비목표(non-goals)입니다.

### 제외: Team Mode
**근거**: 다중 에이전트 협업 오케스트레이션은 범위 폭발. 단일 foreman + 단일 public worker로 시작점을 작게 유지.

### 제외: Hyperplan
**근거**: 대규모 계층적 계획 엔진 대신 단순 Markdown 체크박스(`.tiny/plans/*.md`). "boulder" 루프는 `readPlanStatus()`로 충분.

### 제외: Atlas / parallel hooks
**근거**: 병렬 디스패치 훅 없음. worker 패킷 실행 정책은 기본 **순차** 처리이며, 이는 scheduling 범위의 비목표다. `.tiny` task/public-job/workflow/wiki 상태 writer 자체는 `.tiny/locks/` advisory lock 계약을 따른다.

### 제외: 원본 delegate-task 엔진
**근거**: 자체 delegate 메커니즘 대신 file-backed public-job 큐. 상태가 파일이라 검사 가능하고, core writer 충돌은 local-filesystem advisory lock으로 직렬화된다.

### 공통 철학
> "이 리포지토리는 의도적으로 작게 유지됩니다. 큰 추상화는 피합니다." (AGENTS.md)

제외는 영구적 제약이 아니라 **v0.1의 범위**입니다. README: "Phase 1은 의도적으로 내부적입니다. Tiny-Chu는 아직 동적 패키지 디스커버리, npm 서브패키지 로딩, MCP 서버 어댑터, Figma API 호출, 프로바이더 chat/generate/completion 호출, 또는 기본 패키지의 런타임 비활성화를 제공하지 않습니다. `provider_endpoint_preflight`는 명시적으로 켜는 metadata readiness probe 예외입니다."

## 결정 10: 위상 정렬된 패키지 의존성

### 결정
패키지 간 `dependsOn`으로 DAG를 형성하고, 위상 정렬로 결정론적 순서 보장.

### 근거
- **의존성 명시화**: 어느 패키지가 어느 패키지를 필요로 하는지 코드로 표현
- **사이클 감지**: 컴포즈 시 즉시 실패
- **결정론적 순서**: 동일 입력 → 동일 `orderedIds` (테스트 단언 가능)

### 대안과 기각
- **평평한 툴 목록**: 의존성/소유권 메타데이터 상실
- **런타임 의존성 해석**: 복잡성. 정적 검증이 더 안전.

## 결정 11: 호환성 스펙은 메타데이터 (아직 강제 아님)

### 결정
각 패키지의 `compatibility.requiredRuntime`(windows10, powershell 7.6, opencode)를 선언하지만, 런타임 강제 검사는 아직 없음.

### 근거
- **미래 대비**: 향후 설치 게이트의 기반 마련
- **문서화**: 패키지의 요구 환경을 명시
- **점진적 도입**: 강제 없이 메타데이터부터 축적

### 현재 상태
`environment_doctor`/`doctor`가 환경을 **보고**하지만, 패키지 로딩을 **거부**하지는 않습니다. 호환성 위반은 경고로만 나타납니다.

## 결정 12: 의존성 최소주의

### 결정
직접 런타임 의존성은 `@opencode-ai/plugin`, `@opentui/solid`, `typescript` 세 개다.

- `@opencode-ai/plugin`: OpenCode plugin bridge와 `./opencode` export의 타입/런타임 계약이다.
- `@opentui/solid`: `./tui` export와 TUI dashboard runtime에 필요하다. `tiny-chu/tui`가 로드하는 dashboard plugin은 Solid 기반 slot UI를 렌더링한다.
- `typescript`: root export의 `extractNamingSymbols()`가 compiler API로 source symbol을 읽는 데 필요하다.

### 근거
- **Node 내장 우선**: `fs`, `path`, `crypto`, `readline` 등으로 충분
- **공급망 위험 최소**: runtime surface는 OpenCode bridge와 TUI dashboard에 필요한 직접 의존성만 둔다.
- **설치 속도/크기**: 폐쇄망 배포에 유리

### 네이티브 툴은 의존성이 아님
`jq`, `rg`, `fd` 등은 **선택적 시스템 의존성**. `requiredNativeTools` 메타데이터로 선언되지만 npm 패키지가 아닙니다. 누락 시 unavailable/degraded, 강제 설치 없음.

## 요약: Tiny-Chu의 설계 원칙

| 원칙 | 구현 |
|------|------|
| 작게 유지 | 제외된 대형 시스템들 (결정 9) |
| 생성 > 편집 | 단일 레지스트리 → 세 소비 지점 (결정 1) |
| 로컬 우선 | 파일 기반, 기본 오프라인 + 명시적 provider metadata preflight 예외 (결정 2, 4) |
| 결정론적 | 위상 정렬, 정렬된 직렬화 (결정 10, [07](./07-stability-contracts.md)) |
| 증거 기반 | 할루시네이션 금지 (결정 8) |
| 안전 기본값 | safe tooling 옵트인 (결정 7) |
| 명시적 실패 | fail-closed (MalformedJsonError, 경로 위반) |
| 최소 의존성 | Node 내장 + 직접 런타임 의존성 3개 (결정 12) |

## 다음 읽을 문서

- → [09-extending-guide.md](./09-extending-guide.md): 이 설계를 존중하면서 툴/패키지를 추가하는 절차.
- → [01-overview.md](./01-overview.md): 제외 항목의 빠른 요약.
