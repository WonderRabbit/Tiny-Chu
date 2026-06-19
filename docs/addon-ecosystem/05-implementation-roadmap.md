# 05. 구현 로드맵 (계획 전용)

> ⚠️ **중요**: 이 장은 **계획(plan)만** 담는다. **실제 코드 구현은 진행하지 않는다.** 본 문서는 Tinker.Gen 측 설계 문서(`tinychu-tinkergen-coupling-architecture.md`)의 Phase 분할과 [03-gaps-and-improvements.md](./03-gaps-and-improvements.md) 의 개선점을 정리한 것이다. 합의 후 별도 세션에서 진행한다.

## 1. 원칙

- Tiny-Chu는 **범용 external-addon host contract** 제공에만 집중한다 (Tinker.Gen 전용 hardcode 금지).
- addon core는 **Tiny-Chu runtime을 import하지 않는다**.
- OpenCode 구성은 **sibling plugin composition**으로 유지한다.
- 모든 생성 backend는 preview/apply 전에 `CreateAction[]` 또는 Tinker artifact로 수렴한다.
- source write는 **Tinker.Gen `apply` 경계에서만** 발생한다.
- 미래 addon은 descriptor template 복사로 시작할 수 있어야 한다.

## 2. 단계별 계획

### Phase 0. Tiny-Chu host contract (P0-①)
Tiny-Chu에 `src/opencode/external-addon.ts` 추가.
- `ExternalAddonDescriptor` / `ExternalAddonOperation` / `ExternalAddonPermission` export
- `createExternalAddonFeaturePackage(descriptor, handlers)` export
- `src/index.ts`에서 public API로 노출
- `test/external-addon.test.mjs`: descriptor→feature-package 변환, permission 매핑, missing handler, duplicate operation 검증
- 기존 `tiny-plugin.ts`에 Tinker.Gen 이름을 **직접 넣지 않음**

> 의존: 없음. 모든 것의 선행 조건(C1 해소).

### Phase 1. Tinker.Gen bridge descriptor (P0-② + P0-① 보강)
Tinker.Gen에 `addon.tinker-gen` descriptor 추가 + CLI 출력 명령 제공.
- `tinker integration tiny-chu print`가 descriptor JSON 출력 (⚠️ 현재 `integration opencode print` → 네이밍 통일 필요, C6)
- descriptor에 `tinker_doctor` / `tinker_analyze` / `tinker_context_generation` / `tinker_plan` / `tinker_preview` / `tinker_apply` 포함
- `tinker_apply`는 `writesSource` permission
- core generation/preview/apply module은 Tiny-Chu를 import하지 않음
- 테스트: JSON parse, operation 목록, permission, forbidden dependency 검증

> 의존: Phase 0.

### Phase 2. ui_pop descriptor + 문서/config guidance (P1-③)
- ui_pop에 `ui-pop integration tiny-chu print` + `ExternalAddonDescriptor` 부여
  - operation: `uipop_analyze_source` / `uipop_draft` / `uipop_render` / `uipop_validate_runtime`
  - permission: `read` / `writesArtifacts` (ui_pop은 source write 없음)
- Tinker.Gen·ui_pop 문서에 Tiny-Chu/OpenCode/CodeGraph 결합 설명 추가
  - `opencode-codegraph`는 sibling plugin임을 명시
  - Tiny-Chu=host contract, addon=bridge descriptor 명시
  - CodeGraph 부재/미초기화 시 builtin으로 degrade 가능 명시

> 의존: Phase 0.

### Phase 3. End-to-end QA + 플랫폼 추상화 (P1-④)
두 저장소 build/test 후 통합 검증.
- Tinker.Gen: `npm run check`
- Tiny-Chu: `npm test`
- `tinker integration tiny-chu print` 결과가 `addon.tinker-gen` + `tinker_apply` 포함 확인
- `createExternalAddonFeaturePackage()`가 Tinker.Gen descriptor를 정상 registry package로 변환 확인
- temp workspace에서 analyze/context/preview/apply smoke 실행
- **플랫폼 추상화**: shell profile을 host 책임으로 올리고 addon은 host executor 경유 (C3 해소)

> 의존: Phase 0/1/2.

### Phase 4(후속). 발견/레지스트리 + 상태 통합 + 게이트/진단/관측 (P1-⑤, P2)
- addon 발견/레지스트리: `.tiny/addons/<id>/` 네임스페이스 + `tiny addon list/doctor` CLI (C4, C5)
- 버전 호환 게이트: `descriptor.compatibility` ↔ host capability 매칭, install-check/doctor 통합 (C7)
- 진단 표준: 공통 diagnostics schema 전 addon 적용 + doctor 집약 (C8)
- 관측 통합: Tiny-Chu TUI에 addon 상태/증명/permission 노출, evidence packet 통합 (C9)
- 문서 동기화: descriptor snapshot 테스트로 명세↔구현 동기화 강제 (C6 예방)

> 의존: Phase 0~3. 이 단계는 별도 설계 합의 후 진행.

## 3. 책임 분리 매트릭스

| 주체 | 해야 할 일 | 하지 말아야 할 일 |
|---|---|---|
| **Tiny-Chu** | 범용 `ExternalAddonDescriptor` 타입, `createExternalAddonFeaturePackage()` helper, registry/install-check/doctor 연결, contract test 제공 | `tiny-plugin.ts`에 특정 addon tool 직접 hardcode, addon 내부 module import |
| **Tinker.Gen** | `addon.tinker-gen` descriptor, `tinker integration tiny-chu print`, CLI/SDK schema·error code, preview/apply safety 유지 | core generation/preview/apply path에 Tiny-Chu runtime dependency 추가 |
| **ui_pop** | `addon.ui-pop` descriptor, `ui-pop integration tiny-chu print` 제공 | host runtime import, source write (UI 분석은 read-only) |
| **OpenCode config** | `tiny-chu`, 각 addon bridge, `opencode-codegraph`를 sibling 로드 | CodeGraph plugin을 Tiny-Chu/addon이 소유한다고 문서화 |

## 4. 신규 addon 템플릿 (향후 복사용)

```ts
const descriptor: ExternalAddonDescriptor = {
  id: "addon.example",
  title: "Example Addon",
  nativeCommand: "example",
  operations: [
    {
      name: "example_status",
      description: "Read addon status",
      args: ["status", "--json"],
      permission: "read",
      output: "json",
    },
  ],
  requiredNativeTools: ["example"],
};
```

**검토 체크리스트:**
- addon id가 전역에서 충돌하지 않는가?
- operation 이름이 Tiny-Chu registry에서 중복되지 않는가?
- source write 가능 operation이 `writesSource`로 표시되는가?
- native executable 부재 시 degraded/blocked 결과가 명확한가?
- addon core와 Tiny-Chu host 사이에 runtime import가 생기지 않는가?
- OpenCode bridge를 우회하는 standalone `.opencode/tools` 설계가 아닌가?

## 5. 수용 기준 (Definition of Done)

- [ ] Tiny-Chu가 addon 전용 hardcode 없이 external-addon host contract 제공
- [ ] Tinker.Gen이 Tiny-Chu runtime dependency 없이 bridge descriptor 출력
- [ ] ui_pop이 동일 descriptor 계약으로 bridge descriptor 출력
- [ ] OpenCode guidance가 Tiny-Chu · 각 addon bridge · `opencode-codegraph` sibling composition 설명
- [ ] 모든 생성 backend가 preview/apply 전에 `CreateAction[]` 또는 artifact로 수렴
- [ ] source write가 Tinker.Gen `apply` 경계에서만 발생
- [ ] 미래 addon이 descriptor template 복사로 시작 가능
- [ ] 크로스 플랫폼 smoke(PowerShell/POSIX 양쪽) 통과

## 6. 금지선

- Tiny-Chu core `tiny-plugin.ts`에 특정 addon tool을 직접 추가하지 않는다.
- addon core가 Tiny-Chu runtime/plugin code를 import하지 않는다.
- `opencode-codegraph`를 Tiny-Chu나 addon에 vendoring하지 않는다.
- CodeGraph 초기화를 암묵적으로 실행하지 않는다.
- addon handler가 preview/apply를 우회해 target project에 직접 쓰지 않는다.

## 7. 참고

- 원본 결합 설계: `../../../../Tinker.Gen/docs/tinychu-tinkergen-coupling-architecture.md`
- 요구사항: [02-requirements.md](./02-requirements.md)
- 장점·단점·개선점: [03-gaps-and-improvements.md](./03-gaps-and-improvements.md)
- 컴포넌트 구조: [04-component-profiles.md](./04-component-profiles.md)
