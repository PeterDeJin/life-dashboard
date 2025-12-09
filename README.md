# life-dashboard

# 🚀 My Life Dashboard (個人生活儀表板)

這是一個基於 Web (HTML/JS) 與 Google Sheets (GAS) 的個人財務與生活追蹤系統。
整合了記帳、資產管理、習慣打卡與目標倒數功能。

## ✨ 主要功能

* **📊 資產戰情室**：即時計算總資產、投資成本、未實現損益與 ROI (含股票與黃金)。
* **💸 生活財務室**：計算每月可用生活資金，並與本月支出做對比。
* **📉 趨勢分析**：雙軸圖表顯示「每月支出」vs「資產成長趨勢」。
* **🛍️ 夢想購物車**：許願想買的清單，系統自動判斷餘額是否足夠購買。
* **⏳ 時間倒數**：年度進度條、畢業倒數、生日倒數。
* **📝 習慣打卡**：每日追蹤英文、運動、閱讀等習慣，計算複利成長曲線。
* **📱 手機友善 (PWA)**：支援加入手機主畫面，全螢幕操作體驗。

## ⚙️ 如何安裝與設定 (Setup)

因為涉及個人資安，本專案將敏感資訊分離。如果你想使用此專案，請依照以下步驟：

1.  **下載程式碼**：Clone 或 Download 此專案。
2.  **設定 Config**：
    * 找到 `config.example.js` 檔案。
    * 將其重新命名為 `config.js`。
    * 打開檔案，填入你的 Google Apps Script (GAS) 部署網址與自訂密碼。
    ```javascript
    const CONFIG = {
        API_URL: "[https://script.google.com/macros/s/你的真實ID/exec](https://script.google.com/macros/s/你的真實ID/exec)",
        PASSWORD: "你設定的密碼"
    };
    ```
3.  **開啟網頁**：直接用瀏覽器打開 `index.html` 即可使用。

## 📂 Google Sheet 格式需求

後端對應的 Google Sheet 需包含以下分頁 (Tabs)：
* `Asset_Log` (資產流水帳)
* `Expenses_DB` (日常支出)
* `Portfolio` (資產現況與股價公式)
* `Habit_Log` (習慣紀錄)
* `History_Log` (資產快照存檔)
* `Events_DB` (倒數事件)
* `Wishlist_DB` (購物清單)
* `Media_Log` (閱讀觀影紀錄)

---
*Created by [你的名字] - 2025*
