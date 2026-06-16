# HYSTORY

이 문서는 Tiny-Chu 변경 이력을 최신 항목이 위에 오도록 날짜 역순으로 기록한다.

## 2026-06-16 07:44:47 KST - OpenCode runtime mode selection

### 요약

OpenCode 플러그인 런타임을 단일 워커 구조와 오케스트레이터-워커 구조로 분리했다.
최상단 설정에서 사용할 모드를 선택할 수 있으며, 설정을 생략하면 기존 동작과 호환되도록 오케스트레이터-워커 모드가 기본값으로 동작한다.

### 상세 변경

- `mode 1` / `worker`: 단일 워커 구조로 동작한다.
  - public worker queue 도구를 노출하지 않는다.
  - workflow orchestration 도구를 노출하지 않는다.
  - `button_workflow_dispatch` 도구를 노출하지 않는다.
  - worker 전용 실행 중 `.tiny/public-jobs` 상태가 불필요하게 생성되지 않도록 조정했다.
- `mode 2` / `orchestrator_worker`: 기존 오케스트레이터-워커 구조로 동작한다.
  - 기존 public queue, workflow orchestration, button workflow dispatch 기능을 유지한다.
  - mode 설정을 생략한 경우 기본값으로 사용한다.
- OpenCode 플러그인 설정에서 mode를 받을 수 있도록 구성 경로를 추가했다.
  - `createTinyChuPlugin({ mode })` 직접 사용을 지원한다.
  - OpenCode plugin tuple/options 입력에서도 mode를 해석한다.
  - `1`, `2`, `mode1`, `mode2`, `worker`, `worker_only`, `orchestrator_worker` alias를 지원한다.
  - 알 수 없는 mode 값은 조기에 실패하도록 처리했다.
- 설치 점검 및 셸 환경 메타데이터에 런타임 모드를 반영했다.
  - `tiny_chu_install_check` 결과에 `runtimeMode`를 포함한다.
  - OpenCode shell 환경에 `TINY_CHU_MODE`를 주입한다.
- feature package graph를 mode 기준으로 분기했다.
  - core/local 패키지와 public worker queue 패키지를 분리했다.
  - workflow orchestration 패키지와 button workflow dispatch 패키지를 worker mode에서 제외했다.
- worker mode에서 숨겨진 도구를 안내하거나 public job 상태를 건드리지 않도록 런타임 안내를 보정했다.
  - `worker_packet_optimizer({ dispatch: true })`는 worker mode에서 상태 기록 전에 거부된다.
  - `PublicDispatcher`를 lazy 생성으로 전환했다.
  - `transformUserMessage`는 worker mode에서 context와 PowerShell 안내만 주입한다.
  - `orchestration_profile`, `tool_usage_plan`, `qwen_retry_policy`, `orchestration_health`, OpenCode tool description이 worker mode에 맞는 안내만 제공하도록 수정했다.
- 문서와 테스트를 runtime mode 기준으로 갱신했다.
  - OpenCode plugin tuple 예시, local shim forwarding, 직접 라이브러리 사용법, 기본 mode 2 동작, feature package graph 설명을 문서화했다.
  - `test/runtime-mode.test.mjs`에 mode별 도구 노출, 상태 생성 방지, health 결과, tool description 검증을 추가했다.

### 검증

- `npm run build` 통과
- `node --test test/runtime-mode.test.mjs` 통과
- `npm test` 통과
- 변경 TypeScript 파일 LSP diagnostics clean 확인
- 구현 후 리뷰 결과: `APPROVE - UNCONDITIONAL APPROVAL`

### 관련 파일

- `src/opencode/tiny-plugin.ts`
- `src/opencode/orchestration-health.ts`
- `src/opencode/feature-packages/default-packages.ts`
- `test/runtime-mode.test.mjs`
