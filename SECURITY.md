# Security Policy

## Supported Versions

Tiny-Chu currently supports source checkouts and offline bundles for the current `0.1.x` line while `package.json.version` is `0.1.0`.

| Version | Source checkout | Offline bundle | Status |
| --- | --- | --- | --- |
| `0.1.x` | Supported | Supported | Current |
| Earlier versions | Not supported | Not supported | No security fixes planned |

## Reporting a Vulnerability

Do not open public issues for suspected vulnerabilities. Use the private reporting channel configured by the repository owner.

TODO: maintainer contact

If GitHub private vulnerability reporting is enabled for the repository, use that path. If it is not enabled, contact the maintainer through the private channel documented outside this repository.

Please include:

- Affected Tiny-Chu version or source commit.
- Whether the issue affects source checkout usage, offline bundle usage, or both.
- Reproduction steps and expected impact.
- Any logs, proof of concept, or affected files that can be shared safely.

## Response Windows

The maintainer target is:

- Initial response within 7 days.
- Status update at least every 30 days until the report is resolved or closed.

These are response targets, not a guarantee of fix availability for every report.

## Disclosure

Coordinated disclosure timing will be discussed with the reporter after triage. Public advisories, release notes, and `CHANGELOG.md` entries should avoid exposing exploit details before users have a reasonable update path.

## Admin Follow-Up

Repository administrators should configure and periodically verify:

- GitHub private vulnerability reporting.
- Security inbox coverage with backup maintainer access.
- Branch protection and required checks.
- Credential recovery inventory outside the repository.
- Release checklist rehearsal by a backup maintainer.

