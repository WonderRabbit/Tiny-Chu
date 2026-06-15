# 06. 상태 계층

> 훅과 툴이 읽고 쓰는 **`.tiny/` 상태 계층**을 세세하게 다룹니다. 경로 해석, 원자적 쓰기, JSON 무결성, 그리고 fail-closed 경로 안전 — Tiny-Chu의 가장 강력한 불변 조건들이 여기에 있습니다.

## 디렉터리 레이아웃

모든 런타임 상태는 `.tiny/` 아래에 있습니다. `resolveTinyChuPaths(root)` (`src/state/paths.ts:15`)가 이 경로들을 해석합니다:

```text
<root>/.tiny/
  tasks/              *.json (task) + <id>.checkpoints.jsonl (추가 전용)
  plans/              *.md (체크박스 기반 연속 상태)
  workflows/
    runs/             <runId>.json + <runId>.events.jsonl (workflow source of truth)
    reports/          <runId>/<sequence>-<nodeId>.md (stage report projection)
    definitions/      (예약)
    packets/          (예약)
  public-jobs/        *.json (public worker 큐 패킷)
  rules/              architecture-patterns.md (rules_snapshot이 작성)
  wiki/
    index.json        canonical wiki 번들 선택 기준
  reports/
    git-weekly/       git 주간 보고서 산출물
  ux/                 layout-truth.json (UX 역설계)
  artifacts/
    templates/        산출물 형식 템플릿 오버라이드
  locks/              safe-tooling 단기 변경 잠금
  memory/             (예약)
  boulder.json        (작업 루프 상태)
```

> **산출물 vs 소스**: `.tiny/`, `.omo/`, `.analysis/` 아래의 모든 것은 **생성된 런타임 산출물**입니다. 소스로 취급하지 말고, 명시적으로 요청받지 않는 한 커밋하지 마세요. `.omo/evidence/`에는 QA/성능 관찰 산출물이, `.analysis/`에는 분석 산출물이 있습니다.

## resolveTinyChuPaths — 유일한 경로 해석 함수

```ts
export interface TinyChuPaths {
  root: string;
  tasksDir: string;
  plansDir: string;
  boulderFile: string;
  tinyDir: string;
  publicJobsDir: string;
  workflowsDir: string;
  workflowDefinitionsDir: string;
  workflowRunsDir: string;
  workflowPacketsDir: string;
  workflowReportsDir: string;
  memoryDir: string;
  wikiDir: string;
  wikiIndexFile: string;
}

export function resolveTinyChuPaths(root = process.cwd()): TinyChuPaths {
  const absoluteRoot = path.resolve(root);
  const tinyDir = path.join(absoluteRoot, ".tiny");
  // ...
}
```

**핵심 규칙 (CLAUDE.md)**: `.tiny/` 경로를 수동으로 조립하지 마세요. 항상 `resolveTinyChuPaths(root)`를 통해 얻습니다. 이 함수가 모든 경로를 root-상대적으로 만들고, fail-closed 검사의 기준점을 제공합니다.

## 원자적 파일 쓰기 (`file-store.ts`)

상태 쓰기는 **temp-rename 패턴**으로 원자성을 보장합니다:

```ts
export async function writeJsonAtomic(file, value, options = {}): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`   // 고유 임시 파일
  );
  await writeFile(tmp, `${JSON.stringify(value, null, options.compact ? 0 : 2)}\n`, "utf8");
  await rename(tmp, file);   // 원자적 이름 변경
}
```

왜 이 패턴인가:
1. **부분 쓰기 방지** — 프로세스가 죽어도 임시 파일만 남고, 원본은 온전
2. **PID + UUID** — 다중 프로세스가 동시 써도 임시 파일 충돌 없음
3. **rename의 원자성** — POSIX에서 `rename()`은 원자적이므로, 읽는 쪽은 항상 완전한 파일을 봄

`writeTextAtomic()`도 동일 패턴입니다. 두 함수 모두 JSON을 2-space 들여쓰기로 직렬화하고 끝에 `\n`을 붙입니다 (결정성).

## JSON 읽기와 fail-closed

```ts
export async function readJsonFile<T>(file, fallback): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return fallback;   // 없음 → 폴백
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) throw new MalformedJsonError(file, error);
    throw error;
  }
}
```

**두 가지 구분된 동작**:
- 파일 없음 (`ENOENT`) → 조용히 `fallback` 반환 (정상)
- 파일 있지만 JSON 깨짐 → `MalformedJsonError` throw (**fail-closed**)

```ts
class MalformedJsonError extends Error {
  readonly name = "MalformedJsonError";
  constructor(readonly file: string, cause: SyntaxError) {
    super(`Malformed JSON in ${file}`, { cause });
  }
}
```

> **이것은 짐을 지는(load-bearing) 결정입니다.** CLAUDE.md: "잘못된 형식의 런타임 JSON은 `Malformed JSON in <path>`를 던집니다 — 조용히 건너뛰거나, 다시 쓰거나, 격리하지 않습니다." 잘못된 상태를 숨기는 것보다 명시적으로 실패하는 것이 안전합니다.

### JSONL (체크포인트) 읽기
`readJsonLines()`는 줄 단위로 파싱하며, 어느 줄이든 깨지면 `Malformed JSONL in <file> at line N`을 throw합니다 (`file-store.ts:72`). 체크포인트 추가 전용 로그(`.tiny/tasks/<id>.checkpoints.jsonl`)의 무결성을 보장합니다.

## fail-closed 경로 안전 (`path-safety.ts`)

이것이 Tiny-Chu의 **가장 강력한 보안 불변 조건**입니다. 명시적 사용자/인덱스 경로가 root를 벗어나면 거부합니다.

### 세 가지 해석 함수

```ts
// 1. 어휘적(lexical) 검사 — 심볼릭 링크 미해결
resolvePathInsideRoot(root, candidate): string | undefined

// 2. 어휘적 검사의 불리언 래퍼
isPathInsideRoot(root, candidate): boolean
isLexicallyInsideRoot(root, candidate): boolean   // 동일

// 3. 실제(realpath) 검사 — 심볼릭 링크 해결
async resolveExistingPathInsideRoot(root, candidate): Promise<string | undefined>
```

### `resolvePathInsideRoot` 알고리즘

```ts
export function resolvePathInsideRoot(root, candidate): string | undefined {
  // Windows 절대경로(C:\, UNC)와 POSIX를 분기
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  return isSafeRelative(relative) ? absoluteCandidate : undefined;
}

function isSafeRelative(relative): boolean {
  return relative === ""
    || !(relative === ".."
      || relative.startsWith("../")
      || relative.startsWith("..\\")
      || WINDOWS_ABSOLUTE.test(relative));
}
```

**안전한 상대경로**의 조건:
- 빈 문자열 (root 자체) — 안전
- `..` 또는 `../`, `..\`로 시작 — **위험** (root 탈출)
- Windows 절대경로 (`C:\...`, `\\server\share`) — **위험** (절대 탈출)

### 심볼릭 링크 처리 (중요)

`resolveExistingPathInsideRoot`가 심볼릭 링크를 다룹니다:

```ts
export async function resolveExistingPathInsideRoot(root, candidate): Promise<string | undefined> {
  const lexical = resolvePathInsideRoot(root, candidate);   // 1차: 어휘적 검사
  if (!lexical) return undefined;
  const [realRoot, realCandidate] = await Promise.all([
    realpath(root),       // 심볼릭 링크 해결
    realpath(lexical),
  ]);
  const relative = path.relative(realRoot, realCandidate);
  return isSafeRelative(relative) ? realCandidate : undefined;   // 2차: 실제 검사
}
```

**CLAUDE.md 규칙**:
- **root 바깥 심볼릭 링크** → 건너뜀 (위험)
- **root 안쪽 심볼릭 링크** → 허용

이중 검사(어휘적 + 실제)가 심볼릭 링크를 통한 root 탈출을 막습니다. 예: root 안의 심볼릭 링크가 root 밖을 가리키면 `realpath` 후 `isSafeRelative`가 실패합니다.

### 어디에 적용되나

CLAUDE.md: "명시적 사용자/인덱스 경로 — wiki refs, `git_weekly_report.repoPath`, 마크다운 툴의 `path` 입력 — 은 실제 경로가 설정된 root를 벗어나면 **fail-closed** 합니다."

| 입력 | 검사 |
|------|------|
| `wiki_bundle` refs | root 안 |
| `git_weekly_report.repoPath` | root 안 |
| `mermaid_check`/`mermaid_fix`/`artifact_check`의 `path` | root 안 |
| `context_bundle`/`context_packet` targetPath | root 안 (context-loader에서) |

발견된 컨텍스트/규칙 파일은 **실제 경로가 root 안에 있을 때만** 번들에 포함됩니다.

## TaskStore — 작업 영속성

`TaskStore` (`src/state/task-store.ts`)는 작업 + 체크포인트를 관리합니다.

### 작업 JSON
각 작업은 `.tiny/tasks/<id>.json`으로 저장됩니다. ID는 한 Node 프로세스 내에서 충돌에 강합니다(`task-store.ts`의 시퀀스 기반 ID).

### 체크포인트 JSONL
`task_checkpoint`는 `.tiny/tasks/<id>.checkpoints.jsonl`에 **추가 전용(append-only)** 으로 기록됩니다 (`appendJsonLine`). 각 줄이 하나의 체크포인트입니다:

```jsonc
{
  "summary": "selected source entry points with fd and rg",
  "artifactType": "as_is",
  "passIndex": 3,
  "nextSteps": ["run ast-grep over plugin tools", "ask Qwen for design risks"],
  "evidenceRefs": ["fd://src/**/*.ts", "rg://createTinyChuPlugin"],
  "openQuestions": ["which docs need Mermaid diagrams?"],
  "verificationCommands": ["rg --json createTinyChuPlugin src"]
}
```

> **왜 JSONL인가?** 작업 JSON을 작게 유지하면서 체크포인트 히스토리는 계속 자랄 수 있습니다. `TaskStore.get()`/`list()`는 병합된 체크포인트 히스토리를 반환하면서 메인 작업 JSON은 컴팩트하게 유지합니다.

## PublicDispatcher — worker 큐 + rate gate

`src/dispatcher/public-job.ts`의 `PublicDispatcher`는 public worker 큐와 rate gate를 함께 구현합니다.

### PublicJob 패킷
`.tiny/public-jobs/<id>.json`에 저장되는 패킷 구조 (`public-job.ts:14`):

```ts
interface PublicJob {
  id: string;             // J-<ISO stamp>-<sequence36>
  taskId?: string;
  kind: "public.analysis" | "public.review" | "public.plan";
  status: PublicJobStatus;  // queued|running|checkpointed|retry_wait|done|failed|cancelled
  owner: string;            // 기본 "public-qwen"
  attempt: number;
  createdAt: string;
  updatedAt: string;
  retryAt?: string;
  budget: PublicJobBudget;  // inputTokensMax/outputTokensMax/totalTokensHard
  context: { rulesRefs, wikiRefs, planRef, checkpointSummary, prompt };
  contract: { mustReturn, format, artifactType?, formatTemplate? };
  result?: string;
  error?: string;
}
```

### ID 생성과 검증
```ts
function jobId(now: Date): string {
  nextJobSequence += 1;
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  return `J-${stamp}-${nextJobSequence.toString(36).padStart(4, "0")}`;
}

function assertJobId(id: string): void {
  if (!/^J-[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid public job id: ${id}`);
}
```
- **모듈 시퀀스** (`nextJobSequence`) — 한 프로세스 내 고유성
- **정규식 검증** (`assertJobId`) — 패스 인젝션 방지

> **제한**: `nextJobSequence`는 모듈 변수이므로 **한 Node 프로세스 내에서만** 충돌에 강합니다. 다중 프로세스 호출자는 외부 조정이 필요합니다 (아래 계약 섹션 참조).

### Rate gate (soft/hard RPM/TPM)
```ts
checkRateGate(tokens): RateGateSnapshot {
  // 최근 60초 이벤트만 유지 (슬라이딩 윈도우)
  const cutoff = now.getTime() - 60_000;
  this.events = this.events.filter((event) => Date.parse(event.at) >= cutoff);
  // ...
  if (projectedRequests > this.hardRpm || projectedTokens > this.hardTpm)
    return this.snapshot(..., false, "hard_limit");
  if (projectedRequests > this.softRpm || projectedTokens > this.softTpm)
    return this.snapshot(..., false, "soft_limit");
  return this.snapshot(..., true);
}
```

기본 임계값 (`public-job.ts:108`): softRpm=12, softTpm=14000, hardRpm=16, hardTpm=18000. `TinyChuConfig.publicDispatcher`로 오버라이드 가능.

### 상태 전이
```text
queued ──dispatch──▶ running ──complete──▶ done
                       │   └──cancel──▶ cancelled
                       ├──checkpoint──▶ checkpointed ──▶ (resume)
                       └──retry────▶ retry_wait (백오프: 15/30/60초)
                       └──fail──▶ failed
```

retry 백오프: `attempt`에 따라 15초/30초/60초, 최대 90초 (`public-job.ts:191`).

## 계획 상태 (`ulw-loop/plan.ts`)

`.tiny/plans/*.md`의 Markdown 체크박스가 "boulder" 스타일 작업 루프를 구동합니다.

- `parsePlanMarkdown()` — 체크박스 파싱
- `readPlanStatus(root, planRef)` — `{ complete, open, ... }` 상태 반환
- `selectPlanFocus()` — 다음 작업 항목 선택
- `writePlanTemplate()` — 템플릿 작성

`onSessionIdle` 훅 ([05](./05-plugin-and-hooks.md))이 `readPlanStatus()`로 "계속해야 하나"를 판단합니다. 열린 체크박스가 있으면 `shouldContinue: true`.

## Wiki 번들 (`wiki-bundler.ts`)

`WikiBundler(root)`는 `.tiny/wiki/index.json`을 기준으로 canonical wiki 문서를 선택합니다. `wiki_bundle` 툴이 refs 배열로 문서를 번들링합니다. refs는 root 안에 있어야 합니다 (fail-closed).

## 교차 프로세스 제한 (명시적)

CLAUDE.md가 명시하는 한계:

> **교차 프로세스 파일 잠금 없음.** task/public-job/checkpoint id는 하나의 Node 프로세스 내에서만 충돌에 강합니다. 다중 프로세스 호출자는 외부에서 조정해야 합니다.

- `nextJobSequence` (public-job.ts) — 모듈 변수, 프로세스 내 고유
- task-store의 시퀀스 — 동일

즉, **동일 root에 여러 Node 프로세스가 동시에 쓰면** ID 충돌이나 레이스가 발생할 수 있습니다. 원자적 rename은 부분 쓰기를 막지만, 두 프로세스가 같은 ID를 할당하는 것까지는 막지 못합니다. 단일 프로세스 사용을 가정합니다.

## 상태 무결성 요약 체크리스트

- [x] 모든 경로는 `resolveTinyChuPaths(root)`로 해석 — 수동 조립 금지
- [x] 쓰기는 temp-rename 패턴으로 원자적 (PID+UUID 임시 파일)
- [x] 파일 없음 → 폴백 (정상); JSON 깨짐 → `MalformedJsonError` throw (fail-closed)
- [x] 명시적 경로가 root 벗어나면 undefined 반환 (fail-closed)
- [x] 심볼릭 링크: 어휘적 + 실제 이중 검사; root 밖은 거부, root 안은 허용
- [x] 체크포인트는 JSONL 추가 전용 — 작업 JSON은 컴팩트
- [x] worker ID/시퀀스는 단일 프로세스 내에서만 충돌 회피

## 다음 읽을 문서

- → [07-stability-contracts.md](./07-stability-contracts.md): 이 상태 계층이 지키는 안정성/성능 계약과 한계.
- → [02-registry-pattern.md](./02-registry-pattern.md): install-check가 이 상태 계층 위에서 레지스트리 패리티를 검증.
