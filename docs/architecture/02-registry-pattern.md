# 02. 레지스트리 패턴: 하나의 레지스트리, 세 개의 소비 지점

> **이 문서가 가장 중요합니다.** Tiny-Chu의 거의 모든 것이 이 구조에 매달려 있습니다. CLAUDE.md는 이것을 "가장 중요한 패턴"이라고 부릅니다.

## 핵심 통찰

Tiny-Chu 아키텍처의 척춄는 단일 문장으로 요약됩니다:

> **평평한(flat) 핸들러 맵을 하나의 검증된 레지스트리로 변환하고, 그 레지스트리를 서로 독립적인 세 지점에서 소비한다.**

이 패턴이 존재하는 이유는 **세 표면(직접 API, OpenCode 브리지, install-check)이 똑같은 툴 목록을 가져야 하기 때문**입니다. 과거에는 이 세 표면을 각각 수동으로 편집했고, inevitably 어긋났습니다(drift). Tiny-Chu는 이 문제를 **생성(generation)** 으로 해결합니다 — 편집하는 곳은 한 곳이고, 소비하는 곳은 세 곳입니다.

## 전체 흐름

```text
createTinyChuPlugin()                         src/opencode/tiny-plugin.ts:61
  │
  ├─ ① 평평한 tools 맵 정의 (기본 85개 핸들러)
  │     const tools: Record<string, TinyToolHandler> = {
  │       task_create: async (input) => ...,
  │       public_dispatch: async (input) => ...,
  │       ... (핸들러가 "존재하는 유일한 장소")
  │     }
  │
  └─ ② createDefaultTinyFeaturePackages(tools)  src/opencode/feature-packages/default-packages.ts:11
        │   평평한 핸들러 → TinyFeaturePackage 디스크립터로 바인딩
        │   (id, dependsOn, tools[], resources[], instructions[] ...)
        ▼
   ③ composeFeaturePackages(packages)          src/opencode/feature-package.ts:24
        │   ┌─────────────────────────────────────────────┐
        │   │ validateAndOrderFeaturePackages()            │  src/opencode/feature-package-order.ts:3
        │   │   · 패키지 shape 검증                         │
        │   │   · 중복 id 거부                              │
        │   │   · 중복 툴명 거부                            │
        │   │   · 누락된 의존성 거부                        │
        │   │   · 의존성 사이클 거부                        │
        │   │   · 위상 정렬(topological sort)               │
        │   └─────────────────────────────────────────────┘
        ▼
   TinyComposedRegistry  ◀── 단일 진실 공급원 (single source of truth)
        │   { packageIds, packages, tools, toolSpecs,
        │     resources, prompts, instructions,
        │     requiredToolNames, nativeToolNames }
        │
        ├─▶ 소비 1: 직접 라이브러리 API
        │    tiny.tools[name](input, context) → 완전한 구조화 객체
        │
        ├─▶ 소비 2: OpenCode 플러그인 브리지
        │    registry.toolSpecs → tinyTool() → renderBudgetedOutput()
        │
        └─▶ 소비 3: install-check 진단
             registry.requiredToolNames / packages / nativeToolNames
```

## 단계별 상세

### 단계 1 — 평평한 핸들러 맵 (`tiny-plugin.ts:69-179`)

`createTinyChuPlugin()` 내부에 `tools: Record<string, TinyToolHandler>` 객체 리터럴이 정의됩니다. 이것이 **핸들러가 존재하는 유일한 장소**입니다. 각 핸들러는 `TinyToolHandler` 타입을 따릅니다:

```ts
export type TinyToolHandler = (
  input: Record<string, unknown>,
  context?: TinyToolContext,
) => Promise<unknown>;   // src/opencode/tiny-plugin-types.ts:34
```

특징:
- 입력은 **자유 형식 객체** (`Record<string, unknown>`) — 강타입이 아니라, `stringInput()`/`numberInput()` 같은 보조 함수로 런타임에 검증합니다.
- 출력은 **완전한 구조화 객체**를 반환합니다 (문자열이 아님). 이 객체는 직접 API에서는 그대로, OpenCode에서는 출력 예산을 통과합니다.
- 핸들러는 비즈니스 로직만 담당하고, 자신이 어느 패키지에 속하는지 모릅니다.

### 단계 2 — 패키지 디스크립터로 바인딩 (`default-packages.ts:11`)

`createDefaultTinyFeaturePackages(tools, options)`는 `DEFAULT_PACKAGE_SEEDS`(`default-package-seeds.ts`)를 순회하며 각 `ToolSeed`에 대응하는 핸들러를 찾아 바인딩합니다:

```ts
function bindToolHandler(seed, tool, handlers): TinyToolDescriptor {
  const handler = handlers[tool.name];
  if (!handler) {
    throw new FeaturePackageError("invalid_tool",
      `Feature package ${seed.id} references missing handler ${tool.name}`, ...);
  }
  return { ...tool, handler };
}
```

> **핵심 fail-fast**: 디스크립터가 참조하는 툴이 핸들러 맵에 없으면 즉시 throw합니다. 이것이 "디스크립터와 구현이 어긋나는" 상황을 불가능하게 만듭니다.

`options.safeTooling`/`nativePreviews`에 따라 `SAFE_TOOLING_PACKAGE_SEEDS`를 추가로 포함합니다. 자세한 패키지 목록은 [03-feature-packages.md](./03-feature-packages.md)를 보세요.

### 단계 3 — 컴포지션과 위상 정렬 (`feature-package.ts:24`, `feature-package-order.ts:3`)

`composeFeaturePackages()`는 두 단계로 동작합니다:

```ts
export function composeFeaturePackages(featurePackages) {
  const { orderedIds, byId } = validateAndOrderFeaturePackages(featurePackages);
  return composeOrderedRegistry(orderedIds, byId);
}
```

#### 3a. 검증과 정렬 (`validateAndOrderFeaturePackages`)

네 가지를 거부합니다:

| 거부 조건 | 에러 코드 | 검사 위치 |
|----------|----------|----------|
| 패키지 id 중복 | `duplicate_package_id` | `feature-package-order.ts:10` |
| 패키지 shape 무효 (빈 id/title, version≠1) | `invalid_package` | `:30` |
| 툴 디스크립터 무효 (빈 name/description) | `invalid_tool` | `:37` |
| 의존성이 존재하지 않는 패키지를 가리킴 | `missing_dependency` | `:16` |
| 의존성 사이클 | `dependency_cycle` | `:78` |

그런 다음 **Kahn의 위상 정렬 알고리즘**(`topologicalOrder()`, `:47`)으로 패키지를 의존성 순서로 나열합니다. 결정성(determinism)을 위해 `ready` 큐와 `dependents` 리스트를 항상 `.sort()`로 정렬합니다 — 동일한 입력은 항상 동일한 순서를 생성합니다.

#### 3b. 레지스트리 조립 (`composeOrderedRegistry`, `:29`)

정렬된 순서대로 각 패키지를 순회하며 레지스트리의 각 배열을 채웁니다. 이때 다섯 번째 거부 조건이 추가로 작동합니다:

| 거부 조건 | 에러 코드 |
|----------|----------|
| 동일한 툴 이름이 두 패키지에 걸쳐 중복 | `duplicate_tool_name` (`:43`) |

> 의존성 순서로 순회하므로, 결과 `toolSpecs`/`packages` 배열의 순서는 **의존성 그래프의 위상 순서**를 따릅니다. 이 결정성은 [07-stability-contracts.md](./07-stability-contracts.md)의 "결정론적 출력" 규칙을 뒷받침합니다.

최종 레지스트리 타입 (`feature-package-types.ts:127`):

```ts
export interface TinyComposedRegistry {
  readonly packageIds: readonly string[];           // 위상 정렬된 패키지 id
  readonly packages: readonly TinyFeaturePackageSummary[];
  readonly tools: Record<string, TinyToolHandler>;  // name → handler
  readonly toolSpecs: readonly TinyComposedToolSpec[];  // 모든 툴 메타데이터
  readonly resources: readonly TinyResourceDescriptor[];
  readonly prompts: readonly TinyPromptDescriptor[];
  readonly instructions: readonly TinyInstructionDescriptor[];
  readonly requiredToolNames: readonly string[];    // toolSpecs에서 파생
  readonly nativeToolNames: readonly string[];      // 정렬된 네이티브 툴 목록
}
```

## 세 개의 소비 지점

레지스트리가 생성된 뒤, `createTinyChuPlugin()`은 이것을 `TinyPluginModule.registry`에 담아 반환합니다 (`tiny-plugin.ts:185-189`):

```ts
return {
  name: "tiny-chu",
  opencode: POWERSHELL_OPENCODE_RUNTIME,
  registry,                    // ← 단일 진실 공급원
  tools: registry.tools,       // ← 소비 1 (직접 API용 바로가기)
  hooks: { ... },
};
```

### 소비 1 — 직접 라이브러리 API

라이브러리 사용자가 `tiny.tools.task_create({...})`를 호출하면, 핸들러는 완전한 구조화 객체를 그대로 반환합니다. **출력 예산이 적용되지 않습니다.**

```ts
const tiny = createTinyChuPlugin({ root: process.cwd() });
const task = await tiny.tools.task_create({ title: "..." });
// task는 { id, title, status, ... } 완전한 객체
```

이 경로는 `registry.tools`를 직접 소비합니다. 핸들러 시그니처가 `(input, context) => Promise<unknown>`이므로 호출자가 입력 형태를 책임집니다.

### 소비 2 — OpenCode 플러그인 브리지 (`plugin.ts:55`)

`TinyChuOpenCodePlugin`은 `registry.toolSpecs`를 순회하며 각 핸들러를 OpenCode `ToolDefinition`으로 감쌉니다:

```ts
const toolMap: Record<string, ToolDefinition> = {};
for (const spec of tiny.registry.toolSpecs) {
  const handler = tiny.tools[spec.name];
  if (handler) toolMap[spec.name] = tinyTool(spec, handler);
}
```

`tinyTool()`(`plugin.ts:31`)이 하는 일:
1. **입력 스키마**: 자유 형식 객체로 받습니다 — `tool.schema.record(string, unknown).default({})`. Tiny-Chu는 강타입 입력 대신 런타임 검증을 택했습니다.
2. **출력 예산**: 핸들러 결과를 `renderBudgetedOutput()`에 통과시켜 `maxOutputChars`/`maxArrayItems`로 잘라냅니다 (기본 8000자 / 40항목). 잘림 메타데이터를 포함합니다.
3. **특례**: `tiny_chu_install_check`는 더 큰 기본 예산(20000자 / 200항목)을 갖습니다 (`:39`).
4. `ToolResult.output`은 문자열로 직렬화된 결과, `metadata`에 툴명과 예산 정보.

```ts
return {
  title: `tiny-chu:${spec.name}`,
  output: budgeted.output,
  metadata: { tool: spec.name, ...budgeted.metadata },
};
```

> **출력 예산이 왜 필요한가?** OpenCode는 툴 출력을 LLM 컨텍스트에 넣습니다. 소형 foreman 모델이 거대한 JSON 배열에 압도당하지 않도록, 브리지에서 일관되게 잘라냅니다. 직접 API(소비 1)는 예산 없이 전체 객체를 주므로 프로그래밍적 사용에 적합합니다. 이 이원화가 핵심 설계입니다. `renderBudgetedOutput()`의 내부는 [05-plugin-and-hooks.md](./05-plugin-and-hooks.md)를 보세요.

### 소비 3 — install-check 진단 (`install-check.ts:18`)

`tiny_chu_install_check` 툴은 레지스트리에서 **준비 상태(parity)** 를 검증합니다:

```ts
async () => createTinyChuInstallCheck(
  registry.requiredToolNames,   // 노출되어야 할 모든 툴명
  registry.packages,            // 노출된 패키지 요약
  registry.nativeToolNames,     // 필요한 네이티브 툴
)
```

이 툴이 반환하는 `TinyChuInstallCheckResult`는 설치자에게 "이 패키지가 노출하는 툴/패키지/네이티브 툴/진입점"을 알려줍니다. 중요한 점은 이 결과가 **별도의 하드코딩된 목록이 아니라 동일한 레지스트리에서 파생**된다는 것입니다.

`install-check.ts:37`의 `defaultInstallToolNames()`는 흥미로운 우회입니다 — 핸들러가 필요 없는 "패키지만으로 툴 목록을 알아내는" 경로입니다. `noop` 핸들러를 가진 Proxy를 만들어 `createDefaultTinyFeaturePackages`를 호출하고 툴명만 추출합니다. 이것이 install-check가 핸들러 구현 없이도 디스크립터에서 툴 목록을 재구성할 수 있는 이유입니다.

## 왜 이 패턴이 중요한가 — 드리프트(drift) 방지

과거의 안티패턴(이 코드베이스가 명시적으로 금지하는 것):

```ts
// ❌ 절대 하지 말 것 — CLAUDE.md가 금지
// tiny-plugin.ts, plugin.ts, install-check.ts에서
// 병렬 툴 배열을 수동으로 편집
const TOOLS_FOR_LIB = ["task_create", "task_get", ...];      // tiny-plugin.ts
const TOOLS_FOR_OPENCODE = ["task_create", "task_get", ...]; // plugin.ts
const TOOLS_FOR_INSTALL = ["task_create", "task_get", ...];  // install-check.ts
// 새 툴을 추가할 때 세 곳을 모두 고쳐야 함 → inevitably 어긋남
```

Tiny-Chu의 해법:

```ts
// ✅ 올바른 방법 — 한 곳만 편집
// 1. src/opencode/feature-packages/ 에 디스크립터 추가
// 2. createDefaultTinyFeaturePackages() 로 핸들러 바인딩
// 3. 세 소비 지점은 생성된 레지스트리를 소비 → 자동으로 동기화
```

이것이 "세 표면이 어긋날 수 없다"는 강력한 불변 조건을 만듭니다. 새 툴을 디스크립터에 추가하면:
- 직접 API가 즉시 노출
- OpenCode 툴 스펙이 자동 생성
- install-check가 자동으로 새 툴을 보고

**드리프트가 구조적으로 불가능**해집니다.

## 레지스트리의 2차 소비: 훅

레지스트리 자체는 아니지만, `createTinyChuPlugin()`은 `registry.tools`를 통해 `hooks`도 정의합니다 (`tiny-plugin.ts:190-203`). 특히 `onSessionIdle` 훅이 `readPlanStatus()`로 계획 상태를 판단하고, `transformUserMessage`가 `ulw`/`ultrawork` 프롬프트에 컨텍스트를 주입합니다. 이 훅들의 자세한 동작은 [05-plugin-and-hooks.md](./05-plugin-and-hooks.md)를 보세요.

## 요약 체크리스트

- [x] 핸들러는 `tiny-plugin.ts`의 평평한 `tools` 맵 한 곳에만 존재
- [x] 디스크립터는 `feature-packages/` 한 곳에만 정의
- [x] 컴포저가 검증(5가지 거부 조건) + 위상 정렬로 단일 레지스트리 생성
- [x] 세 소비 지점(직접 API / OpenCode / install-check)이 동일한 레지스트리 소비
- [x] 출력 예산은 OpenCode 브리지에서만, 직접 API는 전체 객체
- [x] `tiny-plugin.ts`, `plugin.ts`, `install-check.ts`의 **병렬 툴 배열 수동 편집 금지**

## 다음 읽을 문서

- → [03-feature-packages.md](./03-feature-packages.md): 기본 10개 패키지와 옵션 패키지의 실제 의존성 그래프와 위상 정렬 결과를 봅니다.
- → [04-tool-catalog.md](./04-tool-catalog.md): 각 패키지가 담고 있는 기본 85개 툴의 카탈로그.
- → [05-plugin-and-hooks.md](./05-plugin-and-hooks.md): 소비 지점 2(OpenCode 브리지)의 출력 예산과 훅 상세.
