# Changelog

All notable changes to Tiny-Chu are documented here.

The format follows Keep a Changelog, and Tiny-Chu version numbers follow SemVer.

## [Unreleased]

### Added

### Changed

### Fixed

### Security

## [0.1.0] - 2026-06-16

### Added

- Added OpenCode runtime mode selection with `worker` and `orchestrator_worker` modes.
- Added mode parsing for direct `createTinyChuPlugin({ mode })` usage and OpenCode plugin tuple/options input.
- Added `runtimeMode` to `tiny_chu_install_check` and `TINY_CHU_MODE` to OpenCode shell metadata.
- Added mode-aware feature package graph behavior so worker mode excludes public queue, workflow orchestration, and button workflow dispatch surfaces.
- Added runtime-mode tests covering exposed tools, state creation boundaries, health output, and tool descriptions.

### Changed

- Default runtime behavior remains orchestrator-worker mode when mode is omitted.
- Worker mode now avoids creating unnecessary `.tiny/public-jobs` state and rejects `worker_packet_optimizer({ dispatch: true })` before state writes.
- Runtime instructions, orchestration health, tool usage planning, retry policy, and OpenCode tool descriptions now reflect the selected mode.
- Documentation was updated for OpenCode plugin tuple examples, local shim forwarding, direct library usage, default mode behavior, and feature package graph behavior.

### Fixed

- Hidden worker-mode surfaces no longer advertise unavailable public-job or workflow orchestration behavior.

### Security

- No security fixes were shipped in this release.

