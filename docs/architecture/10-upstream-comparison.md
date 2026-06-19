# 10. GitHub 기준선 대비 요구사항 비교

## 비교 기준

- 비교 대상: GitHub `WonderRabbit/Tiny-Chu`의 `main`.
- 기준 SHA: `6a6266d27ea97915db5a20cf0c5364af756fb882`.
- 확인 명령: `git ls-remote origin refs/heads/main`.
- 현재 작업 기준: 이 워크스페이스의 현재 브랜치 `codex/windows-npm-test-paths`와 작업트리.

이 문서는 upstream `main`과 현재 프로젝트가 이미 벌어진 지점, 그리고 그 차이가 Tiny-Chu의 기능성/비기능성/아키텍처 요구사항에 어떤 압력을 주는지 정리한다. 구체적인 구조 변경 계획은 11-15번 문서에 건별로 분리했다.

## 기능성 요구사항 비교

| 영역 | upstream main 기준 | 현재 프로젝트 기준 | 구조상 압력 |
|---|---|---|---|
| core orchestration | task, context, plan, workflow, public job, wiki, OpenCode shell 중심 | README 범위가 workflow, evidence, doctor, naming, installer, TUI까지 확장됨 ([README.md](../../README.md), `README.md:44`, `README.md:51`) | flat handler map이 계속 커져 feature package와 handler 소유권이 흐려질 위험 |
| 설치/배포 | npm package, OpenCode shim, offline bundle 중심 | `npx tiny-chu install`, bin entrypoint, governance 문서, package files가 확장됨 ([package.json](../../package.json), `package.json:21`, `package.json:24`) | 설치 표면을 runtime registry와 같은 계약으로 검증해야 함 |
| runtime mode | worker/orchestrator mode가 존재 | mode 설명과 worker-only surface가 문서화됨 ([README.md](../../README.md), `README.md:158`) | package visibility와 tool behavior가 mode별로 명시되어야 함 |
| safe/source tooling | opt-in safe tooling과 native previews | safe patch, artifact workspace, diagnostics, native previews가 확장됨 ([README.md](../../README.md), `README.md:188`) | source mutation, artifact mutation, diagnostics를 같은 안전 경계로 묶어야 함 |
| small model support | context budget, replay, evidence gate | small-model contribution/naming 계열까지 확장됨 ([src/opencode/tiny-plugin.ts](../../src/opencode/tiny-plugin.ts), `src/opencode/tiny-plugin.ts:196`, `src/opencode/tiny-plugin.ts:198`) | 소형 모델용 도구 색인이 registry에서 파생되어야 함 |

## 비기능성 요구사항 비교

| 요구사항 | 현재 근거 | 개선 필요 |
|---|---|---|
| 결정론 | feature package seed, tool list, docs sync가 정렬과 parity에 의존 | package/order/documentation drift를 별도 검증 단계로 두어야 함 |
| 경로 안전 | README와 architecture 문서가 root confinement를 load-bearing constraint로 둠 ([docs/architecture/README.md](./README.md), `docs/architecture/README.md:55`) | 모든 새 adapter와 installer path가 같은 resolver를 거치도록 통합해야 함 |
| 동시성 | state lock이 lock owner와 lease를 둠 ([src/state/lock-store.ts](../../src/state/lock-store.ts), `src/state/lock-store.ts:13`, `src/state/lock-store.ts:95`) | task/public/workflow/wiki writer별 lock scope와 stale recovery 정책을 문서/테스트로 통합해야 함 |
| 증거성 | artifact contract가 evidence citation을 요구함 ([src/opencode/artifact-contract.ts](../../src/opencode/artifact-contract.ts), `src/opencode/artifact-contract.ts:60`) | evidence, report, artifact, docs를 하나의 검증 가능한 artifact taxonomy로 묶어야 함 |
| 오프라인성 | provider preflight는 기본 disabled이며 network metadata probe만 예외 ([README.md](../../README.md), `README.md:126`) | installer, extension, provider adapter 후보도 network boundary를 명시해야 함 |

## 아키텍처 요구사항 비교

현재 설계의 중심은 "flat handler map -> feature package descriptor -> composed registry -> 세 소비 지점"이다. 이 구조 자체는 유지해야 한다. 다만 현재 `createTinyChuPlugin()` 내부의 handler map은 여러 도메인의 import와 handler를 한 파일에 모으고 있다 ([src/opencode/tiny-plugin.ts](../../src/opencode/tiny-plugin.ts), `src/opencode/tiny-plugin.ts:1`, `src/opencode/tiny-plugin.ts:84`). 이 상태에서 naming, governance, installer, artifact, workflow 도구가 계속 늘어나면 단일 레지스트리 원칙은 유지되더라도 구현 소유권은 약해진다.

따라서 개선 방향은 "큰 오케스트레이터 추가"가 아니라 아래 다섯 가지 구조 변경이다.

1. handler 구현 소유권을 package 단위로 분리한다.
2. runtime mode와 package visibility를 명시적 capability contract로 만든다.
3. `.tiny/` 상태 writer의 lock/write/read 정책을 하나의 state integrity layer로 묶는다.
4. evidence/report/artifact 검증 계약을 registry에서 파생되는 governance surface로 만든다.
5. 설치, release, external adapter 후보를 같은 offline-first boundary 아래 둔다.

## 건별 계획 문서

- [11. Feature Package 경계 재정렬 계획](./11-feature-package-boundary-plan.md)
- [12. Runtime Mode와 Capability 계약 계획](./12-runtime-mode-capability-plan.md)
- [13. 상태 무결성과 동시성 계획](./13-state-integrity-plan.md)
- [14. Evidence와 Artifact Governance 계획](./14-evidence-artifact-governance-plan.md)
- [15. 설치/확장 경계 계획](./15-install-extension-boundary-plan.md)

## 명시적 비목표

- 대형 협업 오케스트레이션, 계층형 계획 엔진, 병렬 hook, 원본 delegate-task 엔진을 다시 들여오지 않는다.
- 외부 feature package를 자동 실행하거나 신뢰하지 않는다.
- provider 본문 생성 호출을 Tiny-Chu 기본 기능으로 넣지 않는다.
- 현재 dirty worktree의 다른 코드 변경을 되돌리거나 병합하지 않는다.
