# 13. 상태 무결성과 동시성 계획

## 문제 정의

Tiny-Chu의 핵심 비기능 요구사항은 파일 기반 상태를 안전하고 결정적으로 다루는 것이다. `.tiny/tasks`, `.tiny/public-jobs`, `.tiny/workflows`, `.tiny/wiki`는 모두 로컬 파일 시스템을 source of truth로 삼는다 ([README.md](../../README.md), `README.md:44`, `README.md:50`). `file-store.ts`는 malformed JSON을 throw하고 atomic write를 제공한다 ([src/state/file-store.ts](../../src/state/file-store.ts), `src/state/file-store.ts:21`, `src/state/file-store.ts:37`).

현재 lock layer도 존재한다. lock owner는 pid, hostname, lease 시간을 기록하고 ([src/state/lock-store.ts](../../src/state/lock-store.ts), `src/state/lock-store.ts:13`), `.tiny/locks` root가 symlink가 아닌 안전한 directory인지 확인한다 (`src/state/lock-store.ts:95`). 다만 각 store가 어떤 lock scope를 쓰는지, lock 없이 읽어도 되는 경로가 어디인지, stale lock 회복 후 어떤 검증을 해야 하는지는 건별로 흩어질 수 있다.

## 개선 목표

- `.tiny/` writer의 lock scope를 표준화한다.
- JSON/JSONL/Markdown projection의 원자적 쓰기와 readback 검증 정책을 문서화하고 테스트한다.
- workflow source of truth와 report projection이 어긋나는 경우를 탐지한다.
- Windows filesystem retry 정책을 state layer 표준 정책으로 승격한다.

## 구조 변경안

1. `src/state/state-transaction.ts` 내부 모듈을 만든다.
   - `withTinyStateWriteLock(root, scope, operation)`
   - `writeJsonWithReadback(file, value)`
   - `writeTextWithReadback(file, text)`
   - `appendJsonLineWithIntegrityCheck(file, event)`
2. task/public/workflow/wiki writer가 직접 lock-store/file-store를 조합하지 않고 transaction helper를 사용하게 한다.
3. `WorkflowStore`는 run JSON과 report projection의 write order를 명시한다.
4. stale lock reap 이후에는 해당 scope의 JSON parse/readback smoke를 실행한다.

## 단계별 실행 계획

### 1단계: writer inventory

- `.tiny/`에 쓰는 모든 함수 목록을 만든다.
- 각 writer를 `task`, `public-job`, `workflow-run`, `workflow-report`, `wiki`, `artifact`, `lock` scope로 분류한다.
- lock 없이 써도 되는 생성물과 반드시 lock이 필요한 source-of-truth를 구분한다.

### 2단계: transaction helper 도입

- 기존 `writeJsonAtomic()`의 동작은 유지하되 readback helper를 추가한다.
- lock 획득/해제 실패, stale lock, compromised lock을 표준 diagnostic code로 변환한다.
- Windows retry는 lock-store의 retry helper와 중복되지 않게 state transaction으로 이동하거나 명시적으로 재사용한다.

### 3단계: store별 적용

- `TaskStore`, `PublicDispatcher`, `WorkflowStore`, wiki storage 순서로 적용한다.
- 각 단계마다 기존 hardening test에 동시 writer fixture를 추가한다.
- workflow는 `WorkflowRun.stateRef`, `planRef`, report projection이 모두 같은 run id를 가리키는지 검사한다 ([src/state/workflow-types.ts](../../src/state/workflow-types.ts), `src/state/workflow-types.ts:70`, `src/state/workflow-types.ts:78`).

## 수용 기준

- 모든 source-of-truth writer는 명시적 scope lock을 사용한다.
- corrupted JSON/JSONL은 조용히 fallback하지 않는다.
- stale lock 회복 path가 테스트된다.
- Windows와 POSIX path 모두에서 root escape와 symlink writer가 fail-closed로 남는다.

## 위험과 완화

- 위험: 모든 writer에 lock을 추가하면 단일 로컬 사용에서도 느려질 수 있다.
- 완화: lock scope를 coarse하게 두지 않고 source-of-truth 단위로 분리한다.
- 위험: projection write 실패가 source-of-truth 실패처럼 처리될 수 있다.
- 완화: run JSON은 hard source, report markdown은 derived projection으로 분리하고 재생성 가능성을 명시한다.

## 하지 않을 것

- SQLite나 외부 DB를 도입하지 않는다.
- 분산 lock을 구현하지 않는다.
- 대형 협업 오케스트레이션 수준의 다중 worker scheduler를 추가하지 않는다.
