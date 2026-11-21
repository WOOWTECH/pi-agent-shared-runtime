---
name: shared-host-memory
description: Use when asked to remember, recall, update or forget a durable fact across Pi, Claude Code or Codex sessions on this host, including Paseo, Woowtech Smart and Apporo Smart.
---

Use the global MCP server `pi_shared_memory`. Search the configured MCP tools for `pi_shared_memory` when the tool is not already exposed. In the shared runtime bridge, use `pi_global_mcp` to connect `pi_shared_memory` and call its `read`, `list`, `write` or `delete` tool. Pi may expose the same global server through its native MCP tools.

Memory belongs to this host. All three providers and all connected brands use this same source; other hosts have independent memories. This does not merge provider-native chat histories or automatic memory stores.

For a request to remember a durable fact, choose a concise stable key, read it first, and write only the requested fact. Create with `expectedRevision: null`; update with the revision returned by `read`. On `MEMORY_CONFLICT`, read again and reconcile instead of overwriting another session's change. To forget, read the current revision and pass it to `delete`. Retrieve facts with `read`; `list` returns keys without their contents. Do not claim a fact was remembered until the write succeeds.
