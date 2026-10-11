# 實測與能力清單

日期：2026-10-11；環境 Pi Web 0.10.0。此報告不含憑證、帳戶資料或遠端文件內容。

## 驗證結果

- 15 個自動化測試通過，包括 SDK 真實 bridge 的 permission block、參數驗證、result hook、技能移除、循環連結防護及一次性對話。
- 真實 Pi Web PTY：Codex 0.162.1、Claude Code 2.1.296 均能開啟 TUI，無 command not found。
- 兩個 CLI 已登入；安裝器 installed=false，沒有升級或重裝。
- Codex 實際模型回覆 PI_SHARED_CODEX_OK。Claude 模型呼叫受每週用量上限限制，回報 2026-10-14 07:00 UTC 重置。
- MCP bridge 成功唯讀載入 Skill、Odoo19 search_count、Google Drive list(limit=1)。
- 全域 pi_global_mcp 成功連線 Browserless，列出 19 個工具；未執行瀏覽器任務。
- 真實初始化對話 id：01a12b36-44cc-7653-a476-50984ac86c3d；重複 boot 沿用同一 id，未新增對話。
- 本機啟動 launcher 已安裝，來源監控 daemon 已運行；沒有重啟目前 Pi Web，因此完整服務重啟不是本次實測項目。

## 目前共享技能

共 38 個；來源保持 Pi 設定，未為本插件下載示例技能。

- `accessing-woow-k3s`
- `applying-woowtech-brand`
- `authoring-woowtech-tutorial-site`
- `code-review`
- `codebase-design`
- `diagnosing-bugs`
- `dispatching-parallel-agents`
- `edge-tts`
- `executing-plans`
- `grill-me`
- `grill-with-docs`
- `gws-drive`
- `handoff`
- `home-assistant-best-practices`
- `n8n-mcp-tools-expert`
- `n8n-workflow-patterns`
- `odoo-18`
- `odoo-19`
- `subagent-driven-development`
- `tdd`
- `to-spec`
- `to-tickets`
- `verification-before-completion`
- `writing-for-agents`
- `writing-plans`
- `writing-skills`
- `paseo`
- `paseo-advisor`
- `paseo-committee`
- `paseo-handoff`
- `paseo-help`
- `paseo-plugin`
- `woowtech-odoo-18`
- `woowtech-odoo-19`
- `pi-subagents`
- `cloudflare`
- `workflow-authoring`
- `workflow-patterns`

## Pi 插件與工具

| 插件 | SDK 工具 | 狀態 |
|---|---|---|
| herdr-progress | `herdr_progress` | 已載入；遠端成功僅限上述實測 |
| pi-subagents | `subagent`, `subagent_wait` | 已載入；遠端成功僅限上述實測 |
| pi-web-access | `web_search`, `source_check`, `fetch_content`, `get_search_content` | 已載入；遠端成功僅限上述實測 |
| woowtech-odoo-18 | `mcpScript`, `mcp` | 已載入；遠端成功僅限上述實測 |
| woowtech-odoo-19 | `odoo19_search`, `odoo19_read`, `odoo19_get_fields`, `odoo19_list_models`, `odoo19_create`, `odoo19_write`, `odoo19_unlink`, `odoo19_call` | 已載入；遠端成功僅限上述實測 |
| woowtech-github | `woowtech_github` | 已載入；遠端成功僅限上述實測 |
| n8n-mcp-woowtech-pi |  | 未輸出工具，或僅 Pi UI/command |
| google-workspace-pi | `google_drive`, `google_forms`, `google_sheets`, `google_docs`, `google_slides` | 已載入；遠端成功僅限上述實測 |
| woowtech-cloudflare-pi | `cloudflare_api` | 已載入；遠端成功僅限上述實測 |
| pi-dynamic-workflows | `workflow`, `workflow_control` | 已載入；遠端成功僅限上述實測 |
| pi-agent-shared-runtime |  | 未輸出工具，或僅 Pi UI/command |

Bridge 額外提供 `pi_shared_status`、`Skill`、`pi_shared_search`、`pi_global_mcp`、`pi_global_mcpScript`。Pi 內建檔案/shell 工具由 Claude/Codex 自身提供，不重複輸出。

## 全域 MCP

- `cloudflare-api`：配置已共享；本次未完成 OAuth 遠端呼叫驗證
- `browserless`：已測試連線、19 tools

## 已知限制與未完成遠端驗證

- 6 個 Paseo 同名技能在 Claude / agents / Codex 各有既有項目，共 18 個衝突。保留使用者內容，因此初始化為 partial；其他技能已同步。
- n8n extension 沒有輸出工具；先前檢查 endpoint DNS 有問題，不應當作可呼叫。
- Odoo18 MCP 先前 endpoint 回應 404；Odoo19 的直接工具本次唯讀實測成功。
- Cloudflare REST 插件先前缺少 token；全域 Cloudflare OAuth 是否完成須在登入後另測。
- GitHub、web access、subagents、workflow 等已載入；本次未逐一执行其遠端或寫入操作。
- Pi UI、快捷鍵、provider 及對話編排不能等同轉成 Claude/Codex 原生插件。
- 首次對話是 boot worker 確定性處理後由 Pi 模型回報；需要 Pi 模型憑證，Claude/Codex 的登入保持獨立。
- 只自動移除本插件 ownership 記錄中的技能連結；既有使用者自行建立的連結不接管。

## 可重跑驗證

```bash
npm test
node tests/live-probe.mjs
node tests/web-terminal-probe.mjs
```

後兩者是明確的 live integration probe，會使用目前 Pi settings 與認證；PTY probe 只建立並關閉自己的測試終端。
