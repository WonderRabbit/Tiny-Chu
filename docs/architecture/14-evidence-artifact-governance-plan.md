# 14. Evidence와 Artifact Governance 계획

## 문제 정의

현재 프로젝트는 evidence, artifact, report, docs sync, small-model replay, naming dictionary처럼 "검증 가능한 산출물"의 범위가 upstream main보다 넓어졌다. Artifact contract는 artifact type별 required section과 citation rule을 갖고 있다 ([src/opencode/artifact-contract.ts](../../src/opencode/artifact-contract.ts), `src/opencode/artifact-contract.ts:60`). README도 evidence, doctor 계열 도구가 public tool surface에 포함된다고 설명한다 ([README.md](../../README.md), `README.md:51`).

그러나 artifact type, evidence refs, report path, docs sync test가 각각 별도 규칙으로 늘어나면 "어떤 산출물이 어떤 증거로 검증되었는가"를 추적하기 어렵다. 이 문제는 특히 작은 모델이 생성한 보고서와 계획 문서에서 중요하다.

## 개선 목표

- evidence/report/artifact를 하나의 governance taxonomy로 묶는다.
- artifact contract와 tool registry를 연결한다.
- docs/architecture, docs/feature, docs/reports 문서가 각자의 검증 책임을 명확히 가진다.
- "증거 없는 성공 주장"을 제품 도구와 문서 테스트 양쪽에서 차단한다.

## 구조 변경안

1. `src/opencode/evidence-governance.ts` 내부 모듈을 만든다.
2. governance record schema를 정의한다.
   - `artifactKind`
   - `producerTool`
   - `sourceRefs`
   - `evidenceRefs`
   - `validationStatus`
   - `generatedAt`
3. `artifact_check`, `evidence_gate`, `claim_evidence_check`, `small_model_replay`가 같은 diagnostic vocabulary를 쓰게 한다.
4. `docs/architecture` 문서에는 "설계 근거", "구조 변경안", "수용 기준", "하지 않을 것" 섹션을 표준으로 둔다.
5. docs sync test는 문서 존재만 보지 않고 registry/tool/artifact contract와 상호 참조를 검사한다.

## 단계별 실행 계획

### 1단계: 산출물 taxonomy 고정

- 현재 artifact types를 그대로 출발점으로 삼는다.
- docs category를 추가한다.
  - `architecture_plan`
  - `feature_inventory`
  - `operation_report`
  - `release_governance`
- 각 category별 required section과 citation rule을 정의한다.

### 2단계: evidence refs readback

- `artifact_check`는 markdown 내부 citation뿐 아니라 입력 evidenceRefs가 실제 파일/command transcript로 존재하는지 선택적으로 검사한다.
- `claim_evidence_check`는 문장 단위 claim과 evidenceRefs 사이의 누락을 diagnostic으로 반환한다.
- evidence path가 root 바깥으로 나가면 state path safety 정책과 같은 방식으로 fail-closed 처리한다.

### 3단계: 문서 검증 통합

- docs tests에 architecture plan section check를 추가한다.
- README가 "구현됨"이라고 말하는 기능과 `docs/feature/...unimplemented...`가 "미구현"이라고 말하는 기능이 충돌하지 않게 검사한다.
- 보고서 생성 도구는 artifact contract를 통과한 뒤에만 완료 상태를 반환한다.

## 수용 기준

- 모든 신규 architecture plan 문서는 표준 섹션을 가진다.
- artifact/evidence 관련 tool diagnostic code가 중복되지 않는다.
- evidence 없는 done claim은 `evidence_gate` 또는 `claim_evidence_check`에서 fail이 된다.
- docs sync test가 README, architecture docs, feature inventory의 범위 충돌을 잡는다.

## 위험과 완화

- 위험: governance schema가 너무 무거워져 Tiny-Chu의 작은 범위를 벗어날 수 있다.
- 완화: schema는 artifact metadata에만 적용하고 런타임 orchestration state에는 섞지 않는다.
- 위험: 모든 문서에 과도한 citation을 요구해 작성 비용이 커질 수 있다.
- 완화: architecture/reports처럼 의사결정 문서에만 강한 citation rule을 적용한다.

## 하지 않을 것

- LLM judge를 필수 검증기로 넣지 않는다.
- 문서 내용을 자동으로 "참/거짓" 판정하지 않는다.
- 외부 issue/PR 상태를 evidence로 자동 수집하지 않는다.
