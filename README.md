# Pi Agent Shared Runtime

Pi agent / Pi Web 插件。缺少時才安裝官方 Claude Code、Codex CLI，讓 Pi Web 的登入 shell 可以執行 `claude` / `codex`，並共享 Pi skills、已設定的全域 MCP 與這台主機的共用記憶。

## 安裝

前置條件：Linux、Node.js 22.19+、npm、相容 Pi SDK、Pi Web。使用同一個持久化 HOME 與 Pi agent data directory。CLI 各自使用官方登入，不複製 Pi provider token。

建議直接從公開 GitHub 安裝：在 Pi Web → Settings → Plugins → Add plugin，輸入以下來源後按 Install：

```text
git:https://github.com/WOOWTECH/pi-agent-shared-runtime
```

頁面顯示 Loaded 後，插件會靜默安裝缺少的 CLI 並同步設定，不建立對話或送出 prompt。於 Pi Web 終端執行 `claude` 或 `codex`。

若使用本機發布包，解開到持久化目錄，於該目錄執行：

```bash
npm install --omit=dev --legacy-peer-deps
pi install /absolute/path/to/package
node bin/cli.mjs install-host
node bin/cli.mjs boot --current --once
```

GitHub source checkout 可直接執行 `bash install.sh` 完成上述安裝與目前服務初始化。

Pi Web 插件管理介面也可以安裝上述本機 package 路徑。安裝本機 checkout 前，先在套件根目錄執行 `npm install --omit=dev --legacy-peer-deps`，確認依賴存在後再用 GUI 安裝；npm 安裝會建立啟動 hook，Pi extension 的 session_start 是現有 Web process 的補充啟動方式。正式發布 npm 後可使用 `pi install npm:@woowtech/pi-agent-shared-runtime`；本版本尚未發布 npm。

服務必須透過 PATH 呼叫 `pi-web`，並將 `$HOME/.local/bin` 放在系統 bin 之前。插件會建立此處的受管 launcher，保留實際原始 launcher。若服務固定呼叫 `/usr/local/bin/pi-web`，改用 `node /absolute/path/bin/cli.mjs launch-web`。插件不修改 root 的服務腳本，也不自行重啟服務。

## 行為

- Pi Web 服務啟動時靜默執行安裝與同步，不建立 session、不送出 prompt。結果寫入 `$PI_CODING_AGENT_DIR/shared-runtime/last-initialize.json`；使用者可在 Pi 內執行 `/shared-runtime` 查看狀態。
- CLI 已存在就保留版本；只有找不到 CLI 才以 npm 安裝官方套件。登入狀態不足時回報，使用者執行 `claude auth login` / `codex login`。
- Pi settings/packages 是技能來源。原始技能目錄透過 symbolic link 共用，文件與附屬資源不複製；新增、更新、移除受管技能會同步。既有使用者檔案與同名連結不接管、不刪除；衝突列入報告。
- 每 15 秒檢查 Pi 設定、全域 MCP 與技能來源；執行 CLI 前也同步目前 project。這不是定時模型對話。
- Claude `~/.claude.json` 與 Codex `~/.codex/config.toml` 加入 `pi_shared_runtime` stdio MCP。其他設定保留，使用者修改同名 MCP 時保留並回報。
- MCP bridge 只載入 Pi Web 全域設定的 MCP（`/data/pi-agent/mcp.json`），並只暴露這些 MCP 工具。Pi 原生 plugins/extensions 不載入、不轉換；MCP adapter 維持自己的 OAuth、憑證及工具規則，bridge 不複製憑證。
- 技能以 Pi settings/packages 為來源；Pi Web 全域 MCP 以 `mcp.json` 為共同來源。Pi 專用 UI、快捷鍵、provider 與對話編排不在共用範圍；遠端 MCP 仍可能有認證、DNS、服務故障。報告區分設定載入與實際呼叫成功。
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

## 同主機共用記憶（0.1.5）

`pi_shared_memory` 是受管的本機 stdio MCP，資料存於 Pi data 的 `shared-runtime/memory`。Pi、Claude Code、Codex，以及 Paseo／Woowtech Smart／Apporo Smart 連到同一主機時，都使用同一來源。不同主機的 data 目錄彼此獨立；此功能不合併 provider 原生對話紀錄或自動記憶資料庫。

共同的 `shared-host-memory` skill 由 Pi package 載入，並同步連結給 Claude／Codex。MCP 提供 `read`、`list`、`write`、`delete`；首次寫入要求 `expectedRevision: null`，更新與刪除要求目前 revision。並行變更回報 `MEMORY_CONFLICT`，不覆蓋其他對話的新內容。單筆內容上限 16 KiB，列舉超過 200 筆時要求縮小 prefix。

同步會保留其他 MCP 和使用者擁有的 skill。若全域 MCP 已有使用者自訂的 `pi_shared_memory`，保留原設定並回報衝突；不要把該狀態視為共用記憶已啟用。

## 明確啟用既有停用設定

安裝或開機不會自動清除使用者的停用選擇。當已確認要啟用目前主機的共享功能時，使用同一組 `PI_SHARED_HOME`／`PI_SHARED_DATA_DIR` 執行：

```sh
pi-shared-runtime enable
pi-shared-runtime sync --global
```

`enable` 先將原始 settings 備份到 `shared-runtime/enable-backups`，再將本套件的舊來源路徑改為目前執行的套件路徑，並移除空的 extensions／skills 選擇。其他 package、MCP、skill 和選項保留。此步不安裝或更新 provider CLI；新對話會載入新 MCP／skill。現有對話需明確重新載入或重建，才能驗證新資源。

開發驗證使用 `npm ci --ignore-scripts --legacy-peer-deps`，由宿主供應 Pi SDK peer；不要讓 npm 自動選擇未鎖定的最新 Pi SDK。

### Skill source authority

Generated Claude/Codex/agents skill links are outputs, never replacement package
sources. Before the Pi SDK deduplicates skill paths by realpath, the runtime
excludes only links that still match its ownership receipt. Package selection,
project precedence and enable/disable filters remain the SDK's responsibility.
User-replaced links remain user-owned. This uses a guarded per-instance SDK
resolution boundary; an incompatible SDK fails explicitly instead of silently
dropping enabled skills or reviving removed packages. Run
`node --test tests/resource-authority.test.mjs tests/resource-boundary.test.mjs`
against each distribution's exact SDK when upgrading it.

### Memory lock upgrade and platform boundary

Shared memory uses Node's built-in `node:sqlite` (`DatabaseSync`, available at the
existing Node >=22.19 minimum) only for OS-backed exclusive lock arbitration.
Memory content stays in the private JSON files; the SQLite lock database stores
no facts or credentials. Contention returns immediately; memory writes retry for
at most five seconds. Process exit or SIGKILL releases the OS lock automatically.
Never remove `*.lock.sqlite` or `.lock.sqlite` files while a runtime may be using
them: replacing the lock inode would bypass another process's lock.

Before migrating from the earlier directory-only lock implementation, drain all
provider turns and stop the old shared bridge/watch processes. The PaaS rollout
uses `Recreate` to stop the old container and its runtimes before the new image
starts, then runs the explicit package enable migration. Existing package
selections and settings backups remain preserved. This release does not claim
mutual exclusion between concurrently running old and new implementations.

Use one local filesystem data volume per host. Linux, Ubuntu, k3s, HA add-on and
Windows WSL2 use the Linux runtime; keep WSL2 data in the distro filesystem.
macOS uses SQLite's native OS locking without `/proc` for new locks. A surviving
legacy directory owner whose PID is live is conservatively treated as busy.
Native Windows and shared network filesystems have not been accepted by these
tests. Linux tests cover concurrent stale recovery, SIGKILL recovery, active-owner
preservation, same-process/cross-process exclusion, and revision CAS conflicts;
they do not replace real macOS, WSL2 or HA deployment acceptance.
