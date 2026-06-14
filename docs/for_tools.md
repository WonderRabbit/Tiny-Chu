# 모델 부하 감소를 위한 CLI 툴 가이드

> 대상 환경: **Windows 10 + PowerShell 7.6 (`pwsh`)** + Windows Package Manager (`winget`)
> 이 문서는 Tiny-Chu가 참조하는 네이티브 CLI 툴(`src/opencode/powershell-tooling.ts`의 `POWERSHELL_TOOLING_PROFILE`)과, 그 관점에서 추가로 추천하는 툴들을 정리한다.

---

## 왜 이 툴들이 모델(LLM) 부하를 줄이는가

작은 foreman 모델이 리포지토리 전체를 읽어 들이면 컨텍스트 창이 금방 포화되고 비용/지연이 폭증한다. Tiny-Chu는 모델이 **"전체 파일을 읽지 않고"** 필요한 만큼만 뽑아내도록, 다음 특성을 가진 네이티브 CLI 툴들을 전제한다.

| 부하 감소 원리 | 기여 툴 |
|---|---|
| **결정론적 기계 가독 출력** (`--json`, `-o json`) — 파싱 실패/환각 방지 | jq, yq, mdq, ast-grep, ripgrep, dasel |
| **구조적(structural) 검색** — 정규식 함정 없이 AST/문법 기반 매칭 | ast-grep |
| **바운디드 스니펫 추출** — 행/컬럼 증거만 회수, 전체 파일 미로딩 | ripgrep, fd, mdq |
| **포맷 간 변환** — YAML↔JSON↔TOML 단일 도구 | yq, dasel |
| **`.gitignore` 인식** — 노이즈(node_modules, dist) 자동 제외 | fd, ripgrep |
| **구조적 diff / 코드 계량** — 모델이 임의 비교·추정하는 부담 제거 | difftastic, tokei/scc |

이 툴들의 공통 사용 원칙(프로젝트 `powershell-tooling.ts`의 셸 문법 규칙 요약):
1. PowerShell 별칭(`cat`, `ls`, `find` 등)이 아닌 **실제 실행 파일 이름**으로 호출
2. 패턴·정규식·선택자는 **작은따옴표**로 감싸 PowerShell이 `$`, `[]`, `{}`, `|`, 백틱을 확장하지 않게 함
3. `-`로 시작하는 패턴/경로 앞에는 툴 자신의 `--` 구분자 삽입
4. 가급적 `--json`/`-o json` + `ConvertFrom-Json` 사용 (텍스트 파싱 지양)
5. PowerShell 7+ 세션에서는 `$PSNativeCommandArgumentPassing = 'Standard'` 설정
6. 환경 기본값: `NO_COLOR=1`, `FD_OPTIONS=--color=never`

---

## 전제 환경 준비 (Windows 10 / PowerShell 7.6)

```powershell
# 1. winget은 Windows 10 1809(App Installer) 이후 기본 포함. 버전 확인
winget --version

# 2. PowerShell 7.6 별도 설치 필요 시
winget install --id Microsoft.PowerShell --source winget

# 3. 이후 모든 네이티브 툴 호출 전 세션에서 권장
$PSNativeCommandArgumentPassing = 'Standard'   # PS 7.3+
$env:NO_COLOR = '1'
```

> winget 패키지 ID가 없는 툴(mdq)은 GitHub Releases에서 직접 바이너리를 받아 PATH에 추가한다.

---

## A. 프로젝트에 명시된 핵심 6개 툴

> `POWERSHELL_TOOLING_PROFILE.nativeTools`에 등록된 툴. Tiny-Chu 오케스트레이션 프로필이 이들을 "real native executables"로 전제한다.

### 1. jq — JSON 프로세서

- **역할**: JSON 필터링·생성. JSON을 전체 읽지 않고 스칼라 값/배열만 뽑아낸다.
- **공식 리포지토리**: https://github.com/jqlang/jq (구 `stedolan/jq`에서 2023년 `jqlang` 조직으로 이관)
- **공식 사이트**: https://jqlang.org · **릴리스**: https://github.com/jqlang/jq/releases (최신 안정 **1.8.0**, 이후 패치 존재)
- **활용**: `package.json`에서 특정 스크립트 추출, `.tiny/**/*.json` 상태 파싱, Tiny-Chu 툴의 `--json` 출력 후 처리.
- **설치**:
  ```powershell
  winget install jqlang.jq
  ```
- **Tiny-Chu 권장用法**:
  ```powershell
  jq -r '.scripts.test' package.json
  jq -n --arg name $Name '{name: $name}'          # PowerShell 변수를 $field로 끼워넣지 말 것
  Get-Content -Raw file.json | jq -c '.[]'        # stdin이 더 깔끔할 때
  ```

### 2. yq — YAML/JSON/TOML/XML 프로세서 (Mike Farah, Go v4)

- **역할**: YAML을 비롯한 다중 포맷 쿼리·변환. **주의: `kislyuk/yq`(Python, jq 래퍼)와 문법이 다르다.** 프로젝트는 Mike Farah v4 문법을 전제한다.
- **공식 리포지토리**: https://github.com/mikefarah/yq
- **문서**: https://mikefarah.gitbook.io/yq · **릴리스**: https://github.com/mikefarah/yq/releases
- **활용**: OpenCode/opencode 구성(`opencode.json` 등 YAML) 파싱, `-o json`으로 jq와 파이프라인 연계.
- **설치**:
  ```powershell
  winget install MikeFarah.yq
  ```
- **Tiny-Chu 권장用法**:
  ```powershell
  yq -o json '.scripts' package.json
  yq -r '.name' package.json                       # -o json/-o yaml로 포맷 명시 고정
  ```

### 3. mdq — Markdown 용 "jq"

- **역할**: Markdown에서 헤딩·체크박스·코드블록 등 요소를 선택자 문법으로 추출. 정규식으로 체크박스/헤딩을 파싱하는 함정을 피한다.
- **공식 리포지토리**: https://github.com/yshavit/mdq (※ `yshui`가 아님 — 저자는 **yshavit**)
- **릴리스**: https://github.com/yshavit/mdq/releases (Rust 바이너리). **v0.6.0부터 target-tuple 기반 파일명 사용**.
- **활용**: `AGENTS.md`, `.tiny/plans/*.md`의 체크박스 진행 상태 추출, README 섹션 발췌. `--output json`으로 jq와 연계.
- **설치** (winget 없음 — GitHub Releases에서 Windows 바이너리 직접 다운로드):
  ```powershell
  # 릴리스 페이지에서 x86_64-pc-windows-msvc.zip (또는 v0.6.0+ target-tuple 자산) 다운로드 후
  Expand-Archive mdq-<version>-x86_64-pc-windows-msvc.zip $env:LOCALAPPDATA\mdq
  # PATH에 $env:LOCALAPPDATA\mdq 추가 후
  mdq --version
  ```
- **Tiny-Chu 권장用法**:
  ```powershell
  mdq '- [ ]' README.md                            # 미완료 체크박스 추출 (작은따옴표 필수)
  mdq --output json '# Usage | ```bash' README.md | jq -r '.items[].text'
  ```

### 4. fd — 빠른 파일/디렉터리 탐색 (`find` 대안)

- **역할**: `find`보다 빠르고 직관적인 파일 탐색. **기본적으로 `.gitignore`를 존중**하여 `node_modules`, `dist`를 자동 제외 → 모델이 노이즈를 컨텍스트에 끌어들이지 않음.
- **공식 리포지토리**: https://github.com/sharkdp/fd · **릴리스**: https://github.com/sharkdp/fd/releases (최근 버전은 최소 Rust 1.90.0 기반, Windows 7 지원 중단)
- **활용**: `Get-ChildItem -Recurse` 대신 결정론적 파일 목록 생성, Tiny-Chu `repo_map`/`fd` 기반 인벤토리.
- **설치**:
  ```powershell
  winget install sharkdp.fd
  ```
- **Tiny-Chu 권장用法**:
  ```powershell
  fd --type f --extension ts . src
  fd --type f --exclude node_modules --exclude dist
  fd --hidden --exclude .git --type f 'AGENTS\.md'
  ```

### 5. ast-grep (sg) — Tree-sitter 구조적 코드 검색/재작성

- **역할**: 정규식이 아닌 **AST 기반**으로 코드 패턴을 매칭·치환. Tiny-Chu가 "구조 인식 리팩터"용으로 전제하는 핵심 툴.
- **공식 리포지토리**: https://github.com/ast-grep/ast-grep · **사이트**: https://ast-grep.github.io/ · **릴리스**: https://github.com/ast-grep/ast-grep/releases
- **활용**: 특정 호출 패턴(예: `console.log(...)`)을 언어별로 안전하게 검색, `--json=stream`으로 기계 가독 매치. Tiny-Chu `business_logic_map`의 후속 `ast-grep` 추천.
- **설치**:
  ```powershell
  winget install ast-grep.ast-grep
  # 대안: scoop install ast-grep | cargo install ast-grep | npm i -g @ast-grep/cli
  ```
- **Tiny-Chu 권장用法** (메타변수 `$A`/`$$$ARGS`는 반드시 작은따옴표):
  ```powershell
  ast-grep run --lang ts -p 'console.log($$$ARGS)' src
  ast-grep scan -c sgconfig.yml --json=stream
  ```

### 6. ripgrep (rg) — 빠른 재귀 텍스트 검색

- **역할**: `grep -R` 대안. **`.gitignore` 준수**, 숨김 파일 기본 스킵. `--json`으로 행/컬럼 증거를 기계 가독으로 반환 → 모델이 바운디드 스니펫만 확보.
- **공식 리포지토리**: https://github.com/BurntSushi/ripgrep · **사이트**: https://ripgrep.dev · **릴리스**: https://github.com/BurntSushi/ripgrep/releases (최신 메이저 **15.0.0**, 2025-10)
- **활용**: Tiny-Chu `context_digest`/`repo_map`의 근간. `--files`로 gitignore 인식 파일 목록, `-g`로 include/exclude 글로브.
- **설치**:
  ```powershell
  winget install BurntSushi.ripgrep.MSVC    # MSVC 빌드 권장 (GNU 빌드도 있음)
  ```
- **Tiny-Chu 권장用法**:
  ```powershell
  rg --line-number --column --no-heading 'createTinyChuPlugin' src test
  rg --json 'export .*TaskStore' src                 # jq와 연계
  rg --files -g '*.ts' -g '!dist/**'
  ```

---

## B. Tiny-Chu safeTooling/nativePreviews 선택 툴

`safeTooling: true`와 `nativePreviews: true`를 함께 켠 경우에만 아래 preview 도구가 OpenCode tool surface에 추가된다. 기본 registry에는 포함되지 않으며, 실행 파일이 없으면 자동 설치하지 않고 unavailable/degraded 결과를 반환한다.

`safeTooling: true`가 추가하는 source mutation 및 artifact publish 도구:

| Tiny-Chu tool | 역할 |
|---|---|
| `safe_patch_check` | allowlist, expected hash, symlink/path escape, `git apply --check`를 source write 없이 검증 |
| `safe_patch_apply` | check와 같은 expected hash가 유지될 때만 allowlisted patch를 source target에 적용 |
| `artifact_workspace_prepare` | source repo 밖 OS temp workspace 준비 |
| `artifact_workspace_commit` | 생성 산출물을 isolated workspace 내부 `.git`에만 commit |
| `artifact_publish_manifest` | allowlisted publish target과 source/target hash manifest 생성 |
| `artifact_publish_apply` | manifest와 current target hash가 일치할 때만 source repo에 publish |
| `powershell_toolchain_probe` | `pwsh` version/cwd/UTF-8/JSON/native command behavior 점검 |
| `run_diagnostics` | `npm run build`, `npm test` 같은 advisory diagnostics 실행 |

`nativePreviews: true`가 추가하는 preview-only 도구:

| Tiny-Chu tool | 실행 파일 | 역할 | 쓰기 정책 |
|---|---|---|---|
| `structural_search_ast` | `ast-grep` | TypeScript/코드 구조 검색 preview | source write 없음 |
| `structural_rewrite_preview` | `ast-grep` | 구조적 rewrite 결과 preview | 실제 mutation은 `safe_patch_check`/`safe_patch_apply` 경유 |
| `json_yaml_transform_preview` | `jq`, `yq` | JSON/YAML transform preview | source write 없음 |
| `json_patch_preview` | `jd` | JSON/YAML 구조적 patch preview | publish는 artifact workspace/manifest 경유 |

`jd`는 JSON diff/patch preview용 선택 실행 파일이다. 프로젝트 tool metadata에는 `json_patch_preview`의 required native tool로만 등장하며, PowerShell profile의 핵심 6개 도구에는 포함되지 않는다.

설치/검증은 환경별 package manager 또는 release binary를 사용하되, Tiny-Chu 관점의 요구사항은 실행 파일 이름이 `jd`로 PATH에서 해석되는 것이다.

```powershell
jd --version
```

safe source edit 순서:

1. `safe_patch_check`로 allowlist, expected hash, symlink/path escape, patch 적용 가능성을 먼저 확인한다.
2. `safe_patch_apply`는 check와 같은 expected hash가 유지될 때만 source target을 쓴다.
3. generated docs/report는 `artifact_workspace_prepare`에서 만들고, `artifact_publish_manifest`와 `artifact_publish_apply`로 source repo에 publish한다.
4. `run_diagnostics`는 `npm run build`, `npm test` 같은 advisory 확인이며 mutation gate 자체가 아니다.

## C. 추천 추가 툴 (모델 부하 관점)

프로젝트 6개 툴을 보완하는, 동일한 원칙(결정론적·기계 가독·구조적)을 가진 툴들.

### 7. dasel — 다중 포맷 데이터 선택기 (jq+yq 통합 대안)

- **역할**: JSON, YAML, TOML, XML, CSV, INI, HCL 등을 **단일 선택자 문법**으로 select/put/delete. jq와 yq를 하나로 통합하고 싶을 때.
- **공식 리포지토리**: https://github.com/TomWright/dasel (GitHub URL은 대소문자 무관; canonical `TomWright/dasel`)
- **문서**: https://daseldocs.tomwright.me · **릴리스**: https://github.com/TomWright/dasel/releases
- **왜 추천**: 모델이 포맷별로 jq/yq 문법을 각각 기억해야 하는 부담을 하나의 문법으로 줄임. 단점은 jq 표현력(고차 함수 등)에는 못 미침.
- **설치**:
  ```powershell
  winget install TomWright.dasel
  ```
- **用法 예**:
  ```powershell
  dasel select -f package.json '.scripts.test'
  dasel select -f opencode.json -w json '.models'   # YAML→JSON 변환
  ```

### 8. difftastic (difft) — 구조적 diff

- **역할**: 줄 단위가 아닌 **구문(AST) 기반 diff**. 의미 없는 공백/포맷 변경에 흔들리지 않고 실제 변경만 표시.
- **공식 리포지토리**: https://github.com/Wilfred/difftastic · **문서**: https://difftastic.wilfred.me.uk
- **왜 추천**: 모델이 `git diff`의 잡음(자동 포맷터 변경 등)을 컨텍스트로 끌어들이지 않도록 필터링.
- **설치**:
  ```powershell
  winget install Wilfred.difftastic
  # git difftool로 연결 가능
  git config --global diff.external difft
  ```

### 9. bat — 구문 강조 `cat` 대안

- **역할**: `cat` + 구문 강조 + Git 통합 + 행 번호. 파일을 모델에게 보여줄 때 가독성 향상(표준출력은 일반 텍스트).
- **공식 리포지토리**: https://github.com/sharkdp/bat · **릴리스**: https://github.com/sharkdp/bat/releases
- **왜 추천**: `--plain`/`-p`로 장식 끄면 파이프라인에 안전하게 사용 가능. `bat -p --color=never`로 jq 등에 먹이기 좋음.
- **설치**:
  ```powershell
  winget install sharkdp.bat
  ```

### 10. gh — GitHub 공식 CLI

- **역할**: PR, 이슈, 릴리스, API 호출을 터미널에서. Tiny-Chu `git_weekly_report`가 로컬 git 증거만 쓰는 것과 보완적으로, 원격 PR/review/CI 메타데이터 확보.
- **공식 리포지토리**: https://github.com/cli/cli · **릴리스**: https://github.com/cli/cli/releases
- **설치**:
  ```powershell
  winget install GitHub.cli
  gh auth login                                    # 최초 인증
  ```

### 11. glow — 터미널 Markdown 렌더러/TUI

- **역할**: Markdown을 터미널에서 예쁘게 렌더. `README.md`, `AGENTS.md`, `.tiny/plans/*.md`를 브라우저 없이 검토.
- **공식 리포지토리**: https://github.com/charmbracelet/glow · **릴리스**: https://github.com/charmbracelet/glow/releases
- **왜 추천**: 모델이 생성한 마크다운 산출물(artifact)을 사람이 빠르게 리뷰 → 검증 루프 단축.
- **설치**:
  ```powershell
  winget install charmbracelet.glow
  ```

### 12. tokei — 초고속 코드 라인 카운터

- **역할**: 150+ 언어의 코드 라인 수를 초단위로 집계. 리포지토리 규모/언어 분포를 모델이 "추정"하지 않고 즉시 확보.
- **공식 리포지토리**: https://github.com/XAMPPRocky/tokei · **릴리스**: https://github.com/XAMPPRocky/tokei/releases
- **설치**:
  ```powershell
  winget install XAMPPRocky.Tokei
  ```

### 13. scc (Sloc, Cloc and Code) — 코드 계량 + 복잡도 + COCOMO

- **역할**: tokei와 유사하나 **복잡도(complexity) 계산**과 **COCOMO 비용 추정**을 추가 제공. 정확도/메트릭이 필요할 때 tokei 대안.
- **공식 리포지토리**: https://github.com/boyter/scc · **릴리스**: https://github.com/boyter/scc/releases
- **선택 기준**: 순수 속도 → **tokei**(Rust). 복잡도·COCOMO → **scc**(Go). 둘 다 winget 가능.
- **설치**:
  ```powershell
  winget install BenBoyter.scc
  ```

### 참고: 프로젝트가 이미 참조하는 기타 툴

- **mmdc (Mermaid CLI)** — README에 명시(`@mermaid-js/mermaid-cli`). Tiny-Chu `mermaid_check`/`mermaid_fix`가 가드하지만, 발행 전 `mmdc` 렌더 검증을 전제. 설치: `npm i -g @mermaid-js/mermaid-cli`(Puppeteer/Chromium 의존).
- **git** — `git_weekly_report`, `incremental_evidence_cache`(보조), 변경 전 `git status --short` / `git diff` 실행이 모델 의무. Windows용: `winget install Git.Git`.

---

## D. 한 번에 설치 (winget 일괄 스크립트)

```powershell
# PowerShell 7.6 — 관리자 권장
$tools = @(
  'jqlang.jq',
  'MikeFarah.yq',
  'sharkdp.fd',
  'ast-grep.ast-grep',
  'BurntSushi.ripgrep.MSVC',
  'TomWright.dasel',
  'Wilfred.difftastic',
  'sharkdp.bat',
  'GitHub.cli',
  'charmbracelet.glow',
  'XAMPPRocky.Tokei',
  'BenBoyter.scc',
  'Git.Git'
)
foreach ($id in $tools) { winget install -e --id $id --source winget }
# mdq만 별도: GitHub Releases에서 Windows 바이너리 수동 설치(위 §3 참조)
# jd도 package manager에 없으면 release binary를 받아 PATH에 추가한다.
```

설치 검증:

```powershell
jq --version; yq --version; fd --version; ast-grep --version; rg --version
dasel --version; difft --version; bat --version; gh --version; glow --version
tokei --version; scc --version; git --version; jd --version
```

---

## E. Tiny-Chu PowerShell Tooling Profile과의 매핑

`src/opencode/powershell-tooling.ts`의 `nativeTools`와 본 문서의 대응:

| Profile 툴 | 실행 파일 | 본 문서 절 | 비고 |
|---|---|---|---|
| jq | `jq` | A.1 | JSON |
| yq | `yq` | A.2 | Mike Farah v4 (Python 래퍼 아님) |
| mdq | `mdq` | A.3 | 저자 **yshavit** |
| fd | `fd` | A.4 | gitignore 자동 준수 |
| ast-grep | `ast-grep` | A.5 | 메타변수 작은따옴표 |
| ripgrep | `rg` | A.6 | `--json` 권장 |

Profile은 이 6개를 "real native executables"로 전제하며, PowerShell 별칭/Unix 전용(`grep -R`, `find -name`, `xargs`)을 명시적으로 **avoid**로 표시한다. `json_patch_preview`가 사용하는 `jd`와 dasel/difftastic/bat/tokei/scc 등 C절 툴들은 profile에 등록되어 있지 않지만, 동일한 셸 문법 규칙(작은따옴표·`--`·`--json`·`$PSNativeCommandArgumentPassing`)을 따른다.

---

## F. PowerShell에서 자주 틀리는 점 (체크리스트)

- [ ] 패턴을 큰따옴표로 감싸 `$field`가 PowerShell에 의해 확장됨 → **작은따옴표 사용**
- [ ] `find`/`grep`/`cat` PowerShell 별칭을 네이티브 툴로 착각 → **실제 실행 파일 이름** 사용
- [ ] `-`로 시작하는 경로/패턴을 위치 인자로 전달 → 툴의 **`--`** 구분자 먼저
- [ ] `here-doc`, 프로세스 치환, `xargs -0`, `VAR=value command` 같은 bash 전용 문법 사용 금지 → PowerShell **here-string** 또는 임시 UTF-8 파일
- [ ] 색상 코드가 출력에 섞여 파서 깨짐 → `$env:NO_COLOR='1'`, `FD_OPTIONS=--color=never`, `rg --color=never`
- [ ] 복잡한 인자 전달 누락 → `$PSNativeCommandArgumentPassing = 'Standard'`(PS 7.3+)
- [ ] jq 필터에 PowerShell 변수를 직접 끼워넣음 → `jq --arg name $value` 사용
