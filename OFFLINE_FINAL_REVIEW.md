# 最後檢查與手機測試步驟

日期：2026-11-04。兩條規則及公司 Profile API 已完成程式修正與自動化驗證；尚未部署正式 API 或安裝新版 APK。

## 已確認的規則

- User 可自行選一張或多張可用 CN。選一張 RM20 抵扣 RM100，餘額 RM80；選兩張各 RM20，餘額 RM60。只使用勾選的 CN。未傳入新多選欄位的舊客戶端保留原有 API 相容行為。
- 取消未付款 On Credit 單只取消欠款並還原庫存，不將單據總額加到 Credit。既有已付款退款規則不在這次未付款修正範圍內。
- App / Display Name、Company Name、Address Line 1 和 Address Line 2 都透過 API 儲存。本機資料是快取；離線修改明確顯示待同步。
- 其他在線裝置會在載入設定、回到前景或最遲約 30 秒的前景刷新時讀取最新公司資料；離線裝置重連後更新。
- 若另一部裝置先修改 Profile，舊版本 Save 會衝突提示；先 Reload API Profile，再重新編輯，避免無意覆蓋。
- 若 Live API 尚未有 Profile 端點，Save 不會假裝已儲存到 API。只有 PUT 確認成功後才顯示 Saved to API。

## 驗證結果

- 前端：46 個回歸測試通過，包含離線 CRUD、實際畫面送出多選欄位、API 儲存、重開後待同步、舊 API 拒絕及跨裝置版本衝突。
- SQL：26 項實際 LocalDB controller/filter 整合案例通過，包含 CN 單選／多選、未付款取消與庫存還原、Profile 持久化、另一連線讀取、併發修改與重試去重。
- Angular development build 和 .NET Release 編譯通過；.NET nullable 警告仍存在。
- SQL 測試使用專用實例，每次建立隨機命名的測試庫並在結束時清除，不讀取正式連線設定。
- 尚未涵蓋真手機 WebView、實體印表機及正式主機環境的完整端到端測試。

## 手機測試前準備

1. 使用**測試 API 和測試資料庫**；先確認新版 API 及 `OfflineOperations` 資料表已備妥。
2. `ApiService` 目前仍使用既有 API 位址。手機測試版必須先把 `baseUrl` 改成測試 API，
   再建置測試 APK；不要直接用正式網域做金額及刪單實驗。
3. 安裝包含本次修改的測試 APK。現在手機上原有的 APK 不會自動包含本機程式碼修改。
4. 準備測試客戶 `OFFLINE-TEST`、一個不套折扣／稅項的商品，以及一位有退款 CN 的客戶。
5. 在線上開過商品、客戶、Invoice、付款及 CN 列表；把要測的舊 Invoice 明細開一次，
   確認所需歷史資料已下載。記錄庫存、客戶 Credit 和 Invoice 餘額。
6. 開啟飛航模式，確認 Wi-Fi／行動數據關閉。測試列印時可單獨開回藍牙，仍保持網路關閉。
7. 下列獨立案例用不同測試單，避免上一步已扣款／已退款的資料干擾下一步。

## 兩裝置 Company Profile 測試

1. 兩部測試手機連到同一個新版測試 API。A 開啟 Setting，修改名稱及地址後 Save，必須顯示 Saved to API。
2. B 開啟 Setting，或保持前景等待約 30 秒，確認名稱和兩行地址一致。確認主畫面及單據預覽也更新。
3. B 斷網修改，必須顯示 Pending API sync；此時 A 不應被誤認已收到資料。B 重連後，確認 API 成功，A 刷新後一致。
4. A、B 同時開啟編輯畫面，A 先 Save；B 再 Save 應提示版本衝突，Reload 後可讀到 A 的版本。

## 手機測試清單

| 案例 | 操作 | 通過條件 |
| --- | --- | --- |
| Category | 斷網新增一個未使用分類，改名，離開再回來，最後刪除 | 新增及修改可見；刪除後不再出現；重新連線不復活 |
| 客戶／商品 | 斷網新增測試客戶及商品、改資料及價格、設定 Special Price | 重開 App 後資料仍在；價格及客戶對應正確 |
| Invoice 修改 | 新增一張 RM100 的 On Credit 單，不用 CN、不付款；改成 RM120 | 列表、明細和預覽都是 RM120；重開後不變；重連後伺服器也是 RM120，只有一張單 |
| 未送出 Invoice 取消 | 保持斷網，新增一張測試單，再刪除 | 重開及重連後都沒有這張單；客戶 Credit 沒有不明變化 |
| 付款 | 對 RM100 欠款收 RM40 | 本機餘額 RM60；重開、重連後仍 RM60，只有一筆 RM40 付款 |
| 未送出付款取消 | 在另一個案例斷網收 RM40，重連前刪除該付款 | 餘額由 RM60 回 RM100；重連後沒有這筆付款 |
| 退貨 CN | RM100 單新增 RM20 的退貨 CN，再改為 RM30，最後刪除 CN | 餘額依序為 RM80、RM70、RM100；列表、明細、重連結果相同 |
| 找零 Credit | 對 RM100 欠款實收 RM120 | 付款及 Invoice 已付金額正確，產生一次 RM20 的找零 CN；反覆重連不重複產生 |
| 單張退款 CN | 只有一張可用 RM20 退款 CN，抵扣另一張 RM100 欠款 | Invoice 餘額 RM80；可用 Credit 減少 RM20；重連不再扣一次 |
| 多張退款 CN | 各 RM20 的兩張 CN，RM100 On Credit 單只選第一張 | 只選一張扣 RM20、餘額 RM80；選兩張扣 RM40、餘額 RM60；重開、重連結果相同 |
| 未確認送出後取消 | 測試環境在送出 RM10 未付款 On Credit 單後中斷回覆，再取消及重連 | 客戶 Credit 不增加；單據刪除，庫存還原；反覆重連不重複變動 |
| 斷線／重連 | 完成一組離線操作，恢復網路，再反覆開關網路三次 | 同步數量最終歸零；沒有重複 Invoice、付款或 CN，庫存沒有重複扣減 |
| 舊單 View／列印 | 斷網開已下載的舊單、看明細及預覽，再用藍牙列印 | 商品、數量、單價、公司名稱、地址和金額完整且一致 |
| 原有線上功能 | 網路正常時另做一次開單、修改、收款、CN 及列印 | 線上操作和以往一致；與相同資料的離線重連結果對得上 |

通過每個案例時，除了看成功提示，也要確認**金額、筆數、單號、客戶、庫存及重開後資料**。
同步有錯誤、金額改變或資料重複時，保留測試單號與錯誤訊息，不要把「佇列消失」單獨當成通過。

## 開發者重跑方式

前端：

```powershell
cd C:\Users\Wayne\Desktop\MobilePOS\IonicMobilePos
npm run test:offline
npx ng build --configuration development
```

全部 CN 選擇、公司 Profile 與離線回歸案例應通過。

SQL 整合與重現探測：

```powershell
SqlLocalDB start CodexMobilePosOfflineReview
cd C:\Users\Wayne\Desktop\MobilePOS\TDMobilePOSAPI1\TDMobilePOSAPI1\tests\OfflineIntegration
dotnet run --project OfflineIntegration.csproj --configuration Release -- --regression-probes
```

加上 --regression-probes 會驗證新增的 CN、未付款取消及 Profile 案例；全部通過應以 0 結束，測試庫會在 finally 清除。
不加 `--regression-probes` 可單獨重跑已通過的 15 項 SQL controller/filter 整合案例。

## Invoice receipt payment summary

Receipt preview, HTML printing, Bluetooth ESC/POS and PDF exports now show amount paid, balance due and an amount-derived payment status. RM100 with RM50 paid prints PARTIALLY PAID and BALANCE DUE RM50.00; fully paid prints PAID IN FULL and RM0.00. Returns and applied credit are deducted separately; change credit is not treated as a return. Printing refreshes invoice detail using the existing online/offline API service. No payment records are changed by printing.

Validation: 60 frontend tests passed (including 14 receipt cases), 27 isolated SQL integration cases passed, Angular development build and .NET Release build passed. Physical Bluetooth printing still requires a device test. Manual check: create RM100 On Credit, pay RM50, preview/print/export and verify RM50 due; pay remaining RM50 and verify RM0 due and PAID IN FULL. Repeat offline with cached invoice and with credit applied. No Git push or live deployment performed.
