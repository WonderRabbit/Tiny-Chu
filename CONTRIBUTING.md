# Contributing to Tiny-Chu

Tiny-Chu is intentionally small. Contributions should keep the file-backed orchestration model clear, deterministic, and easy to validate in a local checkout.

## Local Setup

Use the project scripts from `package.json`.

```bash
npm install
npm run build
npm test
```

For package or release-surface changes, also run:

```bash
npm run pack:check
```

## Issues

Use the GitHub issue templates when available:

- Bug reports should include the Tiny-Chu version or source checkout, runtime environment, reproduction steps, expected behavior, actual behavior, logs, and regression notes.
- Feature requests should describe the use case, proposed behavior, alternatives, scope boundaries, docs/tests impact, and compatibility risk.
- Security reports should follow [SECURITY.md](./SECURITY.md), not public issues.

## Pull Requests

Follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) in all project discussions and reviews. Open pull requests with a small, reviewable scope. A PR should include:

- Summary of the change and linked issue when one exists.
- Test evidence from `npm run build`, `npm test`, and any focused commands relevant to the change.
- Updated docs when behavior, installation, release, governance, or user-facing tool surfaces change.
- A `CHANGELOG.md` entry under `## [Unreleased]` for user-visible behavior, packaging, release, governance, or security-impacting changes.
- Confirmation that no release tag, push, or publish action was performed without separate user authorization.

When changing runtime behavior, add or update tests in `test/*.test.mjs`. When changing package contents or offline release artifacts, update `test/install-package.test.mjs`.

## Changelog

`CHANGELOG.md` is the canonical project history. Keep entries in Keep a Changelog style and reserve released sections for shipped versions. Do not use `docs/HYSTORY.md` for new entries; it is a legacy misspelled pointer.

## Release Checklist

`package.json.version` is the release version source of truth. Installer scripts and docs must not carry a separately typed version.

Before proposing a release tag:

1. Review `CHANGELOG.md` and ensure the release section matches `package.json.version`.
2. Run `npm run build`.
3. Run `npm test`.
4. Run `npm run pack:check`.
5. Build a disposable offline bundle, for example `npm run release:offline -- --out /tmp/tiny-chu-release`.
6. Verify it with `npm run verify:offline -- --bundle /tmp/tiny-chu-release/tiny-chu-offline-vX.Y.Z.tar.gz`.
7. Check current tag state with `git tag --list v0.1.0` for the current `0.1.0` readiness check, or `git tag --list vX.Y.Z` for a future version.

Annotated tag command examples:

```bash
git tag -a vX.Y.Z -m "tiny-chu vX.Y.Z"
git push origin vX.Y.Z
```

Those commands are documentation only. Do not run `git tag`, `git push`, or `npm publish` without separate user authorization at execution time. This package currently keeps `private: true`; do not change that as part of release preparation unless a separate release policy explicitly authorizes npm publication.

## Bus-Factor Handoff

Tiny-Chu currently assumes a small maintainer surface. To reduce single-maintainer risk, keep this checklist source-visible and rehearse it before releases:

- Assign a backup maintainer with repository admin access.
- Have the backup maintainer run the release checklist on a disposable checkout.
- Keep security inbox coverage documented outside the repository, with at least one backup recipient.
- Maintain a private credential recovery inventory outside the repository.
- Review branch protection, required checks, and tag protection as repository-admin follow-up.
- Review GitHub private vulnerability reporting as repository-admin follow-up.

Backup maintainer duties are to triage issues, verify security report intake still works, run build/test/package checks, confirm `CHANGELOG.md` and `package.json.version` alignment, and stop any release action that lacks explicit authorization.
