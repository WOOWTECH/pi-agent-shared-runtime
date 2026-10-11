# Pi 5 GUI 端到端實測

日期：2026-10-11 UTC。程式版本 0.1.1；實測包含 commit cd5005a 的重啟鎖修正。
目標為獨立 Pi 5 實測環境，Pi Web 0.10.0、Pi SDK 1.0.0、介面 0.12.0。使用瀏覽器登入、插件/MCP 頁面、內建終端及一般對話。kubectl 僅查詢目標、轉送連線及觀察 readiness；安裝、移除、切換、CLI 呼叫與重啟從 GUI 操作。

## 流程結果

| 流程 | 實際結果 |
|---|---|
| 公開來源安裝 | Plugins → Add plugin → 公開 git URL → Install，顯示 Loaded 0.1.1 |
| 缺少才安裝 | 備份並移除原 CLI，確認不存在；自動安裝兩個官方套件，installed=true |
| 已存在 CLI | 多次重裝、更新及重啟後 installed=false，版本與登入保留 |
| 初次啟動 | 不先聊天即可建立初始化對話並由 Pi 模型回報結果 |
| 重複操作 | 重新啟用、新一般對話、CLI 啟動不增加同一次服務的初始化記錄 |
| Codex TUI | 真實 GUI 終端啟動 0.162.1；卸載與重啟後再次成功 |
| Claude TUI | 真實 GUI 終端啟動 2.1.296；卸載與重啟後再次成功 |
| Pi 模型共用 | 實際呼叫 fixture plugin、Skill、MCP，回覆 PI5_PLUGIN_OK:PI、PI5_SKILL_V1、PI5_COMPANION_V1、PI5_MCP_OK:PI |
| Claude 模型共用 | 實際模型呼叫共用插件/技能，PI5_PLUGIN_OK:CLAUDE、PI5_SKILL_V1；另一 MCP 呼叫 PI5_MCP_OK:CLAUDE_MCP |
| Codex 模型共用 | 實際模型完成插件/技能呼叫，PI5_PLUGIN_OK:CODEX_VERIFIED、PI5_SKILL_V2；另一 MCP 呼叫 PI5_MCP_OK:CODEX_MCP |
| 技能更新 | 原始 SKILL.md 及 companion 資源 V1→V2，三個目的路徑使用相同 canonical source |
| 技能移除 | 移除測試來源後，三處受管連結消失；非受管項目保留 |
| 同名衝突 | 保留既有 USER_OWNED_VALUE，不覆寫，衝突明確列出 |
| GUI 新增 MCP | 成功連線測試 stdio server，顯示 1 tool；三代理實際呼叫成功 |
| 故障 MCP | 故意不存在的模組，GUI 顯示 MODULE_NOT_FOUND/connection closed；移除後有效服務仍正常 |
| GUI 停用 | watcher=paused，新增來源跨過 15 秒仍未同步 |
| GUI 重新啟用 | 只按 Enable，不聊天、不叫 CLI、不 reload；watcher=active，自行同步，初始化記錄不增加 |
| GUI 更新 | Check updates → Update，只更新本插件；保留 CLI 版本及登入 |
| 插件移除 | Package 實際不存在，兩個 CLI fallback 仍正常 |
| 卸載後重啟 | 內建終端驗證 Web PID 後 SIGTERM，平台自動重啟；Pi Web 登入與兩個 CLI 正常 |
| 安裝後重啟 | 內建終端重啟，readiness 恢復，僅新增一個 boot record，初始化對話完成，兩個 TUI 正常 |
| 最後清理 | GUI 移除測試 MCP；終端歸檔具名測試技能/插件。其他插件、登入、備份保留 |

## 最終狀態

最後 installed-plugin restart：initialized=true、prompt=accepted。已保存四個不同啟動的 boot records；該次重啟由三增四，之後一般對話與 TUI 操作維持四，沒有重複初始化。

`last-initialize.json`：ready。Claude Code 2.1.296、Codex 0.162.1 均 available、logged-in、installed=false。watcher active，sync conflicts=[]，測試技能與測試 MCP 已移出有效配置。Pi 5 的有效技能來源清理後為零，不把开发機的技能數量套用到此機。

## 找到並修復的問題

- 私有 GitHub clone 不具認證而失敗；改為公開 repo，匿名來源與 GUI 安裝重測成功。
- npm postinstall 先於 Pi 設定落盤，導致初始化未觸發；改為等待 activation，並增加 factory/session 補充入口。
- GUI 的 Enable 只改 settings，未必觸發 extension factory；新增可暫停的 controller，settings-only enable 實測成功。
- 插件刪除後舊 launcher 指向不存在模組；CLI 與 Web launcher 在 package 缺少時委派原始執行檔，真實卸載/重啟成功。
- wrapper 更新未涵蓋 already-initialized 路徑；每次重新啟用刷新受管 launcher。
- SDK 外部工具執行缺少 caller metadata；補上明確 external-MCP caller，保留驗證、阻擋與 result hooks。
- 生成連結重被當成來源與 TOML key reorder 的 ownership 誤判；canonical source/filter/digest 已修正。
- 持久化 lock 在容器重啟後殘留；死亡 PID 可回收，另補 startTime/namespace 防護避免 PID 重用。PID 重用以回歸測試驗證，沒有聲稱實機發生過。

## 權限與能力邊界

Codex 非互動 `exec` 的 `approval_policy=never` 不會批准新 MCP 工具；最初遭拒符合權限規則。唯讀 fixture 實測使用單次 `mcp_servers.pi_shared_runtime.tools.<name>.approval_mode="approve"` 覆寫，沒有持久化 blanket approval。TUI 啟動驗證與模型工具呼叫驗證分開：模型呼叫由 GUI 終端中的官方非互動指令完成。

共享 Pi 技能、MCP、SDK 可執行插件工具；不把 Pi UI、快捷鍵、provider、生命週期及對話編排轉成 Claude/Codex 原生插件。現存第三方插件工具目前已載入，不代表本報告逐一驗證它們所有遠端或寫入行為。測試使用可控唯讀 fixture 覆蓋三代理完整共享路徑。

Claude TUI 提示登入約一天後到期及使用 usage credits；實測期間模型呼叫成功，登入到期後仍須使用官方登入更新。

## 自動化與證據

`npm test`：19 passed，0 failed，包括真實 Pi SDK hooks、settings-only enable、缺少才安裝、並發與重啟鎖、卸載 launcher、技能 ownership、TOML 合併及一次性對話。

GUI 截圖、實機狀態、完整 runner、時間戳文字與测试矩陣保留於操作環境，未發布到公開 repo。公開報告不包含登入憑證、內部主機名稱、Pod 名稱或對話識別碼。
