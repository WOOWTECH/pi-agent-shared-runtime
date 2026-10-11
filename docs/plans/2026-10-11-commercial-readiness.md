# Commercial Deployment Hardening Implementation Plan

**Goal:** Validate commercial deployment failure recovery without weakening permissions or changing unrelated packages.

**Architecture:** Retain deterministic installation, ownership-based synchronization and the Pi SDK bridge. Harden the long-running controller against transient configuration corruption and expose current failure/recovery state. Release gates must distinguish fixture coverage from third-party service certification.

**Tech Stack:** Node.js ESM, node:test, Pi SDK, Playwright GUI, npm shrinkwrap.

## 1. Fault recovery
Files: src/watch.mjs, tests/watch.test.mjs.
Reproduce a settings.json partial write in a child watcher. Assert process survival, degraded state, unchanged managed links, then restore settings and assert automatic recovery without CLI invocation. Run node --test tests/watch.test.mjs before and after the fix. Cover malformed startup and malformed last-sync metadata separately.

## 2. Dependency and deployment assessment
Files: package.json, npm-shrinkwrap.json, docs/COMMERCIAL-READINESS.md.
Run npm audit --omit=dev --json and inspect all results; fix actionable production vulnerabilities without speculative dependency upgrades. Document version pinning, rollback, retained login state, supported platform and explicit uncertified remote service behavior.

## 3. Release verification
Files: .github/workflows/test.yml, docs/COMMERCIAL-READINESS.md.
Run full tests and package dry-run. CI uses npm ci --ignore-scripts to avoid host mutation during build; exercise Node supported major versions. Preserve GUI evidence privately. Recheck GUI Loaded/status on the target and fault recovery through its terminal in an isolated home/data directory.

## Acceptance
No uncaught watcher rejection on partial JSON writes; source links preserved during faults; repaired configuration resumes automatically; current error state clears on success; all regression tests pass; production dependency audit and outstanding deployment limitations explicitly reported.
