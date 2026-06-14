# 04. 툴 카탈로그

> 이 문서는 Tiny-Chu가 노출하는 60+ 툴을 패키지/카테고리별로 정리합니다. 각 툴의 핸들러는 `src/opencode/tiny-plugin.ts`의 `tools` 맵에 존재하며, 디스크립터는 `src/opencode/feature-packages/default-tool-seeds.ts`에 정의됩니다. 데이터 출처: `default-tool-seeds.ts`.

## 읽는 법

각 툴 표의 열:
- **툴명** — `tiny.tools[name]` 키
- **권한(permission)** — `READ_ONLY` / `STATE_WRITE` / `ARTIFACT_WRITE` / `SOURCE_WRITE`
- **출력 모드** — `json` / `markdown` (smallModel.outputMode)
- **네이티브 툴** — 실행에 필요한 외부 CLI (`requiredNativeTools`)

권한 힌트의 의미 (`tool-seed.ts:16`):
```ts
READ_ONLY     = { readOnly: true,  network: "none" }
STATE_WRITE   = { writesState: true,    network: "none" }   // .tiny/ 쓰기
ARTIFACT_WRITE= { writesArtifacts: true,network: "none" }   // 산출물 쓰기
SOURCE_WRITE  = { writesSource: true,   network: "none" }   // 소스 쓰기 (safe-tooling만)
```

> **모든 툴이 `network: "none"`** 입니다. Tiny-Chu는 어떤 툴도 네트워크 호출을 하지 않습니다 ([08-design-decisions.md](./08-design-decisions.md)).

---

## 패키지 1: `tiny-chu.core-runtime` (15 툴)

핵심 상태 원시 기능. 다른 모든 패키지의 기반.

### Task 도구 (5)
| 툴 | 권한 | 출력 | 설명 |
|----|------|------|------|
| `task_create` | STATE | json | `.tiny/tasks/`에 작업 생성 |
| `task_get` | READ | json | id로 작업 읽기 |
| `task_list` | READ | json | 상태 필터로 작업 목록 |
| `task_update` | STATE | json | 작업 메타데이터 갱신 |
| `task_checkpoint` | STATE | json | pass/artifact/evidence/verification 메타데이터로 resume 체크포인트 추가 |

### Public worker 도구 (6)
| 툴 | 권한 | 출력 | 설명 |
|----|------|------|------|
| `public_dispatch` | STATE | json | 위임 분석/산출물 작성용 worker 잡 패킷 큐잉 |
| `public_collect` | READ | json | id로 worker 잡 패킷 읽기 |
| `public_checkpoint` | STATE | json | 잡을 checkpointed로 표시 (부분 결과) |
| `public_retry` | STATE | json | 잡을 retry_wait로 (백오프 메타데이터) |
| `public_cancel` | STATE | json | 잡 취소 |
| `public_complete` | STATE | json | 결과 검증 후 잡 완료 |

### Context/Wiki 도구 (4)
| 툴 | 권한 | 출력 | 설명 |
|----|------|------|------|
| `context_bundle` | READ | json | 대상 경로의 가장 가까운 AGENTS.md + 규칙 번들 |
| `context_packet` | READ | json | 소형 컨텍스트 resume용 bounded 컨텍스트/증거 |
| `wiki_bundle` | READ | json | 참조로 canonical wiki 문서 번들 |

> **참고**: `public_dispatcher`는 `PublicDispatcher` 클래스(`src/dispatcher/public-job.ts`)로, 내부적으로 **rate gate**(soft/hard RPM/TPM)를 구현합니다. 자세한 동작은 [06-state-layer.md](./06-state-layer.md)의 디스패처 섹션.

---

## 패키지 2: `tiny-chu.shared-support` (0 툴)

툴 없음. `resources`와 `instructions`만 선언하는 의존성 허브 ([03](./03-feature-packages.md) 참조).

---

## 패키지 3: `tiny-chu.legacy-analysis` (8 툴)

레거시 FE→BE→DB→RFC 추적성 분석 체인.

| 툴 | 권한 | 네이티브 | 설명 |
|----|------|---------|------|
| `repo_map` | READ | fd, rg | bounded 아키텍처/UI-to-data-flow 맵 |
| `business_logic_map` | READ | rg, ast-grep | bounded 변수/컬럼/비교 증거 추출 |
| `legacy_repo_index` | READ | fd, rg, ast-grep, jq, yq | 결정론적 FE/BE/DB/RFC 증거 인덱스 |
| `ui_action_trace` | READ | rg, ast-grep | React 이벤트 → handler/redux/saga/API 추적 |
| `api_backend_trace` | READ | rg, ast-grep | FE API → 백엔드 route/service/mapper/RFC 추적 |
| `integration_catalog` | READ | fd, rg, yq | MyBatis SQL mapper + SAP JCo RFC 증거 카탈로그 |
| `traceability_matrix` | READ | — | UI/API/backend/integration 증거를 Markdown-ready 매트릭스로 병합 |
| `evidence_qa` | READ | — | 누락 증거/할루시네이션 심볼/Unknown 갭 감사 |

> **설계 원칙**: 모든 추적 도구는 증거가 있을 때만 링크를 만듭니다. 매칭되지 않으면 `Unknown` 갭으로 명시합니다. `evidence_qa`가 이를 강제합니다.

---

## 패키지 4: `tiny-chu.extension-utilities` (11 툴)

심층 분석 확장. legacy-analysis에 의존.

| 툴 | 권한 | 네이티브 | 설명 |
|----|------|---------|------|
| `evidence_snapshot` | READ | — | 기존 증거 파일을 bounded 재사용 메타데이터로 요약 |
| `claim_evidence_check` | READ | — | 산출물 클레임이 지원되지 않는 심볼/누락 증거를 참조하면 fail-closed |
| `api_contract_catalog` | READ | rg, ast-grep | FE/BE API 계약 후보 및 엔드포인트 불일치 카탈로그 |
| `dto_schema_map` | READ | rg, ast-grep | UI payload/DTO/MyBatis/RFC 매개변수 증거 매핑 |
| `redux_state_flow_map` | READ | rg, ast-grep | Redux reducer/selector/saga 읽기·쓰기 매핑 |
| `auth_permission_trace` | READ | rg, ast-grep | UI/API/backend 권한·역할 조건 증거 추적 |
| `error_transaction_map` | READ | rg, ast-grep | 에러 핸들러/트랜잭션 경계/복구 위험 매핑 |
| `test_impact_planner` | READ | rg | 증거 기반 변경 컨텍스트에서 영향/누락 테스트 계획 |
| `worker_packet_optimizer` | STATE | — | retry/복구 메타데이터로 bounded Qwen worker 패킷 분할 |
| `artifact_pack_manifest` | READ | — | 그룹화된 설계 산출물 준비성 검증 |
| `incremental_evidence_cache` | STATE | — | 해시 기반 무효화로 오래된 증거 감지 |

> **`incremental_evidence_cache` 주의**: 소스-해시 출령(staleness)만 보고합니다. **git dirty-worktree 검사가 아닙니다.** 실행자는 직접 `git status`/`git diff`를 실행해야 합니다 ([07](./07-stability-contracts.md)).

---

## 패키지 5: `tiny-chu.button-workflow-hardening` (10 툴)

버튼별 워크플로 강화 — 한 번에 모든 버튼을 worker에 보내지 않고 통제된 분산 처리.

| 툴 | 권한 | 네이티브 | 설명 |
|----|------|---------|------|
| `button_workflow_plan` | READ | rg, ast-grep | 감지된 버튼/컨트롤별로 작업 항목 1개씩 계획 |
| `button_worker_packet` | READ | — | 정확히 1개 버튼용 JSON-only worker 패킷 빌드 |
| `button_workflow_dispatch` | STATE | — | 기본 순차로 1-버튼 패킷 디스패치 |
| `markdown_envelope_check` | READ | — | JSON-only worker 출력을 사칭하는 Markdown 거부 |
| `button_worker_result_check` | READ | — | 완료 전 1-버튼 결과 증거 검증 |
| `button_trace_aggregate` | READ | — | 검증된 1-버튼 추적 행 집계 |
| `aggregation_drift_check` | READ | — | 이전/현재 집계 간 의미적 드리프트 감지 |
| `atomic_markdown_write` | ARTIFACT | — | 생성된 Markdown을 root 안에서 원자적 쓰기 |
| `write_loop_guard` | READ | — | 루프/빈 출력/동일 반복에 대해 생성 Markdown 쓰기 가드 |
| `button_workflow_done_claim` | READ | — | 최종 버튼 워크플로 완료 클레임 검증 |

---

## 패키지 6: `tiny-chu.small-model-resilience` (11 툴)

소형 foreman 모델의 복원력과 운영 프로파일.

| 툴 | 권한 | 네이티브 | 설명 |
|----|------|---------|------|
| `context_digest` | READ | rg | bounded 파일 증거 스니펫 + 인용 |
| `session_preflight` | READ | — | 최신 체크포인트/검증 툴/예산 원장 |
| `orchestration_profile` | READ | — | 소형 컨텍스트 OpenCode 오케스트레이션 프로파일 반환 |
| `qwen_retry_policy` | READ | — | qwen3.6-35b-a3b 공개 rate-limit retry/청킹 가이드 |
| `orchestration_health` | READ | — | task/worker 헬스 요약 + 진행 보존 복구 단계 |
| `rules_snapshot` | STATE | — | 확인된 아키텍처 패턴을 `.tiny/rules`에 기록 |
| `tool_usage_plan` | READ | — | 소형 모델 안전 명령/툴 시퀀스 선택 |
| `resume_packet` | READ | — | 활성 작업 목표/최신 체크포인트/다음 단계/미해결 질문 |
| `task_focus_packet` | READ | — | 현재 작업 + 계획 포커스 + 최신 체크포인트 |
| `chunked_write_plan` | READ | — | 큰 Markdown을 bounded 쓰기 청크로 분할 |
| `git_weekly_report` | STATE | — | 5영업일 Git 활동 보고서 (`.tiny/reports/git-weekly`) |

> **`git_weekly_report`**: local-git 증거 도구. `ref`에서 도달 가능한 커밋만 보고하며, 원격 push/PR/리뷰/CI/배포는 증명하지 않습니다. 개인정보 보호를 위해 이메일은 해시된 별칭으로 매핑합니다.

---

## 패키지 7: `tiny-chu.ux-reverse-engineering` (7 툴)

UX 역설계 — 화면 요소가 왜 존재하고 왜 그 순서인지 증거 기반으로 설명.

| 툴 | 권한 | 네이티브 | 설명 |
|----|------|---------|------|
| `ui_layout_catalog` | READ | rg, ast-grep | React/JS/TS 화면에서 소스-우선 레이아웃 요소 카탈로그 |
| `ux_rationale_trace` | READ | rg | 보수적 증거 상태(Verified/Inferred/Unknown)로 존재·위치 설명 |
| `ux_validation_matrix` | READ | rg, ast-grep | 값 종류/클라이언트 규칙/서버 규칙/메시지 분리 |
| `layout_truth_update` | STATE | — | 검증된 사실을 다운그레이드하지 않고 레이아웃 truth 갱신 |
| `layout_truth_verify` | READ | — | 현재 소스 지문에 대해 저장된 레이아웃 truth 검증 |
| `layout_truth_report` | READ(md) | — | 레이아웃 truth 저장소 메모리를 Markdown으로 렌더 |
| `ux_reverse_report` | READ(md) | — | catalog/rationale/validation 증거에서 UX 역설계 Markdown 렌더 |

> **핵심 규칙**: `ux_rationale_trace`는 `Verified`/`Inferred`/`Unknown`/`Needs Verification` 상태만 내며, **LLM 전용 가설을 내지 않습니다**. 소스 순서만으로는 `Verified`가 될 수 없습니다.

---

## 패키지 8: `tiny-chu.doctor-artifacts` (9 툴)

준비 게이트와 산출물 가드.

| 툴 | 권한 | 네이티브 | 설명 |
|----|------|---------|------|
| `doctor` | READ | node | 환경/상태/세션 체크를 아우르는 정규화 헬스 파사드 |
| `powershell_command_guard` | READ | pwsh | 생성된 네이티브 툴 명령의 PowerShell-safe 검증 |
| `trace_diagram_render` | READ | mmdc | 추적성 JSON에서 결정론적 Mermaid 렌더 |
| `tiny_chu_install_check` | READ | — | Tiny-Chu OpenCode 플러그인 준비성 요약 (레지스트리 소비 지점 3) |
| `environment_doctor` | READ | node, pwsh, opencode, ollama, rg, fd, jq, yq, mdq, ast-grep, mmdc | OpenCode/Ollama/PowerShell/Node/네이티브 툴 준비성 체크 |
| `artifact_format_template` | READ(md) | — | 생성 전 필수 산출물 형식 템플릿 반환 |
| `artifact_check` | READ | — | AS-IS/UI/story/testcase/Mermaid/ERD 산출물을 증거 규칙에 대해 검증 |
| `mermaid_check` | READ | mmdc | Mermaid 펜스 블록의 일반적 형식/구문 문제 체크 |
| `mermaid_fix` | READ(md) | — | 결정적일 때 펜스 정규화 및 미닫기 닫기 |

> **`doctor` vs `environment_doctor` vs `orchestration_health`**: 역할 분담이 있습니다:
> - `doctor` — 정규화된 통합 헬스 파사드 (명령 가용성 + 읽기 전용 상태 + PowerShell 기대 + 세션 프리플라이트)
> - `environment_doctor` — 집중된 명령 체크
> - `orchestration_health` — 실패/체크포인트 작업 후 복구 체크

---

## 옵션 패키지: `tiny-chu.safe-tooling` (8 툴)

`config.safeTooling: true`일 때만 활성화. 해시 검증 소스 변경과 격리 산출물 게시.

| 툴 | 권한 | 네이티브 | 설명 |
|----|------|---------|------|
| `safe_patch_check` | READ | git | expected 해시로 allowlist된 unified diff 검증 (변경 없음) |
| `safe_patch_apply` | SOURCE | — | 해시/경로/잠금 검사 후에만 allowlist된 diff 적용 |
| `artifact_workspace_prepare` | STATE | — | 소스 리포지토리 밖 OS-temp 격리 산출물 워크스페이스 준비 |
| `artifact_workspace_commit` | STATE | — | 격리 워크스페이스 안에서 산출물 커밋 |
| `artifact_publish_manifest` | STATE | — | allowlist된 산출물 게시용 내구성 매니페스트 작성 |
| `artifact_publish_apply` | SOURCE | — | 타겟 해시가 매니페스트와 여전히 일치할 때만 게시 |
| `powershell_toolchain_probe` | READ | pwsh | OpenCode 네이티브 툴링 호환성을 위한 pwsh 동작 프로브 |
| `run_diagnostics` | READ | — | 변경 툴을 게이트하지 않고 자문 빌드/테스트 진단 실행 |

## 옵션 패키지: `tiny-chu.native-previews` (4 툴)

`safeTooling: true && nativePreviews: true`일 때만 활성화. 미리보기 전용 네이티브 래퍼.

| 툴 | 네이티브 | 설명 |
|----|---------|------|
| `structural_search_ast` | ast-grep | ast-grep 구조 검색 매치 미리보기 (쓰기 없음) |
| `structural_rewrite_preview` | ast-grep | ast-grep 재작성 출력 미리보기 (변경은 safe_patch_apply로) |
| `json_yaml_transform_preview` | jq, yq | jq/yq 데이터 변환 미리보기 (쓰기 없음) |
| `json_patch_preview` | jd | jd JSON/YAML 구조 패치 미리보기 |

> **안전 워크플로**: 미리보기 → `safe_patch_check` → `safe_patch_apply`(allowlist 타겟 + 현재 sha256 해시만). 산출물은 `artifact_workspace_prepare` 워크스페이스에서 빌드 후 `artifact_publish_apply`로만 소스에 씁니다. **생성 Git 작업은 소스 리포지토리 밖에서**, 최종 apply/publish만 소스에 기록합니다.

---

## 카테고리별 집계

| 카테고리 | 기본 툴 수 | 옵션(safe) 툴 수 |
|---------|-----------|-----------------|
| core-runtime | 15 | — |
| support | 0 | — |
| legacy-analysis | 8 | — |
| extension-utilities | 11 | — |
| workflow-hardening | 10 | — |
| small-model-resilience | 11 | — |
| ux-reverse-engineering | 7 | — |
| doctor-artifacts | 9 | — |
| safe-tooling | — | 8 + 4(native) |
| **기본 합계** | **71** | **+ 12 (옵션)** |

> 정확한 툴 수는 디스크립터를 합산한 것입니다. README는 "60+"으로 표현하지만, 실제 디스크립터를 세면 기본만 71개입니다.

## 네이티브 툴 의존성 요약

여러 툴이 참조하는 네이티브 실행 파일 (누락 시 툴은 degraded/unavailable 반환, npm 의존성이 되지 않음):

| 네이티브 | 참조 툴 수 | 용도 |
|---------|-----------|------|
| `rg` (ripgrep) | 다수 | 텍스트 검색 (JSON 출력) |
| `fd` | 다수 | 파일 인벤토리 |
| `ast-grep` | 다수 | TypeScript/JS 구조 검색 |
| `jq` | 일부 | JSON 슬라이싱 |
| `yq` | 일부 | YAML/Markdown 슬라이싱 (Mike Farah) |
| `mdq` | 일부 | Markdown 쿼리 |
| `git` | safe-tooling | diff 해시 |
| `mmdc` | doctor | Mermaid CLI 렌더 |
| `pwsh` | doctor/guard | PowerShell 환경 |
| `jd` | native-previews | JSON/YAML 패치 |
| `node`/`opencode`/`ollama` | environment_doctor | 런타임 환경 |

> **이 네이티브 툴들은 npm 의존성이 아닙니다.** `nativeToolNames`는 메타데이터일 뿐이며, `environment_doctor`가 가용성을 보고합니다. 누락된 툴은 unavailable/degraded 결과를 반환하며 설치를 강제하지 않습니다.

## 다음 읽을 문서

- → [05-plugin-and-hooks.md](./05-plugin-and-hooks.md): 이 툴들이 OpenCode 호스트에서 어떻게 감싸지고 출력이 제한되는지.
- → [03-feature-packages.md](./03-feature-packages.md): 각 툴이 속한 패키지의 의존성 그래프.
