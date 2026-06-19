# 02. 요구사항 분석 (기능성 / 비기능성)

이 장은 [01-architecture-analysis.md](./01-architecture-analysis.md) 의 아키텍처가 **만들어내는(혹은 만들어야 하는)** 요구사항을 도출한다. 목표 아키텍처가 정상 동작하기 위한 조건을 기능적(FR)·비기능적(NFR)으로 정리하며, 각 항목에 **현재 충족도**를 병기한다.

## 1. 기능적 요구사항 (Functional Requirements)

| ID | 요구사항 | 근거/구현 위치 | 충족 |
|---|---|---|---|
| FR1 | **OpenCode 통합**: 플러그인 lifecycle(`tool` / `chat.message` / `shell.env` / `compacting`) 대응 | Tiny-Chu `src/opencode/plugin.ts` | ✅ |
| FR2 | **파일 기반 상태 영속**: atomic JSON/JSONL 쓰기 + advisory lock + root 경계 강제 | Tiny-Chu `src/state/` | ✅ |
| FR3 | **단일 registry 합성 → 3면 parity**: direct API · OpenCode bridge · install-check 가 동일 tool 노출 | feature-package composer | ✅ |
| FR4 | **외부 addon 조합**: descriptor 소개 → permission 매핑 → registry 패키지 변환 | `external-addon.ts` (설계) | ❌ 미구현 |
| FR5 | **안전한 코드 생성 파이프라인**: analyze → context → plan → preview(checkpoint) → apply | Tinker.Gen `src/apply/apply.ts` | ✅ (Tinker.Gen 단독) |
| FR6 | **UI 리버스 엔지니어링**: TSX → UI-IR → markdown/HTML wireframe → runtime 검증(신뢰도 승격) | ui_pop `src/commands/` 파이프라인 | ✅ (ui_pop 단독) |
| FR7 | **권한 분리**: read / writesArtifacts / writesSource / network; source write는 apply 단일 경계 | permission 매트릭스 | 🟡 (Tinker.Gen 설계에만, host 미연동) |
| FR8 | **CodeGraph 선택적 정밀 분석**: 부재 시 builtin 분석으로 degrade | Tinker.Gen `src/analysis/pipeline.ts` | ✅ |
| FR9 | **소형 모델 최적화**: output budget · 청킹 · 결정론적 tool | Tiny-Chu small-context 계층 | ✅ |
| FR10 | **Provenance(증명성)**: 모든 산출물에 source ref · confidence · `schemaVersion` | evidence/confidence 시스템 | ✅ (각 도구 내부) |

> **FR4·FR7** 은 "add-on"이라는 이름이 현실이 되기 위한 핵심 요구사항이며, **현재 미충족** 이다.

## 2. 비기능적 요구사항 (Non-Functional Requirements)

| ID | 품질 속성 | 현재 충족도 | 비고 |
|---|---|---|---|
| NFR1 | **낮은 결합도** — host↔addon runtime import 금지 | 🟡 설계만 | 계약 구현 시 강점 발현 |
| NFR2 | **단방향 의존** — addon→host 의존 X | 🟢 | Tinker.Gen·ui_pop core 모두 독립 |
| NFR3 | **파괴 방지/안전** — create-only, fail-closed | 🟢 | Tinker.Gen path traversal·symlink·hash 검증 강력 |
| NFR4 | **재현성/격리** — schema-driven, 결정론적 | 🟢 | Zod + JSON Schema 전반 |
| NFR5 | **검증 가능성** — doctor / contract test / install-check | 🟡 부분 | ui_pop은 exit-codes만 보유 |
| NFR6 | **Graceful degradation** | 🟢 | CodeGraph 부재 시 builtin |
| NFR7 | **플랫폼 이식성** | 🔴 **불일치 위험** | Tiny-Chu=PowerShell/Win, addon=POSIX. ⚠️ 동일 host shell-out 시 충돌 |
| NFR8 | **확장성** — descriptor 복사로 신규 addon onboarding | 🟡 설계 | 발견/로딩 매커니즘 부재 |
| NFR9 | **동시성 안전** — lock / atomic | 🟢 | apply lock·advisory lock |
| NFR10 | **관측성/진단** | 🟡 파편화 | addon 간 통일된 진단 계약 부재 |

## 3. 품질 속성 시나리오 (주요 항목)

### NFR3 파괴 방지 — Tinker.Gen apply 경계
- **자극**: 사용자가 생성된 코드를 실제 workspace에 적용하려 함.
- **환경**: OpenCode + Tiny-Chu host + Tinker.Gen addon.
- **응답**: apply는 반드시 preview → checkpoint(해시 검증) → atomic write 순서로만 수행. path traversal(`..`)·symlink 경계 위반·해시 불일치 시 거부(fail-closed).
- **측정**: 잘못된 경로/해시에 대한 write 시도 100% 차단.

### NFR7 플랫폼 이식성 — 셸 불일치
- **자극**: Tiny-Chu host가 Tinker.Gen addon을 shell-out으로 호출.
- **환경**: Windows 10 + PowerShell 7.6 (Tiny-Chu 기본) 환경.
- **응답(현재)**: addon은 POSIX 친화(`commander`/`tsup`)로 가정되어, host의 PowerShell executor 환경에서 네이티브 도구(fd/rg/jq 등) 탐지·호환성이 보장되지 않음.
- **측정**: 크로스 플랫폼 smoke 테스트 통과율(현재 미정의).

### NFR8 확장성 — 신규 addon 온보딩
- **자극**: 새 addon(예: `addon.example`)을 생태계에 추가.
- **환경**: descriptor template 기반.
- **응답(목표)**: descriptor JSON 1개 + handler 바인딩만으로 registry 합성.
- **측정**: 신규 addon 추가에 필요한 host 코드 변경 = 0.

## 4. 다음

- 이 요구사항들을 기준으로 한 장점·단점·개선점: [03-gaps-and-improvements.md](./03-gaps-and-improvements.md)
