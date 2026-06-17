# Tiny-Chu 설치 가이드

이 문서는 Tiny-Chu를 OpenCode 프로젝트에 설치하는 canonical A-Z 절차다. 로컬 개발 설치, 폐쇄망 설치, internal registry 배포, developer local checkout 검증을 모두 다루지만 운영 폐쇄망 기본 경로는 offline bundle이다.

Tiny-Chu 폐쇄망 설치는 대상 프로젝트의 `.opencode/` 아래에 project-local OpenCode plugin file과 local package dependency를 둔다. OpenCode 시작 시점에 npm plugin을 외부에서 내려받는 방식에 의존하지 않는다.

프로젝트의 목적과 제공 범위는 [README.md](./README.md)를 먼저 보고, 설치 후 운영 사용법은 [HOW_TO_USE.md](./HOW_TO_USE.md)를 기준으로 확인한다.

## 0단계: 사전 조건 확인

필요한 runtime은 아래와 같다.

- Node.js `>=20.18.0`
- 선택한 Node.js 배포판의 npm
- project-local plugin loading이 가능한 OpenCode
- macOS/Linux에서는 `install-offline.sh` 실행용 Bash
- Windows에서는 `install-offline.ps1` 실행용 PowerShell 7+

PowerShell 세션에서 `$`, `{}`, `[]`, `|`가 포함된 path나 one-liner를 실행할 때는 single quote를 우선 사용한다. native argument 전달 문제가 있으면 아래 값을 명시한다.

```powershell
$PSNativeCommandArgumentPassing = 'Standard'
```

## 1단계: 설치 경로 선택

| 경로 | 선택 기준 | 대상 프로젝트의 network 요구 |
| --- | --- | --- |
| offline bundle | 대상 프로젝트가 폐쇄망이거나 registry 접근이 없을 때 | release asset을 복사한 뒤에는 없음 |
| internal registry | 조직이 Tiny-Chu와 production dependency를 Verdaccio, Artifactory, Nexus, GitHub Packages 같은 내부 registry에 mirror할 때 | 내부 registry 접근 |
| developer local checkout | Tiny-Chu 자체를 개발하거나 로컬 소스 변경을 빠르게 검증할 때 | 로컬 checkout과 그 dependency 접근 |

운영 폐쇄망에는 offline bundle을 사용한다. developer local checkout은 빌드 산출물과 실제 release asset의 상태가 달라질 수 있으므로 개발 검증 용도로만 둔다.

## 2단계: release asset download

폐쇄망에 들어가기 전, 연결 가능한 release machine에서 Tiny-Chu release asset을 받는다.

- `tiny-chu-offline-vX.Y.Z.tar.gz`
- checksum 파일, 보통 `SHA256SUMS`
- 조직 정책상 필요한 provenance, SBOM, source archive

offline bundle의 기본 구조는 아래와 같다.

```text
tiny-chu-offline-vX.Y.Z/
  manifest.json
  SHA256SUMS
  install-offline.sh
  install-offline.ps1
  README-offline.md
  LICENSE
  vendor/
    tiny-chu-vX.Y.Z-bundled.tgz
  templates/
    opencode/
      package.json
      tui.json
      plugins/
        tiny-chu.ts
        tiny-chu-tui.ts
```

release asset을 폐쇄망으로 옮기기 전에 checksum을 검증한다.

```bash
sha256sum -c SHA256SUMS
```

macOS에서는 아래 명령을 사용한다.

```bash
shasum -a 256 -c SHA256SUMS
```

## 3단계: maintainer용 offline bundle 생성

maintainer는 인터넷에 연결된 release machine에서 새 offline bundle을 만들고 검증한다.

```bash
git clone <tiny-chu-repository-url>
cd Tiny-Chu
npm install
npm test
npm run release:offline -- --out /tmp/tiny-chu-release
npm run verify:offline -- --bundle /tmp/tiny-chu-release/tiny-chu-offline-vX.Y.Z.tar.gz
```

release version은 `package.json.version`에서만 가져온다. installer script나 문서에 별도 version 문자열을 손으로 입력하지 않는다.

`verify:offline`은 fresh temporary `.opencode` consumer, empty npm cache, dead registry를 사용해야 한다. 예를 들어 `npm_config_registry=http://127.0.0.1:9/`를 설정하면 네트워크 fallback이 성공처럼 보이는 상황을 막을 수 있다.

## 4단계: 폐쇄망으로 bundle 반입

검증된 `tiny-chu-offline-vX.Y.Z.tar.gz`와 checksum/provenance 파일을 폐쇄망으로 복사한다. 대상 프로젝트 근처나 내부에서 압축을 푼다.

```bash
tar -xzf tiny-chu-offline-vX.Y.Z.tar.gz
```

압축 해제 후 `manifest.json`, `SHA256SUMS`, `LICENSE`, `vendor/tiny-chu-vX.Y.Z-bundled.tgz`, `templates/opencode/`가 있는지 확인한다.

## 5단계: 대상 프로젝트 `.opencode` 준비

대상 프로젝트에 OpenCode plugin layout을 만든다.

```bash
mkdir -p target-project/.opencode
cp -R tiny-chu-offline-vX.Y.Z/templates/opencode/. target-project/.opencode/
mkdir -p target-project/.opencode/vendor
cp tiny-chu-offline-vX.Y.Z/vendor/tiny-chu-vX.Y.Z-bundled.tgz target-project/.opencode/vendor/
```

결과는 아래 형태여야 한다.

```text
target-project/
  .opencode/
    package.json
    tui.json
    plugins/
      tiny-chu.ts
      tiny-chu-tui.ts
    vendor/
      tiny-chu-vX.Y.Z-bundled.tgz
```

`templates/opencode/`가 제공하는 기본 `.opencode/package.json`은 local tarball dependency를 가리켜야 한다.

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "tiny-chu": "file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz"
  }
}
```

## 6단계: `.opencode` 안에서 offline install 실행

설치는 대상 프로젝트의 `.opencode` 디렉터리 안에서 실행한다.

```bash
cd target-project/.opencode
npm install --offline --cache /tmp/tiny-chu-empty-cache --ignore-scripts --no-audit --fund=false
```

Windows PowerShell에서는 사용자가 쓸 수 있는 cache 경로를 지정한다.

```powershell
cd C:\path\to\target-project\.opencode
npm install --offline --cache "$env:TEMP\tiny-chu-empty-cache" --ignore-scripts --no-audit --fund=false
```

### offline audit/SBOM 대체 정책

offline install과 `verify:offline`의 `--no-audit`는 의도된 정책이다. `npm audit`는 registry advisory 데이터에 접근해야 하므로 폐쇄망, dead registry, empty cache 검증에서는 신뢰할 수 있는 offline 판정이 아니다. Tiny-Chu는 offline 경로에서 npm audit나 SBOM 생성을 강제하지 않는다.

현재 Tiny-Chu가 제공하는 대체 추적 표면은 아래와 같다.

- `package-lock.json`의 `integrity` 값: 연결된 release machine에서 해석한 dependency tarball 무결성 기록이다.
- offline bundle `manifest.json`의 `dependencyClosure`: bundle에 포함된 dependency closure를 기록한다.
- bundle `SHA256SUMS`: `manifest.json`, installer, `LICENSE`, vendor tarball 같은 release artifact의 외부 checksum이다.
- 조직이 제공하는 provenance와 source archive: release 입력과 빌드 출처를 추적할 때 함께 보관한다.
- 조직 정책상 필요한 SBOM: Tiny-Chu installer가 offline 환경에서 새로 만들지 않으며, 필요한 경우 연결된 환경에서 생성해 release asset과 함께 반입한다.

따라서 폐쇄망 안에서는 `--no-audit`를 제거해 online advisory 조회를 시도하지 않는다. audit/SBOM 요구가 있는 조직은 release machine에서 별도 보안 검토와 SBOM 생성을 수행하고, 그 결과를 `SHA256SUMS`, provenance, source archive와 함께 보관한다.

bundle에 installer script가 포함되어 있으면 수동 copy/install 절차 대신 사용할 수 있다.

```bash
./install-offline.sh /path/to/target-project
```

```powershell
.\install-offline.ps1 -TargetProject C:\path\to\target-project
```

## 7단계: OpenCode shim 확인

Tiny-Chu는 runtime plugin download가 아니라 project-local OpenCode shim으로 로드된다.

`target-project/.opencode/plugins/tiny-chu.ts`는 package subpath에서 OpenCode adapter를 export한다.

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "tiny-chu/opencode";
```

`target-project/.opencode/tui.json`은 TUI shim을 켠다.

```json
{
  "plugin": ["./plugins/tiny-chu-tui.ts"]
}
```

`target-project/.opencode/plugins/tiny-chu-tui.ts`는 dashboard plugin을 export한다.

```ts
export { default } from "tiny-chu/tui";
```

TUI plugin은 `home_logo`를 `TinyChu`로 유지하고 `home_prompt_right`, `sidebar_title`, `sidebar_content`, `sidebar_footer`, `home_bottom`에 task, workflow, public job, context/evidence, health 상태를 표시한다.

Dashboard는 OpenCode-visible `dashboard_snapshot` tool을 사용한다. 이 tool은 기존 `.tiny` task, public job, workflow, evidence, context 상태를 읽으며 새 dashboard state store를 만들지 않는다. provider network preflight는 기본값에서 꺼져 있고 `includeProviderPreflight`가 명시될 때만 실행한다.

## 8단계: runtime mode 선택

Tiny-Chu runtime mode는 OpenCode의 deprecated top-level `mode` object가 아니라 Tiny-Chu plugin option으로 선택한다. mode 1은 worker-only, mode 2는 orchestrator + worker surface이며 기본값이다.

```json
{
  "plugin": [["tiny-chu", { "mode": 1 }]]
}
```

```json
{
  "plugin": [["tiny-chu", { "mode": 2 }]]
}
```

local shim에서 mode를 고정하려면 OpenCode options를 보존한 채 Tiny-Chu adapter로 넘긴다.

```ts
export const TinyChu = (input, options) =>
  TinyChuOpenCodePlugin(input, { ...options, mode: 1 });
```

라이브러리 직접 사용도 named mode를 받는다.

```ts
createTinyChuPlugin({ mode: "worker" });
createTinyChuPlugin({ mode: "orchestrator_worker" });
```

## 9단계: 설치 검증

아래 명령은 `target-project/.opencode`에서 실행한다.

```bash
node --input-type=module -e "import { createTinyChuPlugin } from 'tiny-chu'; console.log(typeof createTinyChuPlugin)"
node --input-type=module -e "import { TinyChuOpenCodePlugin } from 'tiny-chu/opencode'; console.log(typeof TinyChuOpenCodePlugin)"
node --input-type=module -e "const m = await import('tiny-chu/tui'); console.log(m.default.id, typeof m.default.tui)"
```

첫 두 명령은 `function`을 출력해야 한다. TUI 명령은 `tiny-chu.logo function`을 출력해야 한다.

OpenCode tool 노출 상태는 `tiny_chu_install_check`로 확인한다.

```bash
node --input-type=module -e "import { createTinyChuPlugin } from 'tiny-chu'; const tiny=createTinyChuPlugin({ root: process.cwd() }); console.log(await tiny.tools.tiny_chu_install_check({}));"
```

기대하는 상태는 아래와 같다.

- OpenCode를 대상 프로젝트 root에서 시작한다.
- OpenCode가 `.opencode/plugins/tiny-chu.ts`를 발견한다.
- shim이 `tiny-chu/opencode`에서 `TinyChuOpenCodePlugin`을 import한다.
- OpenCode가 `.opencode/tui.json`을 읽고 `.opencode/plugins/tiny-chu-tui.ts`를 켠다.
- TUI shim이 `tiny-chu/tui`에서 dashboard plugin을 import한다.
- TUI plugin이 켜지면 `home_logo`에는 `TinyChu`가 보이고 dashboard slot이 채워진다.
- Tiny-Chu tool 목록에는 `tiny_chu_install_check`와 `dashboard_snapshot`이 포함된다.

## 10단계: internal registry 경로

조직 내부 registry에 Tiny-Chu와 production dependency가 mirror되어 있다면 이 경로를 쓴다.

```bash
cd target-project/.opencode
npm config set registry http://internal-registry.example/npm/
npm install tiny-chu@X.Y.Z --ignore-scripts --no-audit --fund=false
```

registry 설치도 project-local shim은 동일하다.

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "tiny-chu/opencode";
```

`.opencode/package.json`은 registry version을 pin할 수 있다.

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "tiny-chu": "X.Y.Z"
  }
}
```

## 11단계: developer local checkout 경로

Tiny-Chu 자체 개발이나 로컬 source smoke test가 목적일 때만 사용한다.

```bash
git clone <tiny-chu-repository-url>
cd Tiny-Chu
npm install
npm run build
npm test
```

별도 대상 프로젝트의 `.opencode/package.json`에서 로컬 checkout을 가리킨다.

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "tiny-chu": "file:/absolute/path/to/Tiny-Chu"
  }
}
```

local shim은 package subpath를 그대로 import한다.

```ts
export { TinyChuOpenCodePlugin as TinyChu } from "tiny-chu/opencode";
```

이 경로는 빠른 반복에는 편하지만 release bundle과 dependency 상태가 달라질 수 있다. 운영 배포 판단은 offline bundle 또는 internal registry 검증 결과를 기준으로 한다.

## 문제 해결

### `ENOTCACHED` during `npm install --offline`

`ENOTCACHED`는 npm이 offline cache나 local tarball dependency 안에 없는 package를 해석하려 했다는 뜻이다. offline bundle 경로에서는 아래를 확인한다.

- `.opencode/package.json`이 `file:./vendor/tiny-chu-vX.Y.Z-bundled.tgz`를 가리키는가.
- bundled tarball이 `.opencode/vendor/` 아래에 있는가.
- 설치 명령을 `.opencode` 안에서 실행했는가.
- 일반 source package tarball이 아니라 release offline bundle을 사용했는가.

### stale `dist`

developer local checkout에서 package import가 실패하면 Tiny-Chu를 다시 빌드한다.

```bash
npm run build
```

release packaging이나 검증에서는 오래된 generated `dist/`를 믿지 않는다.

### Node 또는 npm version mismatch

버전을 확인한다.

```bash
node --version
npm --version
```

Node.js `>=20.18.0`을 사용한다. npm 동작이 machine마다 다르면 target environment와 같은 Node/npm 계열에서 release bundle을 다시 만들고 `verify:offline`을 실행한다.

### `spawn npm ENOENT` during `release:offline`

`npm run release:offline` 실행 중 `spawn npm ENOENT`가 나오면 release script 내부의 child npm 실행 파일 해석에 실패한 것이다. 최신 release script는 npm으로 실행된 경우 invoking npm CLI 경로를 기준으로 child npm을 실행한다. 아래 버전을 확인한 뒤 최신 코드를 받은 상태에서 release 명령을 다시 실행한다.

```bash
node --version
npm --version
npm run release:offline -- --out /tmp/tiny-chu-release
```

### PowerShell quoting

PowerShell에서 Node one-liner와 특수 문자가 들어간 path는 single quote를 우선 사용한다. native command argument가 쪼개지거나 재작성되면 아래를 설정한다.

```powershell
$PSNativeCommandArgumentPassing = 'Standard'
```

### permission 또는 cache 오류

현재 사용자가 쓸 수 있는 npm cache를 지정한다.

```bash
npm install --offline --cache /tmp/tiny-chu-empty-cache --ignore-scripts --no-audit --fund=false
```

Windows에서는 보호된 system path 바깥의 writable cache를 사용한다.

```powershell
npm install --offline --cache "$env:TEMP\tiny-chu-empty-cache" --ignore-scripts --no-audit --fund=false
```

권한 문제가 계속되면 이 설치를 위해 직접 만든 임시 cache directory만 제거하고 다시 실행한다. 공유 npm cache나 관련 없는 프로젝트 상태는 삭제하지 않는다.
