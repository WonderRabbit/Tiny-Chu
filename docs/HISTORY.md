# Tiny-Chu History

이 문서는 `docs/` 아래에서 찾을 수 있는 Tiny-Chu 변경 이력 입구다.

Canonical release history는 루트 [CHANGELOG.md](../CHANGELOG.md)에 기록한다. `CHANGELOG.md`는 Keep a Changelog 형식을 따르고, release checklist와 tag 절차는 [CONTRIBUTING.md](../CONTRIBUTING.md)를 기준으로 한다.

## Current Released History

- `0.1.0` - 2026-06-16
  - OpenCode runtime mode selection을 추가했다.
  - worker mode와 orchestrator-worker mode를 분리했다.
  - mode-aware feature package graph, install-check runtime metadata, runtime-mode tests를 추가했다.

## Unreleased Local History

- 2026-06-18
  - 작은 모델 기여도 평가기를 추가했다.
  - `small_model_contribution_evaluation`은 22개 rubric row, 0/1/2 점수, `normalizedScore`, score band, load factor, `blockedReasons`, `fixPaths`를 fixture 기반으로 계산한다.
  - CLI runner와 보고서, registry/tool count 문서, recovery-focused test를 추가해 live Qwen/provider 호출 없이 평가 evidence를 남긴다.

- 2026-06-17
  - GitHub Actions `CI / verify` PR gate를 추가했다.
  - 게이트는 `npm run build`, `npm test`, `npm run pack:check`, offline bundle 생성, `verify:offline -- --bundle` 검증을 순서대로 실행한다.
  - `test/github-actions-workflow.test.mjs`로 workflow trigger, read-only permission, job/check 이름, command order, forbidden publish/deploy scope를 정적으로 검증한다.

## Local History Files

- [../CHANGELOG.md](../CHANGELOG.md): canonical release changelog.
- [HYSTORY.md](./HYSTORY.md): misspelled legacy path kept as a compatibility pointer.

새 변경 이력은 이 파일이 아니라 `CHANGELOG.md`의 `## [Unreleased]` 아래에 먼저 기록한다.
