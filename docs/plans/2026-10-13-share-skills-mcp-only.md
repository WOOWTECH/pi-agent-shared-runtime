# Share Pi Skills and MCP Only Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Claude/Codex bridge expose only Pi skills and configured global MCP servers, excluding Pi plugin and extension tools.

**Architecture:** Continue using Pi's package/resource loader to discover skills and use the shared `mcp.json` adapter for MCP. In bridge mode, disable ordinary Pi extensions and explicitly load only the shared MCP adapter; filter bridge discovery to that adapter's MCP tools. Keep GUI Pi settings as the source of truth and the existing watcher for add/update/remove.

**Tech Stack:** Node.js ESM, Pi Coding Agent SDK, MCP SDK, node:test.

---

### Task 1: Reproduce unwanted plugin tool exposure

**Files:**
- Modify: `tests/bridge.test.mjs`

**Step 1:** Add a fixture Pi extension whose activation writes a marker and registers a tool.

**Step 2:** Run `node --test tests/bridge.test.mjs` and confirm the current bridge loads/exposes the fixture tool.

### Task 2: Isolate the bridge to skills and global MCP

**Files:**
- Modify: `src/pi.mjs`
- Modify: `bin/bridge.mjs`
- Modify: `src/sync.mjs`
- Modify: `src/watch.mjs`

**Step 1:** Let `loadResources` discover authoritative skills using the normal Pi settings; disable extension loading only in bridge mode so Pi Web itself still loads the package normally.

**Step 2:** Load only the existing global MCP adapter in bridge mode and expose only `pi_global_*` tools.

**Step 3:** Remove extension/plugin inventories from shared status and watch inputs; keep Pi skills and `mcp.json` change detection.

### Task 3: Document the supported sharing surface

**Files:**
- Modify: `README.md`
- Modify: `VERIFICATION.md`
- Modify: `package.json`

Describe shared skills and global MCP; state that native plugins/extensions are outside the bridge surface.

### Task 4: Verify end-to-end behavior

Run:
- `node --test tests/bridge.test.mjs`
- `node --test tests/mcp-adapter.test.mjs tests/sync.test.mjs tests/watch.test.mjs`
- `npm test`

Expected: Pi plugin tool activation marker remains absent, configured global MCP remains callable, skills add/update/remove continue to sync, and all tests pass.
