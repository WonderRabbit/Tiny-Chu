# AGENTS.md

## 리포지토리 개요

Tiny Infi는 OpenCode 스타일의 에이전트 작업 흐름에서 필요한 최소한의 파일 기반 오케스트레이션 기능을 제공하는 작은 TypeScript 라이브러리입니다.

이 리포지토리는 다음 기능에 집중합니다.

- 가장 가까운 `AGENTS.md`와 프로젝트 규칙 파일을 모아 컨텍스트 번들을 구성합니다.
- `.omo/tasks/` 아래에 작업 상태를 JSON 파일로 저장합니다.
- `.omo/plans/` 아래의 Markdown 체크박스 계획을 읽고 진행 상태를 판단합니다.
- `.tiny-infi/public-jobs/` 아래에 public worker용 작업 큐 패킷을 저장합니다.
- `.tiny-infi/wiki/index.json`을 기준으로 canonical wiki 문서를 선택하고 번들링합니다.
- `createTinyInfiPlugin()`을 통해 task, public job, context, wiki 관련 도구를 노출합니다.

Team Mode, Hyperplan, Atlas/parallel hooks, 원본 delegate-task 엔진과 같은 큰 오케스트레이션 시스템은 의도적으로 포함하지 않습니다.

## 프로젝트 구조

```text
src/
  context/      AGENTS.md 및 프로젝트 규칙 컨텍스트 로딩
  dispatcher/   public worker 작업 큐와 rate gate 처리
  opencode/     Tiny Infi 플러그인 셸 및 OpenCode 런타임 메타데이터
  state/        경로 해석, JSON 저장소, 작업 저장소
  ulw-loop/     Markdown 계획 파싱 및 이어서 실행할 상태 판단
  wiki/         wiki index 및 canonical 문서 번들링

test/
  tiny-infi.test.mjs

README.md
package.json
tsconfig.json
```

## 주요 진입점

공개 API는 다음 파일에서 다시 export됩니다.

```text
src/index.ts
```

주요 export 항목은 다음과 같습니다.

- `createTinyInfiPlugin`
- `POWERSHELL_OPENCODE_RUNTIME`
- `loadContextBundle`
- `TaskStore`
- `PublicDispatcher`
- `parsePlanMarkdown`
- `readPlanStatus`
- `writePlanTemplate`
- `WikiBundler`
- `resolveTinyInfiPaths`

## 빌드 및 테스트 명령

`package.json`에 정의된 npm script를 사용합니다.

```bash
npm run build
npm test
```

`npm test`는 먼저 TypeScript 빌드를 실행한 뒤 Node.js 내장 test runner로 `test/*.test.mjs`를 실행합니다.

## 리포지토리 파악 절차

이 리포지토리를 처음 파악할 때는 아래 순서를 권장합니다.

1. `README.md`를 읽어 프로젝트의 의도, 범위, 런타임 동작을 확인합니다.
2. `package.json`을 읽어 패키지 메타데이터, script, 모듈 형식을 확인합니다.
3. `src/index.ts`를 읽어 공개 API 표면을 파악합니다.
4. 도메인별 구현 파일을 확인합니다.
   - `src/context/context-loader.ts`
   - `src/state/task-store.ts`
   - `src/dispatcher/public-job.ts`
   - `src/ulw-loop/plan.ts`
   - `src/wiki/wiki-bundler.ts`
   - `src/opencode/tiny-plugin.ts`
5. `test/tiny-infi.test.mjs`를 읽어 기대 동작을 테스트 관점에서 확인합니다.
6. 필요하면 런타임 상태 디렉터리 존재 여부를 확인합니다.
   - `.omo/tasks/`
   - `.omo/plans/`
   - `.omo/rules/`
   - `.tiny-infi/public-jobs/`
   - `.tiny-infi/wiki/index.json`

## 코드 작성 규칙

- TypeScript와 ES modules 방식을 유지합니다.
- 공개 API와 내부 구조는 작고 명확하게 유지합니다.
- 저장되는 JSON 구조에는 명시적인 TypeScript interface를 선호합니다.
- 파일 목록 조회, index 직렬화, 테스트 결과가 결정적으로 나오도록 정렬을 유지합니다.
- 가능하면 Node.js 내장 모듈을 사용합니다.
- 명확한 필요가 없으면 외부 의존성을 추가하지 않습니다.
- 상태 경로는 `resolveTinyInfiPaths()`를 통해 해석합니다.

## 컨텍스트 및 규칙 우선순위

`loadContextBundle()`은 다음 순서로 컨텍스트를 수집합니다.

1. 대상 경로에서 시작해 상위 디렉터리로 올라가며 발견한 가장 가까운 `AGENTS.md`
2. 프로젝트 규칙 디렉터리
   - `.omo/rules`
   - `.claude/rules`
   - `.cursor/rules`
   - `.github/instructions`
3. 단일 규칙 파일
   - `.github/copilot-instructions.md`

더 하위 디렉터리에 있는 `AGENTS.md`는 이 루트 파일보다 더 구체적인 지침을 담아야 합니다.

## 상태 저장 레이아웃

Tiny Infi는 로컬 오케스트레이션 상태를 다음 위치에 기록합니다.

```text
.omo/
  plans/
  tasks/

.tiny-infi/
  public-jobs/
  wiki/
    index.json
```

작업이 명시적으로 런타임 상태를 다루는 경우가 아니라면 위 디렉터리의 생성물은 소스 코드 변경으로 취급하지 않습니다.

## 테스트 기대사항

동작을 변경했다면 다음을 수행합니다.

1. `test/tiny-infi.test.mjs`에 테스트를 추가하거나 기존 테스트를 갱신합니다.
2. 아래 명령을 실행합니다.

```bash
npm test
```

타입이나 export 표면만 변경했다면 최소한 아래 명령을 실행합니다.

```bash
npm run build
```

## 향후 에이전트를 위한 메모

- 이 리포지토리는 의도적으로 작게 유지됩니다. 큰 추상화는 피합니다.
- 변경 전에는 정적 분석으로 구조와 영향 범위를 먼저 파악합니다.
- 명시적인 요청이 없다면 생성된 런타임 상태나 임시 산출물은 커밋하지 않습니다.
- 새 공개 API를 추가할 때는 `src/index.ts`에서 export하고 테스트로 보장합니다.
