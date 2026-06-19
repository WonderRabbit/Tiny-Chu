# 11. Feature Package 경계 재정렬 계획

## 문제 정의

현재 아키텍처의 load-bearing 원칙은 단일 레지스트리다. 패키지 seed는 `tiny-chu.core-runtime`, `tiny-chu.shared-support`, `tiny-chu.public-worker-queue`, `tiny-chu.workflow-orchestration`, `tiny-chu.small-model-resilience`, `tiny-chu.ux-reverse-engineering`, `tiny-chu.host-opencode` 등으로 나뉘어 있다 ([src/opencode/feature-packages/default-package-seeds.ts](../../src/opencode/feature-packages/default-package-seeds.ts), `src/opencode/feature-packages/default-package-seeds.ts:4`, `src/opencode/feature-packages/default-package-seeds.ts:91`).

하지만 handler 구현은 대부분 `createTinyChuPlugin()`의 flat map에 모인다 ([src/opencode/tiny-plugin.ts](../../src/opencode/tiny-plugin.ts), `src/opencode/tiny-plugin.ts:84`). 이 파일은 core state, public worker, workflow, UX, artifact, naming, safe tooling, install-check를 모두 import한다 (`src/opencode/tiny-plugin.ts:1`, `src/opencode/tiny-plugin.ts:56`). 패키지 descriptor는 분리되어 있지만 handler 소유권은 아직 패키지 단위로 충분히 분리되어 있지 않다.

## 개선 목표

- 단일 레지스트리 원칙은 유지한다.
- handler 구현을 package ownership 기준으로 분리한다.
- OpenCode host adapter는 composed registry만 소비하게 유지한다.
- 현재 boundary guard가 강제하는 core/shared/feature/host 방향성을 더 구체화한다 ([test/architecture-boundary.test.mjs](../../test/architecture-boundary.test.mjs), `test/architecture-boundary.test.mjs:35`, `test/architecture-boundary.test.mjs:70`).

## 구조 변경안

1. `src/opencode/handlers/` 또는 `src/opencode/feature-handlers/` 계층을 만든다.
2. package seed 묶음과 같은 단위로 handler factory를 분리한다.
   - `createCoreRuntimeHandlers(root)`
   - `createPublicQueueHandlers(root, dispatcherFactory)`
   - `createWorkflowHandlers(root)`
   - `createEvidenceArtifactHandlers(root)`
   - `createNamingHandlers(root)`
   - `createUxReverseHandlers(root)`
3. `createTinyChuPlugin()`은 root, runtime mode, shared state 객체를 만들고 handler factories를 합치는 composition root 역할만 맡는다.
4. `createDefaultTinyFeaturePackages(handlers, options)`는 그대로 유지한다. 즉 descriptor와 registry 생성 경로는 바꾸지 않는다.
5. `architecture-boundary.test.mjs`에 handler layer 규칙을 추가한다.

## 단계별 실행 계획

### 1단계: 소유권 지도 작성

- `registry.toolSpecs` 기준으로 tool name -> package id -> 현재 handler 위치 매트릭스를 만든다.
- 누락/중복/임시 handler를 별도 목록으로 분리한다.
- 산출물: `docs/architecture` 또는 `.omo/evidence`에 handler ownership matrix.

### 2단계: factory 추출

- 가장 작은 단위부터 시작한다.
  - naming handlers는 이미 `createNamingToolHandlers(root)`로 독립되어 있으므로 기준 패턴으로 삼는다 ([src/opencode/tiny-plugin.ts](../../src/opencode/tiny-plugin.ts), `src/opencode/tiny-plugin.ts:196`).
  - workflow는 `createWorkflowToolHandlers(root)`가 이미 독립되어 있으므로 두 번째 기준 패턴으로 삼는다 (`src/opencode/tiny-plugin.ts:81`, `src/opencode/tiny-plugin.ts:211`).
- core task/public/wiki/context handler를 각각 factory로 분리한다.
- 분리 후 `createTinyChuPlugin()`의 직접 handler literal은 composition-only로 줄인다.

### 3단계: 경계 테스트 강화

- feature handler가 host adapter(`plugin.ts`, `install-check.ts`)를 import하지 못하게 한다.
- shared support가 feature handler를 import하지 못하게 한다.
- package seed가 참조하는 tool name과 handler factory가 제공하는 tool name의 parity test를 추가한다.

## 수용 기준

- `createTinyChuPlugin()`은 registry composition root로 남고 도메인별 비즈니스 handler 구현을 직접 품지 않는다.
- `createDefaultTinyFeaturePackages()`와 `composeFeaturePackages()`의 public contract는 유지된다.
- 직접 API, OpenCode bridge, install-check가 계속 같은 registry를 소비한다.
- `npm run build`와 `npm test`가 통과한다.

## 위험과 완화

- 위험: handler를 분리하면서 root/runtimeMode/dispatcher 같은 공유 객체가 암묵적으로 복제될 수 있다.
- 완화: `TinyToolRuntime` 같은 작은 내부 context를 만들고 factory 인자로만 전달한다.
- 위험: 추출 중 package id와 handler name drift가 생길 수 있다.
- 완화: registry parity test를 먼저 추가하고, factory별 tool name snapshot을 정렬해 비교한다.

## 하지 않을 것

- 동적 package discovery를 이 단계에서 구현하지 않는다.
- 외부 plugin package를 로드하지 않는다.
- OpenCode tool schema를 전면 강타입화하지 않는다.
