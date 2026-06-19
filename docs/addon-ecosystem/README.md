# Tiny-Chu Add-on 생태계 분석 (Tiny-Chu / Tinker.Gen / ui_pop)

## 목적

이 문서집은 **Tiny-Chu를 host(호스트)** 로, **Tinker.Gen** 과 **ui_pop** 을 **add-on(애드온)** 으로 구성하려는 목표 아키텍처를 분석한 결과를 정리합니다. 세 프로젝트의 구조·인터페이스·통합 계약을 조사하고, 이 아키텍처가 만들어내는 **기능적/비기능적 요구사항**, 그리고 **장점·단점·개선점** 을 도출합니다.

> ⚠️ **이 문서집은 분석과 계획만 담습니다. 실제 코드 구현은 포함하지 않습니다.** 구현 로드맵은 [05-implementation-roadmap.md](./05-implementation-roadmap.md) 에 계획으로만 정리되어 있습니다.

## 핵심 발견 (TL;DR)

> **Add-on 계약은 설계되었으나 아직 구축되지 않았다.**
>
> - `ExternalAddon` 호스트 계약(`ExternalAddonDescriptor` / `createExternalAddonFeaturePackage()`)은 Tiny-Chu `src/` 에 **구현체가 없음**(grep 검증 0건).
> - Tinker.Gen은 bridge descriptor를 **부분적으로** 구현했으나, 문서와 실제 명령명이 **불일치**(`integration tiny-chu print` vs `integration opencode print`).
> - ui_pop은 addon 계약을 **전혀** 따르지 않음 — 완전히 독립적인 CLI.
> - 결과적으로 현재는 "add-on이 작동하는" 상태가 아니라 **독립 CLI 3개** 가 존재함.

자세한 배경은 [01-architecture-analysis.md](./01-architecture-analysis.md) 를 참고하세요.

## 문서 인덱스

| 문서 | 내용 |
|---|---|
| [01-architecture-analysis.md](./01-architecture-analysis.md) | 현재(As-Is) vs 목표(To-Be) 아키텍처, 3계층 adapter 패턴, 컴포넌트 요약 |
| [02-requirements.md](./02-requirements.md) | 기능적 요구사항(FR) / 비기능적 요구사항(NFR) 분석 |
| [03-gaps-and-improvements.md](./03-gaps-and-improvements.md) | 장점 · 단점/위험 · 개선점(P0~P2 우선순위) |
| [04-component-profiles.md](./04-component-profiles.md) | 세 프로젝트 개별 상세 프로파일 (구조·인터페이스·진입점) |
| [05-implementation-roadmap.md](./05-implementation-roadmap.md) | Phase 0~3 구현 로드맵, 수용 기준, 금지선 (**계획만, 구현 안 함**) |

## 관련 문서

- Tiny-Chu 자체 아키텍처: [../architecture/README.md](../architecture/README.md)
- Tinker.Gen 결합 아키텍처(원본 설계 문서): `../../../../Tinker.Gen/docs/tinychu-tinkergen-coupling-architecture.md`
- 확장 가이드: [../architecture/09-extending-guide.md](../architecture/09-extending-guide.md)

## 조사 범위 및 방법

- 조사 일시: 2026-06-19 기준
- 조사 대상: `Tiny-Chu/`, `Tinker.Gen/`, `ui_pop/` 세 저장소
- 방법: 각 저장소 구조 탐색(README/package.json/src 트리) + 핵심 통합 계약 문서 직독 + 심볼 grep 교차 검증
- 한계: 세 저장소는 별도 git 리포지토리로, 이 문서는 Tiny-Chu `docs/` 하위에 host 관점에서 작성됨
