# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 리포지토리가 무엇인가

Tiny-Chu는 **파일 기반(file-backed)** 의 가벼운 OpenCode 스타일 오케스트레이션 라이브러리입니다. 로컬 "foreman(작업 총괄)" 모델과 단일 public-worker 디스패치 큐에 필요한 휴대 가능한 원시 기능(primitive)만 담고 있습니다. Team Mode, Hyperplan, Atlas/parallel hooks, 원본 delegate-task 엔진은 **의도적으로 제외**했습니다. npm 라이브러리(`exports: "." → dist/index.js`, `"./opencode" → dist/opencode/plugin.js`)로 배포되며, 동시에 `.opencode/plugins/tiny-chu.ts` 를 통해 프로젝트 로컬 OpenCode 플러그인으로도 로드됩니다.

대상 런타임: **Node ≥ 20.18, ESM 전용, PowerShell 7.6 셸** (오케스트레이션 프로필은 Unix 중심 도구를 *가정하지 않습니다*).

## 빌드 및 테스트

```bash
npm run build          # tsc -p tsconfig.json  →  dist/   (strict, NodeNext, declaration 포함)
npm test               # 빌드 후 node --test test/*.test.mjs 실행
```

**단일 테스트 파일 실행** (반드시 빌드 먼저 — 테스트는 `src/`가 아니라 `../dist/`에서 import합니다):
```bash
npm run build && node --test test/feature-package.test.mjs
```

기타 스크립트:
- `npm run pack:check` — 빌드 후 `test/install-package.test.mjs`만 실행 (패키지/exports 검증)
- `npm run release:offline` / `npm run verify:offline` — 폐쇄망 tarball 번들을 빌드/검증 (`scripts/release/`)
- 성능 베이스라인 (특성화 기준치이지 SLA가 아님): `node scripts/stability-performance-baseline.mjs --out .omo/evidence/...`

테스트는 Node 내장 러너(`node:test` + `node:assert/strict`)를 쓰며 `.mjs`로 작성됩니다. 많은 테스트가 fail-closed 동작을 검증하는 "hardening" 테스트입니다 — 경계/루트 제약 로직을 변경하면 `*-hardening.test.mjs` 와 `architecture-boundary.test.mjs` 가 이를 강제한다는 점을 예상하세요.

## 핵심 아키텍처: 하나의 레지스트리, 세 개의 소비 지점

가장 중요한 패턴은 **feature-package 컴포저(composer)** 입니다. 평평한(flat) 핸들러 맵을 하나의 검증된 레지스트리로 변환하며, 이 레지스트리가 서로 독립적인 세 지점에서 소비됩니다. 거의 모든 것이 이 구조에 매달려 있습니다.

```
createTinyChuPlugin()                      src/opencode/tiny-plugin.ts
  ├─ 평평한 `tools: { [name]: TinyToolHandler }` 정의  (핸들러가 존재하는 유일한 장소)
  └─ createDefaultTinyFeaturePackages(tools)            src/opencode/feature-packages/
        핸들러를 TinyFeaturePackage 디스크립터로 바인딩 (id, dependsOn, tools, resources, …)
  → composeFeaturePackages(packages)                    src/opencode/feature-package.ts
        validateAndOrderFeaturePackages()  →  위상 정렬(topological sort). 다음을 거부:
          중복 패키지 id / 중복 툴 이름 / 누락된 의존성 / 의존성 사이클
        ⇒ TinyComposedRegistry { tools, toolSpecs, packages, nativeToolNames, resources, prompts, instructions }
```

이 레지스트리가 세 소비자의 **단일 진실 공급원(single source of truth)** 입니다:

1. **직접 라이브러리 API** — `tiny.tools[name](input, context)` 가 완전한 구조화 객체를 반환합니다.
2. **OpenCode 플러그인 브리지** — `src/opencode/plugin.ts` 가 `registry.toolSpecs`를 순회하며 각 핸들러를 `tinyTool()` 로 감쌉니다. 입력은 자유 형식 객체이고, 출력은 `renderBudgetedOutput()` 을 통과합니다(`maxOutputChars`/`maxArrayItems` 로 제한, 잘림 메타데이터 포함). 참고: `tiny_chu_install_check`는 더 큰 기본 예산을 갖습니다.
3. **Install-check 진단** — `tiny_chu_install_check`가 `registry.requiredToolNames`, `registry.packages`, `registry.nativeToolNames`를 읽어 패리티(parity)를 검증합니다.

> **핵심 규칙 (README 참조):** 툴/기능을 추가하려면 `src/opencode/feature-packages/` 아래 **하나의** `TinyFeaturePackage` 디스크립터를 추가하거나 확장하고, `src/opencode/feature-packages/default-packages.ts` 의 `createDefaultTinyFeaturePackages()` 를 통해 핸들러를 바인딩한 뒤 컴포저/패리티 테스트를 추가하세요. `tiny-plugin.ts`, `plugin.ts`, `install-check.ts`에서 **병렬 툴 배열을 수동으로 편집하지 마세요** — 이 표면들은 생성된 레지스트리를 소비하며, 수동 편집하면 조용히 어긋나게 됩니다.

## OpenCode 플러그인 훅 (`src/opencode/plugin.ts`)

`TinyChuOpenCodePlugin` 은 네 개의 훅을 반환합니다:
- `tool` — 레지스트리에서 파생된 툴 맵 (위 참조).
- `chat.message` — `ulw`/`ultrawork` 프롬프트에 대해 `transformUserMessage()` 가 `<tiny-chu-context>`, `<tiny-chu-powershell-tooling>`, `<tiny-chu-small-context>` 블록을 덧붙입니다 (`tiny-plugin.ts`에 정의). 다른 프롬프트는 그대로 통과합니다.
- `shell.env` — `TINY_CHU_ROOT` 와 `TINY_CHU_OPENCODE_PLUGIN=1` 을 설정합니다.
- `experimental.session.compacting` — `task_focus_packet` 재개 힌트를 주입합니다.

`.opencode/plugins/tiny-chu.ts` 의 개발용 심(shim)은 **소스**(`../../src/opencode/plugin.ts`)에서 `TinyChuOpenCodePlugin`을 다시 내보냅니다. 따라서 이 리포지토리 루트에서 OpenCode를 실행하면 TypeScript를 직접 실행합니다. 다른 프로젝트에서는 `tiny-chu/opencode`(컴파일된 출력)에 의존하세요 — `INSTALL.md` 참조.

## 안정성 및 루트 제약 계약 (fail-closed)

이것들은 취향이 아니라 **짐을 지는(load-bearing) 불변 조건**입니다:
- **모든 상태는 `.tiny/` 아래**에 있으며, `resolveTinyChuPaths(root)` (`src/state/paths.ts`) 로 해석됩니다. 이 경로를 수동으로 조립하지 마세요.
- **명시적 사용자/인덱스 경로**(wiki refs, `git_weekly_report.repoPath`, 마크다운 툴의 `path` 입력)는 실제 경로가 설정된 루트를 벗어나면 **fail-closed** 합니다 (`src/state/path-safety.ts`). 루트 바깥 심볼릭 링크는 건너뛰고, 루트 안쪽 심볼릭 링크는 허용합니다.
- **잘못된 형식의 런타임 JSON** (`.tiny/tasks/*.json`, `.tiny/public-jobs/*.json`)은 `Malformed JSON in <path>` 를 던집니다 — 조용히 건너뛰거나, 다시 쓰거나, 격리하지 않습니다.
- **교차 프로세스 상태 잠금.** 핵심 `.tiny` writer는 `.tiny/locks/` 아래 directory-based advisory lock으로 직렬화합니다. task/public-job/workflow id는 create lock 안에서 파일 존재 여부를 확인해 할당하고, task/workflow checkpoint sequence와 wiki index read-modify-write는 record/index lock으로 보호합니다. 이 보장은 local filesystem advisory semantics에 한정되며 NFS/분산 파일시스템 안전성을 뜻하지 않습니다.
- `incremental_evidence_cache`는 **소스-해시 출령(staleness)만** 보고합니다 — git dirty-worktree 검사가 아닙니다. 실행자는 직접 `git status`/`git diff`를 실행해야 합니다.

## 런타임 상태 레이아웃 (소스가 아닌 산출물)

```
.tiny/
  tasks/            *.json (task) + <id>.checkpoints.jsonl (추가 전용)
  plans/            *.md  (체크박스 기반 연속 상태, ulw-loop/plan.ts 가 파싱)
  public-jobs/      *.json (public worker 큐 패킷)
  rules/            architecture-patterns.md (rules_snapshot 이 작성)
  wiki/index.json   canonical wiki 번들 선택 기준
  locks/            cross-process advisory lock directory
  reports/git-weekly/, ux/, artifacts/templates/
```

`.tiny/`, `.omo/`, `.analysis/` 아래의 모든 것은 생성된 런타임 산출물입니다 — **소스로 취급하지 말고, 명시적으로 요청받지 않는 한 커밋하지 마세요.** `.omo/evidence/` 에는 QA/성능 관찰 산출물이 있습니다.

## 컨텍스트 우선순위 (`loadContextBundle`, src/context/)

컨텍스트를 번들링할 때 수집 순서가 중요합니다:
1. 대상 경로에서 시작해 상위 디렉터리로 올라가며 발견한 가장 가까운 `AGENTS.md`
2. 프로젝트 규칙 디렉터리 (순서대로): `.tiny/rules` → `.claude/rules` → `.cursor/rules` → `.github/instructions`
3. 단일 규칙 파일 `.github/copilot-instructions.md`

더 하위 디렉터리의 `AGENTS.md` 는 루트 파일보다 더 구체적인 지침을 담아야 합니다.

## 작성 규칙

- **ESM + NodeNext**: 소스가 `.ts`더라도 상대 import에는 명시적으로 `.js` 확장자가 필요합니다.
- **결정론적 출력**: 목록 스캔과 인덱스 직렬화는 정렬된 상태로 유지하세요 — 여러 테스트가 정확한 순서와 정확한 JSON 형태를 단언(assert)합니다. 영속화되는 JSON에는 명시적 `interface`를 사용하세요.
- **최소 의존성**: 런타임 `@opencode-ai/plugin` 과 개발용 `typescript` 뿐입니다. Node 내장 모듈을 선호하고, 명확한 이유 없이 의존성을 추가하지 마세요.
- **라이브 프로바이더 호출 없음**: 오케스트레이션 프로필, agent-model 템플릿, Figma 매핑 키, Qwen 패킷 구성은 **어댑터 대비만 된(adaper-ready) 메타데이터**입니다. Tiny-Chu는 네트워크 API 호출을 하지 않으며, `doctor` 준비 게이트는 로컬 전용입니다.
- **PowerShell 네이티브 툴링 프로필** (`src/opencode/powershell-tooling.ts`): 프로필이 네이티브 CLI 툴을 참조할 때 실제 실행 파일(`jq`, `yq`, `mdq`, `fd`, `ast-grep`, `rg`)을 의미합니다 — PowerShell 별칭이나 Unix 전용 `grep -R`/`find`/`xargs`가 아닙니다.

## 툴 표면

전체 툴 카탈로그(60+ 툴 — `task_*`, `public_*`, `context_*`, `wiki_*`, 레거시 추적성, UX 역설계, button-workflow 강화, 소형 모델 복원력, git 주간 보고서 등)는 `README.md`에 문서화되어 있습니다. 특정 툴 작업 전에 읽어보세요 — 코드 내 핸들러 이름이 문서화된 툴 이름과 1:1로 대응하며, `createTinyChuPlugin()` 의 `tools` 맵에 존재합니다. `AGENTS.md`(한글)는 이 파일의 에이전트 지향 온보딩 동반자입니다.
