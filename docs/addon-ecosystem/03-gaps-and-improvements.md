# 03. 장점 · 단점 · 개선점

이 장은 [02-requirements.md](./02-requirements.md) 의 요구사항을 기준으로 현재 설계의 강점·약점을 평가하고, 개선점을 우선순위(P0~P2)로 정리한다.

> ⚠️ 여기의 개선점은 **분석·제안** 이다. 구현 여부는 별도 합의 후 [05-implementation-roadmap.md](./05-implementation-roadmap.md) 에 따라 진행한다.

## 1. 장점

1. **관심사 분리가 명확** — host(오케스트레이션) / generation-safety 소유자(Tinker.Gen) / UI 분석기(ui_pop)로 책임이 겹치지 않는다.
2. **import-프리 결합 모델** — descriptor + CLI 경계이므로 addon을 독립 배포·테스트·버저닝할 수 있다. host는 addon 존재를 런타임에 모른다.
3. **permission-gated descriptor** — 보안·안전 의도가 선언적으로 드러나고, source write가 단일 경계(apply)로 수렴한다.
4. **schema-driven 버저닝** — `schemaVersion`(`tinker.inventory.v1` 등)으로 계약 진화와 기계 검증이 가능하다.
5. **create-only 안전 모델** — preview → checkpoint → apply로 파괴적 변경을 차단한다. Tinker.Gen의 path traversal / symlink / atomic write / hash 검증은 엔터프라이즈급이다.
6. **evidence/confidence/provenance** — 생성 결과의 신뢰성이 추적 가능하다 (source-static → runtime-confirmed).
7. **일관된 기술 DNA** — 세 저장소 모두 TS / ESM / Zod / Node≥22 → 팀 인지 부하·학습 곡선 감소.
8. **단일 registry 3면 parity** — 동일 tool이 direct API · OpenCode bridge · install-check에서 모두 동일하게 노출된다.

## 2. 단점 / 위험

| ID | 문제 | 심각도 | 설명 | 관련 요구사항 |
|---|---|---|---|---|
| C1 | **계약 구현 비대칭** | 🚨 치명 | host contract는 미구현, Tinker.Gen은 부분, ui_pop은 전무. 현재 "add-on"은 **실제로 작동하지 않음** | FR4 |
| C2 | **ui_pop 호환성 결여** | 🔴 높 | ExternalAddonDescriptor / permission 체계를 전혀 따르지 않음. 통합 시 재설계 필요 | FR4, FR7 |
| C3 | **플랫폼/셸 불일치** | 🔴 높 | Tiny-Chu는 PowerShell 7.6 + Win10 + fd/rg/jq 가정. addon은 POSIX 친화(commander/tsup). 동일 host에서 shell-out 시 환경 충돌 가능 | NFR7 |
| C4 | **상태 디렉토리 파편화** | 🟠 중 | `.tiny/` · `.tinker/` · spec-dir 각각. 통합 정리·충돌 관리·lifecycle 부재 | NFR9 |
| C5 | **동적 발견/로딩 부재** | 🟠 중 | feature package는 정적 합성. addon 추가 = Tiny-Chu 빌드/설정 변경. runtime 발견 매커니즘 없음 | NFR8 |
| C6 | **문서-구현 드리프트** | 🟠 중 | 문서=`tinker integration tiny-chu print`/`addon.tinker-gen`, 실제=`integration opencode print`/`opencodeShim`. 명세가 단일 진실원이 아님 | NFR5 |
| C7 | **버전 호환 게이트 미비** | 🟡 | `TinyCompatibilitySpec` 언급만, addon↔host capability 버전 매칭·검증 루트 미확립 | NFR5 |
| C8 | **진단/에러 계약 비표준** | 🟡 | ui_pop만 `exit-codes.ts`. addon 간 일관된 diagnostics / doctor 집약 부재 | NFR10 |
| C9 | **관측 통합 부재** | 🟡 | Tiny-Chu TUI는 자기 상태만 표시. addon 상태/증명/permission 노출 안 됨 | NFR10 |

## 3. 개선점 (우선순위)

```text
P0 ─────────────────────────────────────────────────────────
 ① Tiny-Chu host contract 구현 (Phase 0)
    src/opencode/external-addon.ts + test/external-addon.test.mjs
    ExternalAddonDescriptor / Operation / Permission
    + createExternalAddonFeaturePackage()
    → 이것이 없으면 add-on 아키텍처 전체가 관념적임 (C1 해소)

 ② 명령/네이밍 표준화 (문서-구현 드리프트 제거)
    `tiny-chu` vs `opencode` 통일, 단일 `integration print` 규격,
    operation 네임스페이스 addon.<id>.<op> 고정 (C6 해소)

P1 ─────────────────────────────────────────────────────────
 ③ ui_pop descriptor 부여
    ui-pop integration print + ExternalAddonDescriptor
    operation: uipop_analyze_source / _draft / _render / _validate_runtime
    permission: read | writesArtifacts
    → 동일 계약으로 편입 (C2 해소)

 ④ 플랫폼 추상화
    shell profile을 host 책임으로 올리고, addon은 host runtime(executor) 경유
    → Tiny-Chu PowerShell / addon POSIX 불일치 해소, cross-platform 보장 (C3 해소)

 ⑤ addon 발견/레지스트리 + 상태 디렉토리 통합
    .tiny/addons/<id>/ 네임스페이스 + tiny addon list/doctor CLI
    → 정적 합성 → 선언적 발견; 파편화 해소 + 격리 + lifecycle (C4, C5 해소)

P2 ─────────────────────────────────────────────────────────
 ⑥ 버전 호환 게이트
    descriptor.compatibility ↔ host capability 매칭, install-check/doctor 통합 (C7 해소)

 ⑦ 진단 표준
    공통 diagnostics schema 전 addon 적용 + doctor 집약 (C8 해소)

 ⑧ 관측 통합
    Tiny-Chu TUI에 addon 상태/증명/permission 노출, evidence packet 통합 (C9 해소)

 ⑨ 문서를 단일 진실원으로
    descriptor snapshot 테스트로 명세↔구현 동기화 강제 (C6 예방)
```

### 개선점 ↔ 위험 매핑 요약

| 개선점 | 해소하는 위험 |
|---|---|
| ① host contract 구현 | C1 |
| ② 네이밍 표준화 | C6 |
| ③ ui_pop descriptor | C2 |
| ④ 플랫폼 추상화 | C3 |
| ⑤ 발견/레지스트리 + 상태 통합 | C4, C5 |
| ⑥ 버전 호환 게이트 | C7 |
| ⑦ 진단 표준 | C8 |
| ⑧ 관측 통합 | C9 |
| ⑨ 문서 동기화 테스트 | C6 (예방) |

## 4. 결론

- **의도된 아키텍처는 우수하다** — 3계층 adapter + permission 게이트 + create-only 안전 모델 + schema-driven provenance는 엔터프라이즈급 설계다.
- **현재는 "아직 add-on이 아닌" 3개 독립 CLI**다. host 계약(Phase 0)이 구현되지 않았기에 Tinker.Gen·ui_pop은 Tiny-Chu에 실제로 붙어 있지 않다.
- **가장 큰 실무 위험**은 **C1(계약 미구현)** 과 **C3(플랫폼/셸 불일치)** 이다. 전자는 "add-on"을 현실로 만드는 전제조건이고, 후자는 host에서 addon을 shell-out할 때 즉시 터질 수 있는 호환성 문제다.
- **최소 실행 경로**: P0-①(host contract) → P0-②(네이밍 표준) → P1-③(ui_pop descriptor) → P1-④(플랫폼 추상화)만 마무리해도 "Tiny-Chu host + 2 addon"이라는 원래 목표가 실제로 작동한다.

## 5. 다음

- 구현 로드맵(계획): [05-implementation-roadmap.md](./05-implementation-roadmap.md)
- 세 프로젝트 구조 상세: [04-component-profiles.md](./04-component-profiles.md)
