# 初期開發環境實測與能力清單

> 歷史紀錄：以下開發機實測不等同目前 HA add-on 實機驗收。舊版曾測試插件工具橋接；目前共用範圍收斂為 skills 與 Pi Web 全域 MCP。

此檔保留初期開發機驗證，不代表 Pi 5 目前配置。最新實機 GUI 結果與已修復問題見 [PI5-E2E.md](PI5-E2E.md)。

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

## 共用邊界

Pi 原生 plugins/extensions 與其工具不由 bridge 載入或轉換。它們可能依賴 Pi UI、session、provider 或專屬權限生命週期，跨代理分享不穩定。由 Pi Web 全域 MCP 設定提供的 servers 則可透過 MCP bridge 共用。

Pi Web 全域 MCP API 寫入 `/data/pi-agent/mcp.json`；Pi、Claude Code、Codex 的共用 runtime 讀取同一設定來源。bridge 只輸出 `pi_global_*` 工具，不載入 extensions。Skills 由 Pi settings/packages 發現，Claude/Codex 以受管連結讀取同一份 skill 內容。

## 全域 MCP（開發機歷史實測）

- `cloudflare-api`：配置已共享；本次未完成 OAuth 遠端呼叫驗證
- `browserless`：已測試連線、19 tools

## 已知限制與未完成遠端驗證

- 6 個 Paseo 同名技能在 Claude / agents / Codex 各有既有項目，共 18 個衝突。保留使用者內容，因此初始化為 partial；其他技能已同步。
- n8n 的 Pi extension 狀態不代表全域 MCP 可呼叫；需在 Pi Web 全域 MCP 中配置並單獨驗證。
- Odoo18 MCP 先前 endpoint 回應 404；Odoo19 的直接工具本次唯讀實測成功。
- Cloudflare REST 插件先前缺少 token；全域 Cloudflare OAuth 是否完成須在登入後另測。
- 舊版曾將 GitHub、web access、subagents、workflow 等 Pi extension 工具載入 bridge；目前已排除，這些舊測試不代表仍會共享。
- Pi UI、快捷鍵、provider 及對話編排不在 Claude/Codex 共用範圍。
- 首次對話是 boot worker 確定性處理後由 Pi 模型回報；需要 Pi 模型憑證，Claude/Codex 的登入保持獨立。
- 只自動移除本插件 ownership 記錄中的技能連結；既有使用者自行建立的連結不接管。

## 可重跑驗證

```bash
npm test
node tests/live-probe.mjs
node tests/web-terminal-probe.mjs
```

後兩者是明確的 live integration probe，會使用目前 Pi settings 與認證；PTY probe 只建立並關閉自己的測試終端。
