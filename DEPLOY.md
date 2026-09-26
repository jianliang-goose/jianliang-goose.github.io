# 建良鵝肉 官方網站 維護說明

## 架構

| 部分 | 放在哪裡 | 說明 |
|---|---|---|
| 網站 | GitHub `jianliang-goose/jianliang-goose.github.io` → Cloudflare（Workers 靜態網站） | 推送到 `main` 後約 1 分鐘自動上線 |
| 網址 | https://jianliang-goose.jianliang-goose.workers.dev/ | 之後可綁自訂網域 |
| 商品、設定、訂單 | Google 試算表（「建良鵝肉團購網訂單」） | 工作表：Products、Settings、Orders、AdminLog |
| 後端 | 試算表的 Apps Script（原始碼備份在 Google 雲端硬碟 `★接案資料/建良鵝肉/網站後端/Code.gs`，不放在這個 repo） | 下單、查訂單、後台讀寫 |
| 後台 | `/admin.html`（網站上沒有連結，請把網址加入書籤） | 密碼 = Apps Script「指令碼屬性」`ADMIN_KEY` |

舊的 GitHub Pages 網址（https://jianliang-goose.github.io/）在綁好正式網域前仍會同步更新。

## 更新網站

- `main` = 正式網站；推到其他分支（例如 `preview`）會產生 Cloudflare 預覽網址，不影響正式網站。
- 建置指令 `bash _tools/build.sh` 只把網站檔案複製到 `dist/`，`_tools/`、本文件、設定檔都不會公開。
- 改了 `css/`、`js/` 的檔案，記得把各頁引用的 `?v=` 版本號加一，避免訪客看到快取的舊檔。

## 後台（admin.html）

店家自己可以做的事：

- **訂單**：勾「已收到款項」、改狀態（待處理 → 已出貨 / 完成待取 → 已完成）、寫店家備註、複製寄件資料。取消訂單會自動把庫存加回去。
- **商品**：新增、修改（價格、優惠價、照片、說明、庫存、標籤）、下架／重新上架、調整順序、刪除。照片存在「建良鵝肉官網圖片」雲端硬碟資料夾（在部署後端的那個 Google 帳號裡）。
- **客戶**：從訂單整理的名單，可搜尋、匯出 Excel（CSV）。
- **消息**：新增、編輯、刪除「最新消息」。
- **設定**：開放／暫停接單、網站公告、運費、ATM 帳號、街口與 LINE Pay 收款碼。

商品、公告、消息等修改約 5 分鐘內出現在網站上（Google 試算表「發布到網路」的快取）；訂單狀態是即時的。
每次儲存商品前，舊資料會記在試算表的 AdminLog 工作表，改錯可以從那裡還原。

## 後端（Apps Script）

後台需要 API 版本 2（`Code.gs` 開頭的 `API_VERSION = 2`）。目前線上是 25 版（2026-09-26 部署）。出問題時可以在「管理部署作業」把版本換回 24 版（舊版：後台不能用，網站下單照常）。

以後更新程式的方式：

1. 打開訂單試算表 → 擴充功能 → Apps Script，把 `Code.gs` 全部換成新版，存檔。
2. 新程式如果用到新的 Google 服務，部署前先在編輯器上方選一個函式 → 執行 → 允許授權。雲端硬碟已在 2026-09-26 授權，只改程式內容不用再做。
3. 部署 → 管理部署作業 → 鉛筆「編輯」→ 版本選「建立新版本」→ 部署。**不要**按「新增部署作業」，那會產生新網址。

後端以部署者的 Google 帳號執行，後台上傳的照片也存在那個帳號的雲端硬碟。

後台密碼：專案設定 → 指令碼屬性 → `ADMIN_KEY`。

公開的動作只有下單（createOrder）、查訂單（searchOrder，需要手機＋訂單編號）與讀取商品設定（`?type=config`）；其他都要密碼。

### Settings 工作表的設定

| Key | 用途 | 沒設定時 |
|---|---|---|
| `is_open` | `false` = 暫停接單，結帳頁改顯示 `closed_message` | 開放 |
| `closed_message` | 暫停接單時的說明 | 預設文字 |
| `announcement` | 首頁、商品頁、結帳頁最上方的公告 | 不顯示 |
| `shipping_fee`、`shipping_threshold` | 冷凍運費、滿額免運門檻 | 120、3000 |
| `bank_name`、`bank_code`、`bank_account`、`bank_holder` | ATM 轉帳資訊 | 凱基銀行帳號 |
| `jko_qr` | 街口收款碼圖片網址；清空＝結帳頁不顯示街口 | `images/pay-jkopay.jpg` |
| `linepay_qr` | LINE Pay 收款碼圖片網址；空白＝不顯示 LINE Pay | 空白 |
| `news_json` | 最新消息（後台管理，JSON） | 顯示 news.html 原本的內容 |

Products 工作表的 `Hidden` 欄填 `Y` 代表下架。

## 超商門市清單（結帳頁「選擇收件門市」）

- 資料在 `data/cvs-711.json`、`data/cvs-family.json`，由 `_tools/update_cvs_stores.py` 從 7-11、全家官網的門市查詢抓取。
- 7-11 只收錄有「冷凍交貨便」的門市；全家收錄全部門市；兩家都不含離島。
- GitHub Actions（`.github/workflows/update-cvs-stores.yml`）每週一清晨自動更新，推送後 Cloudflare 會自動重新部署。想立刻更新：repo 的 **Actions → 更新超商門市資料 → Run workflow**。
- 如果抓到的門市數量異常減少（例如對方網站改版），程式會停止、保留舊資料，GitHub 會寄信通知這次執行失敗。
- 在自己電腦手動更新：`python _tools/update_cvs_stores.py`，再把 `data/` 推上去。

## 本機測試

在瀏覽器 console 設定 `localStorage.jl_dev_api = '模擬後端網址'`，這台瀏覽器的整個網站（商品、下單、查詢、後台）都會改連模擬後端，不會碰到正式訂單。測完用 `localStorage.removeItem('jl_dev_api')` 恢復。

## 自訂網域（選用）

在 Cloudflare 的 jianliang-goose 專案 → Settings → Domains & Routes 加入自訂網域。網域要先加到 Cloudflare（.com.tw 等台灣網域需向台灣的網域商購買，再把 DNS 指到 Cloudflare）。綁好後可以關閉 GitHub Pages，並把 repo 改成私人。

## 與團購頁的關係

舊的限時團購頁（`group_order` repo）已停用並改為私人。官網沿用同一個 Apps Script 後端與同一份試算表，舊團購訂單也在同一張訂單表裡。
