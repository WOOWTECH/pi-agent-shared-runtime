# 商業部署驗收與營運設計

版本：0.1.2。此版本強化故障恢復、依賴安全與可觀測性；部署對象為 Linux 上同一信任範圍內的 Pi / Claude / Codex 工作環境。

## 本輪風險與修正

| 問題 | 實測與处理 |
|---|---|
| GUI/程序寫入設定的暫態無效 JSON，背景同步永久退出 | 原版子程序退出碼 1。新增 startup/runtime 故障注入，改為 degraded 並每周期重試；修復設定後自動 active，成功時清除錯誤狀態 |
| OAuth client 生產依賴存在高風險公告 | npm audit 原有兩項 high 記錄（同一傳遞漏洞）。adapter 固定 5.2.0，SDK 固定 1.31.0；重新 audit 為零。真實 Pi SDK bridge → adapter → stdio server → tool 呼叫通過 |
| 同一安裝流程在不同日期下載不同 CLI | 提供精確版本 pin；只有缺少時使用 pin，既有版本不更新。拒絕 latest 等可變標籤 |
| 舊初始化 ready 不能說明監控程序是否仍活著 | 新增只讀 health，檢查當前同步衝突/extension errors、watch mode 與 owner process identity。非健康時 exit 1 |
| 僅靠開發機已有依賴，冷部署可能漏裝 | 隔離目錄 npm ci --ignore-scripts --legacy-peer-deps 與全套測試；CI 補裝固定測試 SDK peers，不執行宿主 postinstall |
| MCP 回報的程式版本落後 package | bridge 改為讀取實際 package version |

安全公告：[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)。舊 OAuth 憑證缺少 issuer 時，僅升级套件不等於補完既有憑證綁定；商業環境使用可信 MCP，既有 OAuth 憑證須按官方要求重新登入或遷移 issuer。不自動刪除客戶憑證。

## 部署設定

公開 GUI 來源適用評估；正式發布應固定經驗證的 tag 或 commit，避免每次部署追蹤 main。依賴由 npm-shrinkwrap.json 固定，缺少的 CLI 可使用下列 service environment：

```text
PI_SHARED_CLAUDE_VERSION=2.1.296
PI_SHARED_CODEX_VERSION=0.162.1
```

這是目前通過驗證的版本組合，不承諾其未來登入政策/模型配額不變。pins 不強制替換既有 CLI。要升級 CLI，另開明確的升級與回退流程。

前置條件為 Node >=22.19、npm、Pi SDK、Pi Web、可写的持久化 HOME 與 Pi data。每個租戶使用獨立 OS 身分及 volume；同一 HOME 是同一信任邊界，插件不是多租戶安全隔離機制。Pi plugin 有宿主程式執行能力，只安裝可信來源。無互動 bridge 仍保留 Pi validation/permission hooks；不自動 blanket-approve MCP。

## 監控與處理

```bash
node /path/to/plugin/bin/cli.mjs health
```

輸出 healthy/ issues；exit 0 代表本機 runtime 健康，exit 1 需要檢查。讀取一次 health 不載入 plugin、不呼叫模型、不變更設定。authentication 是最近初始化的快取，遠端 MCP/DNS、模型配額、登入到期須另做可控唯讀探測。

| 訊號 | 處理 |
|---|---|
| watch-degraded / configuration-unreadable | 修復原始設定的 JSON/TOML，不覆寫客戶設定；下一週期重試 |
| watch-process-unavailable | 保存錯誤、重啟受管 worker 或 Pi Web；不要以 ready 快取當作監控健康 |
| sync-conflicts | 檢查 ownership；保留使用者項目，採用明確改名/選擇來源 |
| extension-errors | 修正原 Pi plugin，工具載入失敗不能宣稱共享成功 |
| CLI unavailable | 確認 Node/npm/網路/磁碟，重新初始化；保留登入資料 |
| 登入或配額不足 | 官方 login 更新與配額處理；不得借用另一代理 token |

watch-error.json 存目前錯誤，恢復後刪除；監控系統可定期讀取 health 並自行保留事件。來源監控為 15 秒週期，不是模型定時任務。停用時 idle controller 不同步或安裝；重新啟用自動恢復。

## 回退與資料保護

部署前記錄 package commit、CLI versions、設定 ownership，備份 HOME、Pi data 與來源技能到受限存取的 volume snapshot。回退插件到先前驗證 commit/tag，CLI 與登入保持原版本。卸載後 launcher 可委派原始 Web/CLI；不要刪整個 .claude/.codex 或 shared-runtime 備份。禁止把登入檔與內部 GUI 截圖上傳到公開 repo。

未知對話建立結果仍 fail closed，不盲目重複建立。操作員應比對 boot record 與 Web 對話後恢復；此策略避免重複安裝與對話，但需要人工處理極端中斷。

## 驗收範圍

自動化涵蓋原生 SDK 權限 hooks、外部 MCP 呼叫、ownership、故障恢復、精確 pins、dead watcher health、鎖與卸載回退。實機 GUI 證據保持本機；遠端認證及寫入服務不是通用 fixture 能保證的。

尚不宣稱完成跨架構認證、長期負載 SLA、斷網 registry 鏡像部署、租戶隔離滲透測試、全部第三方 MCP OAuth 遷移或每個客戶 plugin 認證。這些是規模化/對外 SLA 的部署門檻；本版本的測試支持相同平台上的受控部署。

本輪 Node 22.23.3 與 Node 24.0.0 均完成 24/24 測試；Node24 清理 hook 原先返回 child.kill 布林值，造成測試挂起，改為不返回值後完整結束。CI 有測試逾時與 job timeout。實際 hosted Actions 執行結果另列，不能用本機測試代替。

效能量測：隔離 2,000 檔案、30 個重疊來源、15 次掃描；canonical directory 去重後 median 537.27→19.23ms（約 28 倍），stat 呼叫 960,075→30,060（減少約97%）。這是來源掃描 fixture 結果，不代表模型延遲或端到端吞吐提升。performance-probe.mjs 可重跑；回歸測試驗證修改偵測與循環目錄。

最終驗證：Node22/24 全套25項通過；GitHub Actions 兩個Node版本完成成功。Pi5 GUI 更新到0.1.2，GUI終端隔離故障恢復、MCP實際呼叫及來源去重5項測試通過；同一2,000檔案fixture在Pi5 median17.50ms、p95 24.77ms。正式health healthy=true、無issues，既有CLI版本保持不變。完整實機截圖及環境識別資料未公開。
