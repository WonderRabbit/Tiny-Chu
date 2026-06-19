# 04. 컴포넌트 프로파일 (상세)

이 장은 세 저장소의 구조·인터페이스·진입점을 개별 상세 프로파일로 정리한다. [01-architecture-analysis.md](./01-architecture-analysis.md) 의 요약표를 뒷받침하는 원본 조사 자료다.

---

## 1. Tiny-Chu (host)

### 1.1 목적
Tiny-Chu는 **파일 기반(file-backed)** 의 가벼운 OpenCode 스타일 오케스트레이션 **라이브러리** 다. 로컬 "foreman(작업 총괄)" 소형 모델과 단일 public-worker 디스패치 큐를 운영하는 데 필요한 휴대 가능한 원시 기능(primitive)만 담는다.

- **파일 기반 영속**: 모든 상태는 `.tiny/` 디렉토리에 저장
- **소형 모델 최적화**: Gemma 4-small 급 로컬 모델을 foreman으로 설계
- **public worker 위임**: 큐 패킷으로 대형 모델이 복잡 분석을 처리
- **의도적 최소 범위**: 대형 협업 오케스트레이션, 계층형 계획 엔진, 병렬 hook, delegate-task 엔진은 제외
- **99 tools** across 14 feature packages

### 1.2 기술 스택
- **언어/런타임**: TypeScript(strict, NodeNext) / Node.js ≥ 20.18.0 / ESM-only
- **빌드**: `tsc -p tsconfig.json`
- **셸 환경**: PowerShell 7.6(`pwsh -NoLogo -NoProfile`) 기본, Windows 10 대상. Unix 도구 미가정. 네이티브 도구: `fd`, `rg`, `ast-grep`, `jq`, `yq`, `mdq`, `mmdc`
- **의존성(직접 runtime 3개)**:
  - `@opencode-ai/plugin` ^1.17.4 — OpenCode 플러그인 브리지
  - `@opentui/solid` ^0.3.4 — TUI 대시보드 런타임
  - `typescript` ^6.0.3 — 심볼 추출용 Compiler API
- **엔트리(exports/bin)**:
  - `"."` → `dist/index.js` (메인 라이브러리 API)
  - `"./opencode"` → `dist/opencode/plugin.js` (OpenCode 플러그인)
  - `"./tui"` → `dist/opencode/tui-plugin.js` (TUI 대시보드)
  - `bin.tiny-chu` → `./scripts/tiny-chu.mjs` (CLI 인스톨러)
- **스크립트**: `build`, `test`(빌드 + `node --test test/*.test.mjs`), `naming:check`, `release:offline`

### 1.3 디렉토리 구조 (핵심)
```text
src/
├── context/           # AGENTS.md & 프로젝트 룰 로딩
├── dispatcher/        # public worker 큐 & rate gating
├── markdown/          # Mermaid 검증/수정
├── naming/            # 심볼 네이밍 사전 관리
├── opencode/          # OpenCode 플러그인 인터페이스 & tools
│   ├── feature-packages/   # 핵심: feature package 시스템
│   ├── plugin.ts           # 핵심: OpenCode 플러그인 브리지
│   ├── tiny-plugin.ts      # 핵심: 플러그인 팩토리
│   ├── feature-package*.ts # 패키지 합성
│   └── (분석·상태·TUI·트레이스 확장 모듈들)
├── state/             # 핵심: 상태 관리 계층
│   ├── file-store.ts        # atomic JSON/JSONL
│   ├── lock-store.ts        # advisory directory lock
│   ├── path-safety.ts       # root 경계 강제
│   ├── task-store.ts        # task CRUD + checkpoint
│   └── workflow-*.ts
├── ulw-loop/          # Markdown 계획 파싱
└── wiki/              # wiki 번들 & 검색
templates/  # 설치 템플릿 (opencode package.json, tui.json, plugins shim)
scripts/    # tiny-chu.mjs 인스톨러 등
test/       # node --test
docs/       # 아키텍처 문서 (01~09 + 본 addon-ecosystem/)
.opencode/  # 로컬 OpenCode 플러그인 심
.tiny/      # 런타임 상태 (git 미추적): tasks/, plans/, public-jobs/, wiki/, workflows/, locks/
```

### 1.4 OpenCode 플러그인 인터페이스 (One Registry, Three Consumers)
```text
createTinyChuPlugin()
  → flat tools: { [name]: TinyToolHandler }
  → createDefaultTinyFeaturePackages(tools)
  → composeFeaturePackages(packages)
  → TinyComposedRegistry (단일 진실원)
      ├─ ① 직접 라이브러리 API: tiny.tools[name](input, ctx)
      ├─ ② OpenCode 브리지: registry.toolSpecs → tinyTool() → renderBudgetedOutput()
      └─ ③ install-check 진단: registry.requiredToolNames / packages / nativeToolNames
```

`plugin.ts` 가 반환하는 Hooks: `tool`(93+ 바인딩), `chat.message`(ulw/ultrawork 프롬프트 변환), `shell.env`(TINY_CHU_* 환경변수), `experimental.session.compacting`(task_focus_packet resume hint).

### 1.5 Add-on 매커니즘 — **현재 없음**
- 전통적 add-on/plugin 시스템이 **없다**.
- 대신 **feature package 시스템**(정적 합성) 제공: `TinyFeaturePackage` descriptor(id, version, dependsOn, compatibility, tools, resources, prompts, hooks) 중심.
- 12개 기본 패키지 + 2개 옵션(safe-tooling, native-previews).
- 합성 알고리즘: 검증(중복 ID/tool/누락 의존성/사이클) → 위상정렬(Kahn, 결정론적) → handler 바인딩 → registry 생성.
- **동적 addon 로딩 증거 없음**: 발견 디렉토리·동적 패키지 로딩·addon 등록 API 모두 부재. 정적 합성만 존재.

### 1.6 핵심 패턴
- Feature Package Composer(Template Method) — 단일 registry, 선언적 descriptor
- 파일 기반 상태 관리 — atomic write, advisory lock, fail-closed 경계
- Adapter(OpenCode 브리지) — `tinyTool()` 래핑, output budgeting
- Strategy(런타임 모드) — Mode 1(worker) / Mode 2(orchestrator+worker, 기본)
- Repository(상태 계층) — TaskStore, PublicDispatcher, WikiBundler, WorkflowStore
- Builder(tool seeds) — `readJson()`/`writeState()` 팩토리, permission hint(readOnly/writesState/writesSource)

---

## 2. Tinker.Gen (addon — 안전한 코드 생성)

### 2.1 목적
TypeScript CLI 도구로, 리포지토리 분석과 결정론적 코드 생성 스캐폴딩을 수행한다. Tiny-Chu addon으로 **잘 정의된 통합 계약** 을 통해 결합하도록 설계되었다.

- **결정론적 아키텍처 분석**(선택적 CodeGraph 강화)
- **안전한 코드 생성**(preview/apply 안전 패턴)
- **CLI 기반 단독 동작** → OpenCode/Tiny-Chu에 통합 가능
- **schema-driven artifact** 로 재현 가능한 분석·생성
- **create-only 안전 모델**(체크포인트 검증) — 파괴적 연산 금지

### 2.2 기술 스택
- **언어/런타임**: TypeScript 5.9.3(strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess) / Node ≥ 22.5.0 / ESM
- **빌드**: `tsc`(ES2022, NodeNext) → `dist/`; lint/format은 Biome(ESLint/Prettier 대체); 테스트는 Vitest
- **의존성**: `commander` ^14(CLI), `zod` ^4(스키마 검증), `ignore` ^7(.gitignore 패턴)
- **엔트리**: `bin.tinker` → `./dist/cli.js`

### 2.3 디렉토리 구조 (핵심)
```text
src/
├── analysis/          # 리포 분석 서브시스템
│   ├── builtin-provider.ts   # gitignore 인식 파일 스캐너
│   ├── contracts.ts          # Zod 분석 데이터 계약
│   └── pipeline.ts           # CodeGraph 통합 오케스트레이션
├── apply/             # 안전한 적용 (apply.ts: preview + 안전 검사)
├── codegraph/         # CodeGraph 통합(선택, cli.ts/setup.ts)
├── commands/          # CLI 명령(analyze/apply/codegraph/doctor/generate/
│                      #   integration/plan/preview/schema/common)
├── config/            # 설정 로딩(load.ts) + 스키마(schema.ts)
├── core/              # errors.ts / json.ts / paths.ts
├── generation/        # 결정론적 렌더러(generator.ts) + 매니페스트(manifest.ts)
├── preview/           # preview 생성(contracts.ts + preview.ts)
├── schemas/           # 스키마 레지스트리
└── cli.ts             # 메인 CLI 진입
schemas/               # JSON Schema 정의(analysis-manifest/checkpoint/diagnostics/
                      #   inventory/preview/template-manifest/tinker.config)
integrations/opencode/ # OpenCode/Tiny-Chu 통합 템플릿(현재 템플릿만)
docs/                  # history.md + tinychu-tinkergen-coupling-architecture.md ★
examples/              # component-scaffold.json
tests/                 # analysis/codegraph/config/generation/integration
.tinker/               # 생성 산출물 디렉토리
```

### 2.4 통합 계약 (3계층 adapter)
[01-architecture-analysis.md](./01-architecture-analysis.md) §4 참고. 핵심:
- **직접 import 금지**: Tinker.Gen core는 Tiny-Chu runtime을 import하지 않음
- **descriptor 기반**: Tiny-Chu가 Tinker.Gen의 JSON descriptor를 소비
- **permission 기반 연산**: `tinker_apply`만 `writesSource`, 나머지는 read/writesArtifacts
- **CLI 출력 명령**: `tinker integration opencode print`가 bridge descriptor 생성
  > ⚠️ 문서(`tinychu-tinkergen-coupling-architecture.md`)는 `tinker integration tiny-chu print` 를 규정하나, 실제 구현은 `opencode` 네이밍. **불일치**(C6).

### 2.5 핵심 패턴
- **파이프라인 분석** — Config → CodeGraph 체크 → builtin 분석 → artifact 쓰기. CodeGraph 부재 시 graceful degrade
- **schema-driven 생성** — Template Manifest → `CreateAction[]` → preview → checkpoint → apply. Zod ↔ JSON Schema 정합
- **create-only 안전 모델** — path traversal 방지, symlink 경계, 임시파일 atomic 쓰기, apply lock, 매니페스트 해시 검증
- **선택적 CodeGraph** — CLI 전용 provider, 묵시적 초기화 금지
- **add-on adapter** — host 계약 / bridge descriptor / core CLI 3계층 분리

### 2.6 진입점
`buildProgram()`(`src/cli.ts`)가 등록하는 명령: doctor / schema / analyze / codegraph / plan / generate / preview / apply / integration. **라이브러리 exports 없음**(CLI 전용) → standalone 성격 강조.

---

## 3. ui_pop (addon — UI 와이어프레임 생성)

### 3.1 목적
Node.js/TypeScript CLI 도구로, 소스-퍼스트(source-first) UI 와이어프레임·설계 명세 생성을 수행한다. 레거시 프론트엔드 화면을 대상으로 한다.

- React/Next.js TSX 파일에서 정적 UI 팩트 추출
- 소스 기반 UI 정의 산출물(Markdown, HTML 와이어프레임) 생성
- Playwright 런타임 스냅샷으로 팩트 검증
- 소스 코드 → UI 문서 감사 추적(audit trail)

> ⚠️ **Tiny-Chu와의 통합·addon 관계는 현재 전혀 없다.** 독립 CLI다. (C2)

### 3.2 기술 스택
- **언어/런타임**: TypeScript 5.9.3(strict) / Node ≥ 22 / ESM-only
- **빌드**: `tsup`(ESBuild 래퍼), target node22, ESM 단일 번들
- **품질**: Biome(100자 줄폭, double quotes), Vitest, `zod`
- **의존성**: `ts-morph`(TS AST 분석), `zod`(검증), `playwright`(runtime 검증, devDep)

### 3.3 디렉토리 구조 (핵심)
```text
src/
├── analyzer/
│   └── source-analysis.ts   # 핵심 TSX 분석 로직
├── commands/
│   ├── analyze-source.ts    # 소스 추출
│   ├── draft.ts             # Markdown 생성
│   ├── render-wireframe.ts  # HTML 와이어프레임
│   ├── validate-runtime.ts  # 런타임 검증
│   ├── runtime-evidence.ts
│   └── doctor.ts            # 진단
├── schema/
│   └── ui-ir.ts             # UI 중간 표현(UI-IR) 스키마
├── source-graph/
│   └── source-graph.ts      # import 그래프 순회
├── evidence/
│   └── evidence-sanitizer.ts # 민감정보 리덕션
├── cli.ts                   # 진입점(shebang)
├── cli-core.ts              # CLI 오케스트레이션
├── help.ts / types.ts / exit-codes.ts
tests/   # cli/ integration/ unit/ + fixtures(next-app, failures, malformed)
scripts/ # fixture-runtime.mjs, smoke.mjs
dist/    # 빌드 출력
```

### 3.4 설계 시스템 (DESIGN.md)
- 철학: "주석 달린 구조(annotated structure)" — 모든 UI 표면이 소스 증거·신뢰도 표시
- 기능 중심·문서 지향 와이어프레임(마케팅 페이지 아님)
- 색: Light/Dark 모드 + 상태 색(success/warning/error), 박스 그림자 대신 border 기반 깊이, 4px 기본 간격
- 타이포: system-ui, 12~28px, 표 형 숫자(tabular figures)

### 3.5 통합 계약 — **없음**
- **진입점**: `bin.ui-pop` → `./dist/cli.js`. CLI 명령(`ui-pop analyze-source` / `draft` / `render-wireframe` / `validate-runtime` / `doctor`).
- **라이브러리 exports 없음** — `package.json` exports/main/module 없이 CLI로만 소비.
- **addon/manifest/descriptor 전무** — Tiny-Chu와의 bridge 계약 요소가 하나도 없음.

### 3.6 핵심 패턴
- **핵심 추상: UI-IR**(UI 중간 표현) — `src/schema/ui-ir.ts`의 Zod 검증 JSON. 모든 파생 산출물의 정준 진실원.
- **파이프라인 아키텍처**: 분석(analyze-source) → 생성(draft, render-wireframe) → 검증(validate-runtime)
- **소스 그래프 순회** — bounded import 그래프 워킹(depth/file 제한)
- **증거 기반 신뢰도 시스템** — 3단계: `source-static` / `runtime-confirmed` / `unresolved`. 런타임 검증 시 신뢰도 승격.
- **새니타이즈 파이프라인** — API key/token/password 리덕션, 긴 발췌 truncate

### 3.7 산출 워크플로우
```text
TSX 파일
 ↓ analyze-source
 spec 디렉토리: manifest.json / ui-ir.json / source-graph.json / source-evidence.json
 ↓ draft            → ui.md
 ↓ render-wireframe → wireframe.html
 ↓ validate-runtime → runtime-evidence.json
```

---

## 4. 교차 비교 요약

| 차원 | Tiny-Chu | Tinker.Gen | ui_pop |
|---|---|---|---|
| 정체성 | host / 오케스트레이션 라이브러리 | 안전한 코드 생성 CLI | UI 와이어프레임 생성 CLI |
| addon 계약 구현 | ❌ host contract 미구현 | 🟡 bridge 부분(네이밍 불일치) | ❌ 전무 |
| 상태 디렉토리 | `.tiny/` | `.tinker/` | spec-dir |
| 런타임 | Node ≥20, PowerShell/Win | Node ≥22, POSIX | Node ≥22, POSIX |
| 안전 모델 | fail-closed 경계, lock | create-only, preview/apply | evidence/confidence |
| 진입 형태 | 라이브러리 + 플러그인 | CLI 전용(exports 없음) | CLI 전용(exports 없음) |
| 스키마 | feature-package descriptor | JSON Schema + Zod (`schemaVersion`) | Zod (UI-IR) |
