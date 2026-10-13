# Pi Agent Shared Runtime

Pi agent / Pi Web 插件。缺少時才安裝官方 Claude Code、Codex CLI，讓 Pi Web 的登入 shell 可以執行 `claude` / `codex`，並共享目前啟用的 Pi skills、MCP 與插件工具。

## 安裝

前置條件：Linux、Node.js 22.19+、npm、相容 Pi SDK、Pi Web。使用同一個持久化 HOME 與 Pi agent data directory。CLI 各自使用官方登入，不複製 Pi provider token。

建議直接從公開 GitHub 安裝：在 Pi Web → Settings → Plugins → Add plugin，輸入以下來源後按 Install：

```text
git:https://github.com/WOOWTECH/pi-agent-shared-runtime
```

頁面顯示 Loaded 後，不必先聊天或手動執行初始化；插件會建立「Claude / Codex 環境初始化」對話。於 Pi Web 終端執行 `claude` 或 `codex`。

若使用本機發布包，解開到持久化目錄，於該目錄執行：

```bash
npm install --omit=dev --legacy-peer-deps
pi install /absolute/path/to/package
node bin/cli.mjs install-host
node bin/cli.mjs boot --current --once
```

GitHub source checkout 可直接執行 `bash install.sh` 完成上述安裝與目前服務初始化。

Pi Web 插件管理介面也可以安裝上述本機 package 路徑。npm 安裝後會建立啟動 hook；Pi extension 的 session_start 是現有 Web process 的補充啟動方式。正式發布 npm 後可使用 `pi install npm:@woowtech/pi-agent-shared-runtime`；本版本尚未發布 npm。

服務必須透過 PATH 呼叫 `pi-web`，並將 `$HOME/.local/bin` 放在系統 bin 之前。插件會建立此處的受管 launcher，保留實際原始 launcher。若服務固定呼叫 `/usr/local/bin/pi-web`，改用 `node /absolute/path/bin/cli.mjs launch-web`。插件不修改 root 的服務腳本，也不自行重啟服務。

## 行為

- Pi Web 服務啟動時靜默執行安裝與同步，不建立 session、不送出 prompt。結果寫入 `$PI_CODING_AGENT_DIR/shared-runtime/last-initialize.json`；使用者可在 Pi 內執行 `/shared-runtime` 查看狀態。
- CLI 已存在就保留版本；只有找不到 CLI 才以 npm 安裝官方套件。登入狀態不足時回報，使用者執行 `claude auth login` / `codex login`。
- Pi settings/packages 是權威來源。原始技能目錄透過 symbolic link 共用，文件與附屬資源不複製；新增、更新、移除受管技能會同步。既有使用者檔案與同名連結不接管、不刪除；衝突列入報告。
- 每 15 秒檢查來源 metadata；設定、技能、已載入插件來源變更會同步。執行 CLI 前也同步目前 project。這不是定時模型對話。
- Claude `~/.claude.json` 與 Codex `~/.codex/config.toml` 加入 `pi_shared_runtime` stdio MCP。其他設定保留，使用者修改同名 MCP 時保留並回報。
- MCP bridge 使用原生 Pi SDK 載入 extensions、執行工具及 permission hooks；原始 MCP adapter 維持自己的 OAuth、憑證及工具規則，bridge 不複製憑證。
- 可共享的是工具及 skills。Pi 專用畫面、快捷鍵、provider、對話編排與需要互動 UI 的工具，無法轉換成 Claude/Codex 原生插件；遠端 MCP 仍可能有認證、DNS、服務故障。報告區分載入與呼叫成功。
- 停用／移除本 package 後自動安裝與同步暫停；idle controller 保留以偵測 GUI 重新啟用，Web 服務結束才退出，受管 launcher 仍可委派真正 Pi Web；保留 CLI、登入及既有共享項目。要清理可檢視 state 中的 owned links，勿刪除使用者自行建立的項目。

## 操作與診斷

Pi 指令 `/shared-runtime`；shell 指令（在插件目錄）：

```bash
node bin/cli.mjs initialize
node bin/cli.mjs sync --global
node bin/cli.mjs status
npm test
```

全域狀態位於 `$PI_CODING_AGENT_DIR/shared-runtime/`，未設定時為 `~/.pi/agent/shared-runtime/`：`last-initialize.json`、`last-sync.json`、`last-boot.json`、每個 project 的 ownership 與每次 boot 的識別碼。可用 `PI_SHARED_HOME`、`PI_SHARED_DATA_DIR`、`PI_SHARED_SDK_ROOT` 覆寫測試位置；Web port 使用 `PORT` / `PI_WEB_PORT`。

自動初始化不需要 Pi 模型或模型帳號；CLI 的 TUI 開啟不代表 CLI 已登入或所有遠端工具可用。使用 `/shared-runtime` 或 bridge 的 `pi_shared_status` / `pi_shared_search` 取得目前工具與能力列表。

技能名稱均由目前來源決定；grill-me、brainstorming 只是同步示例，本插件不下載任何示例技能。

官方文件：[Codex CLI](https://developers.openai.com/codex/cli)、[Codex MCP](https://developers.openai.com/codex/mcp)、[Claude Code](https://code.claude.com/docs/en/setup)、[Claude MCP](https://code.claude.com/docs/en/mcp)。

Pi 5 完整 GUI 流程與修復紀錄：[PI5-E2E.md](PI5-E2E.md)。

商業部署的版本固定、health、回退與驗收邊界：[COMMERCIAL-READINESS.md](docs/COMMERCIAL-READINESS.md)。
