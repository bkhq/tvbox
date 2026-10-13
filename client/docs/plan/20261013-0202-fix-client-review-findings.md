# 20261013-0202-fix-client-review-findings Fix client review findings

- **status**: completed
- **createdAt**: 2026-10-13 02:02
- **approvedAt**: 2026-10-13 02:02
- **relatedTask**: 20261013-0202-fix-client-review-findings

## Context

The audit reproduced four runtime defects and traced the missing Live entry. The latest checkout is 03fde22; the affected implementations remain unchanged. Existing tests do not cover these transitions.

## Proposal

1. Treat native playback-state callbacks as confirmations of controlled pause intent; keep buffering and seeking from becoming user pauses.
2. Add a Live button to the existing Home navigation, including empty and error states.
3. Guard config publication after asynchronous boundaries and serialize config activation side effects so stale cleanup cannot affect the current config.
4. Share JSON-cell write ordering by store identity and key, preserving independent keys and stores.
5. Pause covered VOD screens before leaving them uncontrolled; prevent hidden screen input from restarting playback.

Write focused regression tests before each implementation. Run focused suites, then the full Jest suite, lint, and typecheck. Review the final diff locally.

## Risks

Preserve explicit user pause, background-app behavior, config loading error recovery, and storage isolation. Native playback is exercised through adapter and screen tests; no device is assumed available.

## Scope

Client playback adapter and screen, Home navigation, config bootstrap and JAR activation, JSON storage helper, related tests, and task tracking. No dependency changes, commits, or pushes.

## Alternatives

Use the existing controlled player state and storage APIs instead of adding a playback service or replacing persistence.

## Annotations

Implementation approved by the user's instruction to start fixing the reported findings.

Verification completed at 2026-10-13 02:12 UTC: 89 Jest suites and 895 tests passed; lint, typecheck, and diff whitespace checks passed. Local review covered all changed logic and regression tests. Native device playback was not exercised.
