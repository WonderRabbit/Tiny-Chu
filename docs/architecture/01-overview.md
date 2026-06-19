# 01. 시스템 개요

## Tiny-Chu는 무엇인가

Tiny-Chu는 **파일 기반(file-backed)** 의 가벼운 OpenCode 스타일 오케스트레이션 **라이브러리**입니다. `oh-my-openagent`의 Light 에디션 아키텍처에서 영감을 받았으며, 로컬 "foreman(작업 총괄)" 소형 모델과 단일 public-worker 디스패치 큐를 운영하는 데 필요한 **휴대 가능한 원시 기능(primitive)** 만 담고 있습니다.

두 가지 얼굴을 가집니다:

1. **npm 라이브러리** — `package.json`의 `exports`:
   - `"."` → `dist/index.js` (직접 API)
   - `"./opencode"` → `dist/opencode/plugin.js` (OpenCode 플러그인 진입점)
2. **프로젝트 로컬 OpenCode 플러그인** — `.opencode/plugins/tiny-chu.ts` 심(shim)이 소스에서 `TinyChuOpenCodePlugin`을 다시 내보냅니다.

> 즉, 이 리포지토리 루트에서 OpenCode를 실행하면 **TypeScript 소스를 직접** 실행하고, 다른 프로젝트에서는 **컴파일된 `tiny-chu/opencode`** 에 의존합니다.

## 의도적으로 제외한 것

Tiny-Chu의 정체성은 **무엇을 넣었느냐**만큼 **무엇을 빼었느냐**로도 정의됩니다. 아래 시스템들은 의도적으로 포함하지 않습니다:

| 제외 항목 | 이유 |
|---------|------|
| **Team Mode** | 다중 에이전트 협업 오케스트레이션은 범위 밖. 단일 foreman + 단일 public worker만 |
| **Hyperplan** | 대규모 계층적 계획 엔진 대신 단순 Markdown 체크박스 계획(`.tiny/plans/*.md`) |
| **Atlas / parallel hooks** | 병렬 디스패치 훅 없음. worker 패킷은 기본 순차(sequential) 처리 |
| **원본 delegate-task 엔진** | 자체 delegate 메커니즘 대신 file-backed public-job 큐(`.tiny/public-jobs/*.json`) |

이 제외 결정의 근거는 [08-design-decisions.md](./08-design-decisions.md)에서 자세히 다룹니다.

## Tiny-Chu가 제공하는 것 (포함 범위)

```text
· 가장 가까운 AGENTS.md + 프로젝트 규칙 컨텍스트 번들링
· .tiny/tasks/*.json        — 작업 영속성
· .tiny/plans/*.md          — 체크박스 기반 연속(continuation) 상태
· .tiny/workflows/runs/*.json — workflow JSON source of truth
· .tiny/workflows/reports/**/*.md — 단계별 workflow report projection
· .tiny/public-jobs/*.json  — public-worker 큐 패킷
· .tiny/wiki/index.json     — canonical wiki 번들 선택 기준
· createTinyChuPlugin() 얇은 셸 — task_*, public_*, context_*, wiki_*, naming_* 등 기본 93개 툴 노출
```

## 런타임 환경

### 노드와 모듈
- **Node ≥ 20.18** (`package.json`의 `engines`)
- **ESM 전용** (`"type": "module"`)
- **TypeScript strict + NodeNext** — 소스가 `.ts`더라도 **상대 import에는 명시적으로 `.js` 확장자**가 필요합니다. 예: `import { X } from "./feature-package.js";` (`.ts`가 아님)

### 셸: PowerShell 7.6
오케스트레이션 프로필은 **Unix 중심 도구를 가정하지 않습니다**. Tiny-Chu는 OpenCode 세션이 PowerShell 런타임에서 실행된다고 선언합니다(`src/opencode/tiny-plugin.ts:51`의 `POWERSHELL_OPENCODE_RUNTIME`):

```ts
export const POWERSHELL_OPENCODE_RUNTIME: OpenCodeRuntimeConfig = {
  shell: {
    name: "powershell",
    executable: "pwsh",
    version: "7.6.2",
    args: ["-NoLogo", "-NoProfile"],
  },
  tooling: POWERSHELL_TOOLING_PROFILE,
};
```

이것은 단순한 설정값이 아닙니다. **전체 도구 설계 철학의 기반**입니다 — `grep -R`/`find`/`xargs` 같은 Unix 전용 파이프라인 대신 실제 네이티브 실행 파일(`jq`, `yq`, `mdq`, `fd`, `ast-grep`, `rg`)을 참조하는 PowerShell 툴링 프로파일(`src/opencode/powershell-tooling.ts`)이 함께 내보내집니다. 자세한 내용은 [05-plugin-and-hooks.md](./05-plugin-and-hooks.md)의 PowerShell 툴링 주입 섹션을 보세요.

### 의존성 철학
- **직접 런타임 의존성**: `@opencode-ai/plugin`, `@opentui/solid`, `typescript` 세 개
  - `@opencode-ai/plugin`: OpenCode plugin bridge와 `./opencode` export를 제공한다.
  - `@opentui/solid`: `./tui` export와 TUI dashboard runtime에 필요하다. `src/opencode/tui-plugin.ts`는 이 패키지를 동적으로 import하고, `src/opencode/tui-dashboard-renderer.ts`는 Solid JSX 타입을 사용한다.
  - `typescript`: root export의 `extractNamingSymbols()`가 compiler API로 source symbol을 읽는 데 필요하다.
- **기본 오프라인, 명시적 provider preflight만 선택적 네트워크** — 오케스트레이션 프로파일, agent-model 템플릿, Figma 매핑 키, Qwen 패킷 구성은 모두 **어댑터-대비만 된(adapter-ready) 메타데이터**입니다. Tiny-Chu는 기본적으로 네트워크 API 호출을 하지 않으며, `provider_endpoint_preflight`만 사용자가 `networkMode`로 허용한 경우 로컬/명시 호스트 metadata probe를 수행할 수 있습니다. `doctor` 준비 게이트는 로컬 전용입니다.

### 대상 플랫폼
Windows 10, PowerShell 7.6, OpenCode 플러그인 세션을 1차 대상으로 설계되었습니다(각 패키지의 `compatibility.requiredRuntime` 참조). 단, 경로 안전 코드(`src/state/path-safety.ts`)는 Windows 절대경로(`C:\`, UNC)와 POSIX 모두를 처리하므로 다른 플랫폼에서도 동작합니다.

## 소스 디렉터리 구조

```text
src/
  index.ts                      공개 API 재export (단일 진입)
  node-shims.d.ts               Node 내장 타입 보조

  context/                      ─ 컨텍스트 번들링
    context-loader.ts             가장 가까운 AGENTS.md + 규칙 수집
    evidence-packet.ts            bounded 컨텍스트/증거 패킷

  dispatcher/                   ─ public worker 큐
    public-job.ts                 PublicDispatcher, rate gate, 큐 패킷

  state/                        ─ 영속 상태 기반층
    paths.ts                      resolveTinyChuPaths(root)
    path-safety.ts                루트 제약 (fail-closed)
    file-store.ts                 원자적 쓰기, JSON/JSONL 판독
    task-store.ts                 TaskStore (task + checkpoints)
    workflow-*.ts                 WorkflowStore, workflow projection, locking, packet helpers

  ulw-loop/                     ─ 계획 루프
    plan.ts                       Markdown 체크박스 파싱/상태 판단

  wiki/                         ─ wiki 번들링
    wiki-bundler.ts               canonical wiki 선택/번들

  markdown/                     ─ 마크다운 도구
    mermaid.ts                    Mermaid fence/구문 가드

  opencode/                     ─ 플러그인 셸 + 기본 93개 툴 (대부분의 코드)
    tiny-plugin.ts                createTinyChuPlugin() — 평평한 tools 맵
    plugin.ts                     OpenCode 브리지 (TinyChuOpenCodePlugin)
    feature-package.ts            composeFeaturePackages() — 컴포저
    feature-package-order.ts      validateAndOrderFeaturePackages() — 위상 정렬
    feature-package-types.ts      모든 타입 정의
    feature-packages/             디스크립터 + 툴 시드 (단일 진실 공급원)
    install-check.ts              세 번째 소비 지점
    output-budget.ts              renderBudgetedOutput() — 출력 예산
    ...그 외 개별 툴 핸들러 파일들
```

> `src/opencode/`가 전체 소스의 대부분을 차지합니다. 여기에 기본 핸들러 구현 93개와 레지스트리 시스템이 모두 있습니다.

## 빌드와 테스트

```bash
npm run build          # tsc -p tsconfig.json → dist/  (strict, NodeNext, declaration 포함)
npm test               # 빌드 후 node --test test/*.test.mjs
```

**중요**: 테스트는 `src/`가 아니라 **`../dist/`**에서 import합니다. 따라서 단일 테스트를 실행하려면 반드시 빌드를 먼저 해야 합니다:

```bash
npm run build && node --test test/feature-package.test.mjs
```

테스트는 Node 내장 러너(`node:test` + `node:assert/strict`)를 쓰며 `.mjs`로 작성됩니다. 많은 테스트가 **fail-closed 동작을 검증하는 "hardening" 테스트**입니다 — 경계/루트 제약 로직을 변경하면 `*-hardening.test.mjs`와 `architecture-boundary.test.mjs`가 이를 강제합니다.

## 공개 API 표면

`src/index.ts`에서 재export되는 핵심 API:

| export | 용도 |
|--------|------|
| `createTinyChuPlugin` | 메인 진입 — 플러그인 모듈 반환 |
| `TinyChuOpenCodePlugin` | OpenCode 호스트용 플러그인 진입점 |
| `POWERSHELL_OPENCODE_RUNTIME` | 고정된 셸 런타임 설정 |
| `resolveTinyChuPaths` | `.tiny/` 경로 해석 (반드시 사용) |
| `TaskStore` | 작업 영속성 |
| `PublicDispatcher` | public worker 큐 + rate gate |
| `WorkflowStore` / `createWorkflow*` | workflow source-of-truth, checkpoint, resume packet |
| `loadContextBundle` | 컨텍스트 수집 |
| `parsePlanMarkdown` / `readPlanStatus` | 계획 상태 |
| `WikiBundler` | wiki 번들 |
| `renderBudgetedOutput` | 출력 예산 |
| `composeFeaturePackages` *(타입만)* | 레지스트리 컴포지션 |

> 직접 라이브러리로 쓸 때는 `createTinyChuPlugin(config)`이 반환하는 `TinyPluginModule`의 `tools`/`registry`/`hooks`를 소비합니다. OpenCode 호스트로 쓸 때는 `TinyChuOpenCodePlugin`을 전달합니다. 두 경로 모두 [02-registry-pattern.md](./02-registry-pattern.md)에서 동일한 레지스트리를 공유함을 확인합니다.

## 다음 읽을 문서

→ [02-registry-pattern.md](./02-registry-pattern.md): 전체 아키텍처의 척추인 **"하나의 레지스트리, 세 개의 소비 지점"** 패턴을 깊이 파헤칩니다.
