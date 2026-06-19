# 12. Runtime Mode와 Capability 계약 계획

## 문제 정의

Tiny-Chu는 worker-only mode와 orchestrator+worker mode를 지원한다. README는 mode 1을 worker-only, mode 2를 기본 orchestrator+worker surface로 설명한다 ([README.md](../../README.md), `README.md:158`). 현재 구현은 worker mode에서 `public-worker-queue`, `button-workflow-dispatch`, `workflow-orchestration` 패키지를 제외한다 ([src/opencode/feature-packages/default-packages.ts](../../src/opencode/feature-packages/default-packages.ts), `src/opencode/feature-packages/default-packages.ts:10`).

이 방식은 작고 명확하지만, 기능이 늘면서 "이 tool은 어떤 mode에서 보여야 하는가", "보이더라도 dispatch 같은 행위는 금지해야 하는가", "install-check가 mode별 차이를 어떻게 설명해야 하는가"가 코드 곳곳으로 퍼질 수 있다.

## 개선 목표

- runtime mode를 package filtering 이상의 capability contract로 승격한다.
- tool exposure, tool behavior, install-check, docs가 같은 mode 정보를 공유한다.
- worker mode에서 금지되는 dispatch/queue 행위가 handler 내부 예외에 흩어지지 않게 한다.

## 구조 변경안

1. `TinyRuntimeCapability` 내부 타입을 추가한다.
   - `canDispatchPublicJobs`
   - `canCreateWorkflowRuns`
   - `canReadWorkflowState`
   - `canMutateSource`
   - `canRunProviderPreflight`
2. package seed 또는 tool seed에 `requiredCapabilities` metadata를 추가한다.
3. `createDefaultTinyFeaturePackages()`는 mode -> capability -> package/tool visibility를 한 번에 계산한다.
4. handler는 capability 객체를 받아 위험 행위를 fail-closed로 거부한다.
5. `tiny_chu_install_check`는 mode별 hidden package/tool과 reason을 함께 반환한다. 현재 install-check는 runtimeMode와 requiredTools를 반환한다 ([src/opencode/install-check.ts](../../src/opencode/install-check.ts), `src/opencode/install-check.ts:6`, `src/opencode/install-check.ts:23`).

## 단계별 실행 계획

### 1단계: 현재 mode 차이 고정

- worker mode에서 제외되는 package id와 tool name snapshot을 테스트로 고정한다.
- orchestrator+worker mode의 package id와 tool count snapshot을 테스트로 고정한다.
- README의 mode 설명과 install-check 결과를 비교하는 문서 sync test를 추가한다.

### 2단계: capability metadata 도입

- package seed에는 coarse capability를 둔다.
- tool seed에는 package보다 좁은 예외가 필요한 경우에만 capability를 둔다.
- `worker_packet_optimizer`처럼 handler 내부에서 dispatch를 막는 예외는 capability guard로 이동한다 ([src/opencode/tiny-plugin.ts](../../src/opencode/tiny-plugin.ts), `src/opencode/tiny-plugin.ts:157`).

### 3단계: install-check와 doctor 반영

- `tiny_chu_install_check`에 `hiddenPackages`, `hiddenTools`, `capabilities`를 추가한다.
- `doctor` 또는 `environment_doctor`는 runtime mode mismatch를 warning으로만 보고한다. package loading 자체는 계속 deterministic하게 유지한다.

## 수용 기준

- mode별 tool surface가 registry에서 파생된다.
- handler 내부에 mode string 비교가 새로 늘어나지 않는다.
- worker mode에서 dispatch 계열 기능은 tool 노출 또는 capability guard 중 하나로 일관되게 차단된다.
- install-check 출력만 봐도 mode별 차이가 설명된다.

## 위험과 완화

- 위험: capability가 과도하게 많아져 작은 라이브러리 원칙을 깨뜨릴 수 있다.
- 완화: mode에서 실제 분기하는 capability만 추가하고, package visibility에 쓰이지 않는 capability는 금지한다.
- 위험: 기존 사용자가 `tiny.tools[name]` 직접 호출 시 behavior가 바뀔 수 있다.
- 완화: 노출 여부와 실행 거부를 분리해 migration note를 남긴다.

## 하지 않을 것

- runtime에서 사용자가 임의 package graph를 disable하는 기능은 넣지 않는다.
- OpenCode host의 top-level mode object와 Tiny-Chu mode를 자동 동기화하지 않는다.
- provider call capability를 본문 생성 실행으로 확장하지 않는다.
