# 15. 설치/확장 경계 계획

## 문제 정의

현재 프로젝트는 upstream main 대비 설치와 운영 표면이 커졌다. `package.json`은 package export뿐 아니라 `tiny-chu` bin, governance 문서, naming docs, scripts를 배포 files에 포함한다 ([package.json](../../package.json), `package.json:16`, `package.json:21`, `package.json:24`). README는 `npx tiny-chu install`과 offline bundle, internal registry, developer local checkout을 설명한다 ([README.md](../../README.md), `README.md:9`, `README.md:98`).

동시에 feature inventory는 dynamic package discovery, npm subpackage loading, MCP server adapters, Figma API calls, provider 본문 생성 호출을 아직 미구현 범위로 둔다 ([docs/feature/2026-06-15-unimplemented-features.md](../feature/2026-06-15-unimplemented-features.md), `docs/feature/2026-06-15-unimplemented-features.md:76`, `docs/feature/2026-06-15-unimplemented-features.md:99`, `docs/feature/2026-06-15-unimplemented-features.md:115`).

설치 표면과 확장 후보가 같은 문서에 섞이면, 사용자는 "지원되는 설치 모드"와 "향후 검토할 adapter"를 혼동할 수 있다.

## 개선 목표

- 설치/배포는 supported contract로 관리한다.
- external adapter 후보는 adapter-ready metadata로만 남긴다.
- install-check, README, INSTALL, package files, offline bundle 검증이 같은 source of truth를 공유한다.
- 확장 후보가 기본 오프라인 원칙을 깨지 않게 한다.

## 구조 변경안

1. `InstallSurfaceManifest` 내부 타입을 만든다.
   - package exports
   - bin commands
   - template paths
   - install modes
   - bundled docs
   - offline bundle artifact names
2. `createTinyChuInstallCheck()`는 hard-coded fields 대신 manifest에서 결과를 만든다. 현재 install-check는 entrypoint와 install modes를 직접 반환한다 ([src/opencode/install-check.ts](../../src/opencode/install-check.ts), `src/opencode/install-check.ts:12`, `src/opencode/install-check.ts:19`).
3. release/offline bundle scripts와 docs sync tests도 같은 manifest를 읽는다.
4. external adapter 후보는 `docs/feature`에 남기되, 승격 조건이 충족되기 전에는 package exports/files에 들어가지 않는다.

## 단계별 실행 계획

### 1단계: 설치 manifest 도입

- `src/opencode/install-surface.ts` 또는 `src/opencode/install-manifest.ts`를 추가한다.
- `package.json`의 exports/files/bin과 manifest가 맞는지 테스트한다.
- template path와 README/INSTALL 예제가 manifest에 존재하는지 테스트한다.

### 2단계: install-check 재배선

- `createTinyChuInstallCheck()`가 manifest를 인자로 받거나 내부 manifest를 import하게 한다.
- runtimeMode와 registry-derived requiredTools는 계속 registry에서 파생한다.
- install surface는 manifest에서 파생한다.

### 3단계: extension boundary 문서화

- `docs/feature/...unimplemented...`의 external adapter 항목마다 승격 조건을 checklist로 둔다.
- MCP/Figma/provider adapter는 token handling, network mode, offline fallback, schema drift test가 준비될 때만 feature package 후보로 올린다.
- package files에 adapter template이 추가되면 install manifest와 install-check가 반드시 바뀌게 한다.

## 수용 기준

- package exports/bin/files, install-check, README/INSTALL의 설치 모드가 같은 manifest와 일치한다.
- offline bundle 검증은 manifest에 없는 파일을 우연히 포함해도 성공으로 보지 않는다.
- external adapter 후보는 구현 전까지 install-check의 supported surface에 나타나지 않는다.
- network behavior는 provider metadata preflight 예외 외에는 기본 disabled로 남는다.

## 위험과 완화

- 위험: manifest가 package.json과 중복 source of truth가 될 수 있다.
- 완화: package.json을 읽어 manifest와 비교하는 테스트를 필수로 둔다. 수동 복사는 금지한다.
- 위험: installer가 플랫폼별 path 차이를 놓칠 수 있다.
- 완화: path portability test와 Windows npm test path 검증을 installer manifest에 연결한다.

## 하지 않을 것

- MCP server, Figma API, provider 본문 생성 호출을 이번 개선으로 구현하지 않는다.
- runtime에서 외부 npm subpackage를 자동 로드하지 않는다.
- package manager별 복잡한 plugin installer를 모두 내장하지 않는다.
