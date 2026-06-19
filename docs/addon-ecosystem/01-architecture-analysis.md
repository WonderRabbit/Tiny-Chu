# 01. 아키텍처 분석

## 1. 개요

이 장에서는 Tiny-Chu(호스트)·Tinker.Gen(애드온)·ui_pop(애드온)으로 구성하려는 생태계의 **현재 구조(As-Is)** 와 **목표 구조(To-Be)** 를 대비하여 정리한다. 목표 구조는 Tinker.Gen 측 설계 문서(`tinychu-tinkergen-coupling-architecture.md`)를 기준으로 한다.

> 핵심 전제: **Tiny-Chu는 host이고, Tinker.Gen은 generation safety와 CLI/SDK 계약의 소유자다.** CodeGraph 플러그인을 Tiny-Chu 안에 넣거나, Tinker.Gen core가 Tiny-Chu runtime을 import하는 방식은 피한다.

## 2. 현재 상태 (As-Is)

```text
┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│   Tiny-Chu      │  │   Tinker.Gen     │  │     ui_pop      │
│  opencode plugin│  │   CLI: tinker    │  │   CLI: ui-pop   │
│  .tiny/ state   │  │   .tinker/ artf  │  │  spec-dir out   │
│  93+ tools      │  │  analyze→preview │  │ TSX→wireframe   │
│      │          │  │     →apply       │  │ +runtime valid. │
└──────┼──────────┘  └────────┬─────────┘  └────────┬────────┘
       │                      │                     │
       └────── 연결점 없음 ───┴─────────────────────┘
   (각자 별도 빌드/런타임/상태 디렉토리. "add-on"은 아직 작동하지 않음)
```

**현 상태 요약:**

| 항목 | Tiny-Chu | Tinker.Gen | ui_pop |
|---|---|---|---|
| 진입점 | `tiny-chu/opencode` 플러그인 (`src/opencode/plugin.ts`) | `tinker` CLI (`src/cli.ts`) | `ui-pop` CLI (`src/cli.ts`) |
| 상태/산출 | `.tiny/` (atomic write + advisory lock) | `.tinker/` (preview/checkpoint/apply) | spec-dir (ui-ir.md.html.json) |
| 핵심 패턴 | Feature Package Composer (정적 합성) | Create-only Safety (preview→apply) | Evidence/Confidence 파이프라인 |
| 검증 | install-check, doctor | Zod + JSON Schema (`schemaVersion`) | Zod + Playwright runtime 검증 |
| 런타임 | Node ≥20, **PowerShell-first**, Win10 | Node ≥22, ESM, commander | Node ≥22, ESM, tsup |
| 외부 의존 가정 | fd/rg/jq/ast-grep/mmdc | CodeGraph (optional, degrade) | Playwright (optional, validate) |

## 3. 목표 상태 (To-Be)

```text
                  ┌──────────────────────────────────────────┐
   Layer 1        │  Tiny-Chu external-addon host contract    │  ← 현재 미구현(Phase 0)
   (host)         │  ExternalAddonDescriptor / Operation /     │
                  │  Permission + createExternalAddonFeaturePackage()
                  └─────────────────────┬─────────────────────┘
                                        │ descriptor JSON 소비 (runtime import 금지)
            ┌───────────────────────────┴──────────────────────────┐
   Layer 2  │  addon bridge descriptors                              │
   (bridge) │  • addon.tinker-gen  (tinker integration print)   🟡   │
            │  • addon.ui-pop      (ui-pop integration print)   ❌   │
            └───────────────────────────┬──────────────────────────┘
                                        │ CLI shell-out (JSON 경계)
   Layer 3  ┌───────────────────────────┴──────────────────────────┐
   (core)   │  tinker CLI  /  ui-pop CLI   (각자 안전 모델 소유)       │
            └──────────────────────────────────────────────────────┘

   OpenCode 구성: [tiny-chu, tinker-gen bridge, opencode-codegraph] sibling 조합
```

## 4. 3계층 adapter 패턴

목표 아키텍처의 핵심은 **세 책임 계층의 분리** 이다.

### Layer 1 — Addon core package (Tinker.Gen core / ui_pop core)
generation, context, preview, apply, schema validation을 소유한다. **Tiny-Chu runtime에 의존하지 않는다.** 현재는 CLI가 안정 경계이며, 추후 SDK를 열더라도 같은 의미 계약을 유지해야 한다.

### Layer 2 — Tiny-Chu host contract (Tiny-Chu 소유)
특정 addon 이름이나 Tinker.Gen business logic을 모르고, descriptor를 `TinyFeaturePackage` 로 변환하는 타입과 helper만 제공한다.

```ts
export interface ExternalAddonDescriptor {
  id: string;
  title: string;
  nativeCommand?: string;
  operations: readonly ExternalAddonOperation[];
  requiredNativeTools?: readonly string[];
  compatibility?: TinyCompatibilitySpec;
}

export interface ExternalAddonOperation {
  name: string;
  description: string;
  args?: readonly string[];
  permission: ExternalAddonPermission;
  output?: "json" | "markdown" | "text";
}

export type ExternalAddonPermission =
  | "read"
  | "writesArtifacts"
  | "writesSource"
  | "network";

export function createExternalAddonFeaturePackage(
  descriptor: ExternalAddonDescriptor,
  handlers: Record<string, TinyToolHandler>,
): TinyFeaturePackage;
```

이 helper는 permission을 `TinyPermissionHint` 로 매핑하고, native command는 install-check metadata로 전달한다. handler 누락·tool name 중복·잘못된 descriptor는 기존 `composeFeaturePackages()` 검증 경로에서 실패하게 둔다.

### Layer 3 — Addon bridge descriptor (addon 측 소유)
Tinker.Gen이 소유하거나 그 옆의 작은 bridge package가 소유하는 계층. Tiny-Chu host contract에 맞는 descriptor와 handler binding을 제공한다. 이 계층만 addon command 의미를 Tiny-Chu tool metadata로 번역한다.

권장 출력 명령:

```text
tinker integration tiny-chu print
ui-pop integration tiny-chu print   (ui_pop은 아직 미구현)
```

## 5. 핵심 디자인 원칙

1. **단방향 의존** — addon core는 host runtime을 import하지 않는다.
2. **descriptor 기반 통합** — host는 addon 이름·로직을 모르고 descriptor만 소비한다.
3. **permission 게이트** — `read` / `writesArtifacts` / `writesSource` / `network`. source write는 **오직 apply 경계에서만**.
4. **CLI/JSON 경계** — 동적 import 대신 CLI shell-out으로 provenance를 보존한다.
5. **sibling composition** — OpenCode config에서 host·bridge·codegraph를 sibling 플러그인으로 조합한다. 누구도 다른 것을 vendoring/소유하지 않는다.

## 6. Tinker.Gen operation 매트릭스 (설계 기준)

| operation | CLI 명령 | permission | 결과 |
|---|---|---|---|
| `tinker_doctor` | `tinker doctor --json` | `read` | 설치/설정 상태 JSON |
| `tinker_analyze` | `tinker analyze --no-codegraph --project <path> --out <dir>` | `writesArtifacts` | inventory, diagnostics, analysis manifest |
| `tinker_context_generation` | `tinker context generation --project <path> --out <dir> [--codegraph]` | `writesArtifacts` | generation-context artifact |
| `tinker_plan` | `tinker plan --manifest <manifest> --out <dir>` | `writesArtifacts` | template manifest / plan artifact |
| `tinker_preview` | `tinker preview --manifest <manifest> --out <dir>` | `writesArtifacts` | preview/checkpoint JSON |
| `tinker_apply` | `tinker apply --preview <id> --out <dir>` | `writesSource` | preview 검증 후 source write |

> `tinker_apply` 는 반드시 source-writing permission으로 표시한다. QA는 temp workspace에서만 실행하고 사용자 실제 workspace에 destructive apply를 수행하지 않는다.

## 7. 구현 상태 검증 (2026-06-19)

| 검증 항목 | 결과 |
|---|---|
| Tiny-Chu `src/` 에 `ExternalAddonDescriptor` / `createExternalAddonFeaturePackage` / `writesArtifacts` / `writesSource` 구현 | ❌ **0건** (grep 교차 검증) |
| Tiny-Chu 동적 addon 발견/로딩 매커니즘 | ❌ 없음 (정적 feature-package 합성만 존재) |
| Tinker.Gen bridge descriptor 출력 | 🟡 부분 — 단 명령명 `integration opencode print` 로 문서(`integration tiny-chu print`)와 불일치 |
| ui_pop descriptor / integration 명령 | ❌ 전무 |

세 신호(설계 문서의 Phase-0 "추가한다" 표현 + 탐색 결과 "addon 매커니즘 없음" + grep 0건)가 일치한다.

## 8. 다음

- 이 아키텍처가 만들어내는 요구사항: [02-requirements.md](./02-requirements.md)
- 장점·단점·개선점: [03-gaps-and-improvements.md](./03-gaps-and-improvements.md)
