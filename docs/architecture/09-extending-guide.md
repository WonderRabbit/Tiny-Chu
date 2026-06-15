# 09. 확장 가이드

> Tiny-Chu에 새 툴이나 패키지를 추가하는 **올바른 절차**를 다룹니다. 핵심은 [02-registry-pattern.md](./02-registry-pattern.md)의 "편집이 아니라 생성" 원칙을 존중하는 것입니다.

## 가장 중요한 규칙

CLAUDE.md가 명시하는 핵심 규칙:

> 툴/기능을 추가하려면 `src/opencode/feature-packages/` 아래 **하나의** `TinyFeaturePackage` 디스크립터를 추가하거나 확장하고, `src/opencode/feature-packages/default-packages.ts`의 `createDefaultTinyFeaturePackages()`를 통해 핸들러를 바인딩한 뒤 컴포저/패리티 테스트를 추가하세요. `tiny-plugin.ts`, `plugin.ts`, `install-check.ts`에서 **병렬 툴 배열을 수동으로 편집하지 마세요**.

### ❌ 절대 하지 말 것
```ts
// tiny-plugin.ts
const LIB_TOOLS = ["task_create", ..., "my_new_tool"];   // ❌

// plugin.ts
const OPENCODE_TOOLS = ["task_create", ..., "my_new_tool"];  // ❌

// install-check.ts
const INSTALL_TOOLS = ["task_create", ..., "my_new_tool"];   // ❌
```
세 곳을 수동으로 맞추는 것은 inevitably 어긋납니다.

### ✅ 올바른 방법
한 곳(디스크립터)만 편집하면 세 소비 지점이 자동 동기화됩니다.

## 절차 A: 기존 패키지에 툴 추가

가장 흔한 경우. 예: `small-model-resilience` 패키지에 새 툴 추가.

### 단계 1 — 핸들러 구현 (`tiny-plugin.ts`)
`createTinyChuPlugin()`의 `tools` 맵에 핸들러를 추가합니다:

```ts
// src/opencode/tiny-plugin.ts (tools 맵 안에)
my_new_tool: async (input) => createMyNewTool(resolveTinyChuPaths(root).root, input),
```

핸들러 시그니처: `(input: Record<string, unknown>, context?: TinyToolContext) => Promise<unknown>`. 입력은 자유 형식 객체이므로 `stringInput()`/`numberInput()`으로 검증합니다.

### 단계 2 — 툴 시드 추가 (`default-tool-seeds.ts`)
해당 패키지의 툴 배열에 `ToolSeed`를 추가:

```ts
// src/opencode/feature-packages/default-tool-seeds.ts
export const SMALL_MODEL_TOOLS: readonly ToolSeed[] = [
  // ... 기존 툴
  readJson("my_new_tool", "My new tool's description.", ["rg"]),  // 네이티브 툴 필요 시
];
```

`tool-seed.ts`의 팩토리 중 하나를 선택:
- `readJson(name, desc, natives?)` — 읽기 전용 JSON
- `writeState(name, desc)` — `.tiny/` 상태 쓰기
- `writeMarkdown(name, desc)` — 산출물 Markdown 쓰기
- `writeSource(name, desc)` — 소스 쓰기 (safe-tooling만)
- `markdown(name, desc)` — 읽기 전용 Markdown

### 단계 3 — 빌드 및 검증
```bash
npm run build && npm test
```

`bindToolHandler()` (`default-packages.ts:42`)가 시드와 핸들러를 연결합니다. 이름 불일치 시 `invalid_tool` 에러로 즉시 실패합니다.

### 단계 4 — install-check 확인
```bash
node --input-type=module -e "
  import { createTinyChuPlugin } from './dist/index.js';
  const tiny = createTinyChuPlugin();
  console.log(tiny.registry.requiredToolNames.includes('my_new_tool'));
"
```
세 소비 지점이 자동으로 새 툴을 인식합니다.

## 절차 B: 새 패키지 추가

새 기능 영역을 추가할 때. 예: `tiny-chu.metrics-export` 패키지.

### 단계 1 — 핸들러 구현 (`tiny-plugin.ts`)
절차 A의 단계 1과 동일하게 `tools` 맵에 핸들러 추가.

### 단계 2 — 툴 시드 배열 생성 (`default-tool-seeds.ts`)
```ts
export const METRICS_TOOLS: readonly ToolSeed[] = [
  readJson("metrics_collect", "Collect bounded metrics.", ["rg"]),
  writeState("metrics_snapshot", "Write metrics snapshot."),
];
```

### 단계 3 — 패키지 시드 추가 (`default-package-seeds.ts`)
`DEFAULT_PACKAGE_SEEDS`에 `PackageSeed` 추가:

```ts
// src/opencode/feature-packages/default-package-seeds.ts
import { METRICS_TOOLS } from "./default-tool-seeds.js";

export const DEFAULT_PACKAGE_SEEDS: readonly PackageSeed[] = [
  // ... 기존 패키지
  {
    id: "tiny-chu.metrics-export",
    title: "Metrics Export",
    category: "extension-utilities",   // 또는 새 카테고리 (feature-package-types.ts에 추가 필요)
    dependsOn: ["tiny-chu.core-runtime", "tiny-chu.shared-support"],  // 의존성 명시
    tools: METRICS_TOOLS,
    resources: [
      resource("metrics-state", "Metrics collection and snapshot state.", "src/opencode"),
    ],
    instructions: [instruction("metrics-rule", "Metrics tools must stay read-only except snapshot.")],
  },
];
```

### 단계 4 — 카테고리 확인
새 카테고리가 필요하면 `feature-package-types.ts:3`의 `TinyFeatureCategory` 유니언에 추가. 기존 카테고리 중 적절한 것이 있으면 재사용.

### 단계 5 — 의존성 그래프 검증
의존성이 `DEFAULT_PACKAGE_SEEDS`에 정의된 패키지만 가리키는지 확인. 사이클이 없어야 함 (컴포저가 `dependency_cycle` 에러로 거부).

### 단계 6 — 빌드 및 테스트
```bash
npm run build && npm test
```

위상 정렬이 새 패키지를 올바른 위치에 배치합니다. `host-opencode`는 모든 기능 패키지에 의존하므로, 새 패키지가 `host-opencode`보다 **앞에** 와야 한다면 명시적 의존성이 필요 없을 수 있습니다 (host-opencode가 개별 기능 패키지를 의존하는 구조이므로).

## 절차 C: 옵션(safe) 패키지 추가

`config.safeTooling: true`에서만 활성화되는 패키지.

### 단계
1. `SAFE_TOOLING_PACKAGE_SEEDS` (`default-package-seeds.ts:89`)에 패키지 추가
2. `default-packages.ts:12`의 필터 로직 확인 — `nativePreviews`처럼 추가 조건이 필요하면 필터 업데이트
3. 기본 패키지와 옵션 패키지가 **같은 툴명**을 가지지 않도록 주의 (`duplicate_tool_name` 에러)

```ts
// default-packages.ts의 포함 로직
const seeds = options.safeTooling === true
  ? [...DEFAULT_PACKAGE_SEEDS, ...SAFE_TOOLING_PACKAGE_SEEDS.filter(
      (seed) => seed.id !== "tiny-chu.native-previews" || options.nativePreviews === true
    )]
  : DEFAULT_PACKAGE_SEEDS;
```

## 절차 D: 새 inputSchema 추가 (safe-tooling 스타일)

대부분의 툴은 자유 형식 입력이지만, 고위험 툴은 상세 스키마가 필요합니다.

```ts
// default-tool-seeds.ts
export const SAFE_TOOLING_TOOLS: readonly ToolSeed[] = [
  {
    ...readJson("safe_patch_check", "Validate ...", ["git"]),
    inputSchema: {
      type: "object",
      properties: {
        patch: STRING_SCHEMA,
        allowedTargets: STRING_ARRAY_SCHEMA,
        expectedFiles: OBJECT_SCHEMA,
      },
      required: ["patch", "allowedTargets", "expectedFiles"],
    },
  },
];
```

스프레드(`...readJson(...)`)로 기본 메타데이터를 가져오고 `inputSchema`만 덮어씁니다.

## 패키지 설계 원칙 (훌륭한 디스크립터를 위해)

### 1. 단일 책임
각 패키지는 하나의 응집된 기능 영역. `core-runtime`(상태), `legacy-analysis`(추적), `ux-reverse-engineering`(UX)처럼 명확한 경계.

### 2. 의존성 최소
`dependsOn`은 꼭 필요한 패키지만. 모든 것이 `core-runtime` + `shared-support`에 의존하는 것은 정상이지만, 그 이상은 신중하게.

### 3. 네이티브 툴 정확성
`requiredNativeTools`는 실제로 필요한 CLI만. 과잉 선언하면 `environment_doctor`가 거짓 경고. 누락하면 런타임 실패.

### 4. 권한 힌트 정확성
- 읽기만 → `readJson` (`readOnly: true`)
- `.tiny/` 쓰기 → `writeState` (`writesState: true`)
- 산출물 쓰기 → `writeMarkdown` (`writesArtifacts: true`)
- 소스 쓰기 → `writeSource` (`writesSource: true`, safe-tooling만)

권한 힌트는 메타데이터지만, 미래 권한 게이트의 기반이므로 정확해야 합니다.

### 5. 툴명 규칙
- 스네이크케이스 (`my_new_tool`)
- 동사_명사 또는 명사_동사 일관성 (`task_create`, `public_dispatch`, `layout_truth_update`)
- 접두사로 도메인 표시 (`button_*`, `layout_truth_*`, `ux_*`)

## 검증 체크리스트

새 툴/패키지 추가 후:

- [ ] `npm run build` 성공
- [ ] `npm test` 통과 — 특히 `feature-package.test.mjs`, `*-hardening.test.mjs`
- [ ] `tiny_chu_install_check`가 새 툴을 보고
- [ ] 직접 API(`tiny.tools[name]`)에서 호출 가능
- [ ] OpenCode 브리지에서 출력 예산 적용 확인
- [ ] `registry.requiredToolNames`에 새 툴 포함
- [ ] `registry.packages`에 새 패키지 요약 포함 (패키지 추가 시)
- [ ] 위상 정렬 순서가 의존성을 존중
- [ ] 중복 툴명 없음 (`duplicate_tool_name` 에러 안 남)
- [ ] 의존성 사이클 없음 (`dependency_cycle` 에러 안 남)

## 테스트 추가 가이드

### 컴포저/패리티 테스트
`test/feature-package.test.mjs` (또는 유사)에 추가:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeFeaturePackages } from "../dist/opencode/feature-package.js";
import { createDefaultTinyFeaturePackages } from "../dist/opencode/feature-packages/default-packages.js";

test("my_new_tool appears in registry", () => {
  const noop = async () => undefined;
  const handlers = new Proxy({}, { get: () => noop });
  const packages = createDefaultTinyFeaturePackages(handlers);
  const registry = composeFeaturePackages(packages);
  assert.ok(registry.requiredToolNames.includes("my_new_tool"));
});
```

### 하드닝 테스트 (필요 시)
경계 조건을 다루면 `test/*-hardening.test.mjs`에 추가:
- 중복 툴명 → 에러
- 의존성 사이클 → 에러
- 누락 핸들러 → `invalid_tool` 에러

## 절대 손대지 말 것 (수동 편집 금지 영역)

이 파일들은 생성된 레지스트리를 소비하므로, **수동으로 툴 배열을 편집하지 마세요**:

| 파일 | 소비 형태 |
|------|----------|
| `src/opencode/tiny-plugin.ts` | `tools` 맵은 핸들러만; 레지스트리는 컴포저가 생성 |
| `src/opencode/plugin.ts` | `registry.toolSpecs` 순회로 `toolMap` 생성 |
| `src/opencode/install-check.ts` | `registry.requiredToolNames`/`packages`/`nativeToolNames` 소비 |

예외: `tools` 맵에 **핸들러를 추가하는 것**은 `tiny-plugin.ts`에서 유일하게 허용되는 편집입니다. 핸들러는 이 맵에만 존재해야 합니다.

## FAQ

### Q: 툴을 동적으로 비활성화하고 싶다면?
현재 불가능. README: "기본 기능 패키지의 런타임 비활성화"는 Phase 1에서 제외. 모든 기본 툴은 항상 노출됩니다. `safeTooling`만 설정 기반 옵트인/아웃을 지원.

### Q: 외부 MCP 서버를 어댑터로 추가하고 싶다면?
현재 불가능. "MCP 서버 어댑터"는 Phase 1에서 제외. Tiny-Chu는 자체 툴만 노출합니다.

### Q: 새 패키지를 npm 서브패키지로 분리하고 싶다면?
현재 불가능. "npm 서브패키지 로딩"은 Phase 1에서 제외. 모든 패키지는 단일 `tiny-chu` 패키지 안에 있습니다.

### Q: 동적 패키지 디스커버리(플러그인 폴더 스캔)를 원한다면?
현재 불가능. 패키지는 `default-package-seeds.ts`에 정적으로 선언됩니다. 동적 디스커버리는 향후 단계.

### Q: 의존성을 런타임에 추가하고 싶다면?
의존성은 **컴파일/컴포즈 시점**에 해석됩니다. 런타임 동적 의존성은 지원되지 않습니다. `dependsOn`은 정적 문자열 배열입니다.

## 마무리

Tiny-Chu를 확장할 때 기억할 한 문장:

> **한 곳을 편집하고, 세 곳이 자동으로 따르게 하라.**

디스크립터(`feature-packages/`)와 핸들러(`tiny-plugin.ts`의 `tools`)가 그 "한 곳"입니다. 나머지는 생성된 레지스트리를 소비합니다. 이 원칙을 지키면 Tiny-Chu의 가장 강력한 불변 조건 — 세 표면 간 드리프트 불가능 — 을 유지할 수 있습니다.

## 추가 자료

- [02-registry-pattern.md](./02-registry-pattern.md) — 왜 이 절차가 올바른지의 근거
- [03-feature-packages.md](./03-feature-packages.md) — 기존 패키지 그래프와 카테고리
- [04-tool-catalog.md](./04-tool-catalog.md) — 툴명/권한/네이티브 툴 참고
- [07-stability-contracts.md](./07-stability-contracts.md) — 확장 시 지켜야 할 계약
- [08-design-decisions.md](./08-design-decisions.md) — 제외된 기능과 그 이유
- 루트 `CLAUDE.md` / `AGENTS.md` — 작성 규칙과 기여 가이드
