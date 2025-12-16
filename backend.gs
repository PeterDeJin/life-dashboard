// ---------------------------------------------------------
// 1. 處理讀取資料 (給網頁抓資料用)
// ---------------------------------------------------------
function doGet(e) {
  // 取得網址參數 ?tab=分頁名稱
  var tabName = e.parameter.tab;
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet;

  // 如果有指定 tab 就抓該分頁，否則預設抓第一個
  if (tabName) {
    sheet = ss.getSheetByName(tabName);
  } else {
    sheet = ss.getSheets()[0];
  }

  // 如果找不到分頁，回傳錯誤
  if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({error: "找不到分頁: " + tabName}))
        .setMimeType(ContentService.MimeType.JSON);
  }

  // 讀取資料
  var data = sheet.getDataRange().getValues();
  
  if (data.length === 0) {
      return ContentService.createTextOutput(JSON.stringify([]));
  }

  // 整理成 JSON
  var headers = data[0]; // 第一列當標題
  var rows = data.slice(1);
  
  var result = rows.map(function(row) {
    var obj = {};
    row.forEach(function(cell, index) {
      // 簡單的日期格式化
      if (Object.prototype.toString.call(cell) === '[object Date]') {
         obj[headers[index]] = Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy/MM/dd");
      } else {
         obj[headers[index]] = cell;
      }
    });
    return obj;
  });
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------
// 2. 處理寫入資料 (由前端 fetch POST 觸發)
// ---------------------------------------------------------
function doPost(e) {
  try {
    // 1. 解析資料
    var postData = JSON.parse(e.postData.contents);
    var tabName = postData.tab;
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tabName);
    
    if (postData.action === "delete") {
      var targetDate = postData.date.toString().replace(/-/g, "/").trim();
      var targetItem = postData.item.toString().trim();
      var targetAmount = parseFloat(postData.amount.toString().replace(/,/g, ""));
      
      var data = sheet.getDataRange().getValues();
      var lastRow = data.length;
      
      // 搜尋最近 30 筆
      var limit = Math.max(1, lastRow - 30); 
      var debugLog = "";

      for (var i = lastRow - 1; i >= limit; i--) {
        var row = data[i];
        
        // 1. 日期 (第1欄 = Index 0)
        var rowDate = "";
        if (row[0] instanceof Date) {
          rowDate = Utilities.formatDate(row[0], "GMT+8", "yyyy/MM/dd");
        } else {
          rowDate = row[0].toString().replace(/-/g, "/").trim();
        }
        
        // 🟢 修正點：自動判斷欄位位置 (新增這段)
        // 預設是記帳表 (Index 2=項目, Index 3=金額)
        var itemIndex = 2;
        var amountIndex = 3;
        
        // 如果是夢想購物車，調整位置 (Index 1=項目, Index 2=金額)
        if (tabName === "Wishlist_DB") {
           itemIndex = 1;
           amountIndex = 2;
        }

        // 讀取正確的欄位
        var rowItem = row[itemIndex].toString().trim();
        var rowAmount = parseFloat(row[amountIndex].toString().replace(/,/g, ""));
        
        // 記錄一下它看到了什麼 (除錯用)
        if (i >= lastRow - 3) {
           debugLog += `[Row ${i+1}] ${rowDate} | ${rowItem} | ${rowAmount}\n`;
        }

        // 比對
        if (rowDate === targetDate && Math.abs(rowAmount - targetAmount) < 1 && (rowItem === targetItem || rowItem.includes(targetItem))) {
          sheet.deleteRow(i + 1); 
          return ContentService.createTextOutput("Deleted");
        }
      }
      return ContentService.createTextOutput("NotFound:\n" + debugLog);
    }
    
    // ==========================================
    // 情境 A：批次寫入 (History_Log 專用)
    // ==========================================
    if (tabName === "History_Log") {
       var rows = postData.rows; // 接收整包陣列
       
       if (rows && rows.length > 0) {
         // 使用 setValues 一次寫入多行 (效率高，且不會觸發 appendRow 錯誤)
         var lastRow = sheet.getLastRow();
         // 參數: getRange(起始列, 起始欄, 總列數, 總欄數)
         sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
         return ContentService.createTextOutput("Success");
       } else {
         return ContentService.createTextOutput("Error: 沒有收到快照資料");
       }
    }

    // ==========================================
    // 情境 B：單筆寫入 (打卡、記帳、資產紀錄)
    // ==========================================
    var newRow = [];
    
    if (tabName === "Habit_Log") {
       // 習慣: 日期, 英文, 運動, 讀書, 睡覺
       newRow = [postData.date, postData.english, postData.exercise, postData.reading, postData.sleeping];
       
    } else if (tabName === "Asset_Log") {
       // 資產: 日期, 帳戶, 類別, 項目, 數量, 金額, 型態
       newRow = [postData.date, postData.account, postData.category, postData.item, postData.qty, postData.amount, postData.type];
       
    } else if (tabName === "Expenses_DB") {
       // 記帳: 日期, 類別, 項目, 金額, 帳戶, 收支
       // (注意: 這裡要確認你的 Excel 欄位順序是否為這樣)
       newRow = [postData.date, postData.category, postData.item, postData.amount, postData.account, postData.type];

    } else if (tabName === "Media_Log") {
       // 媒體紀錄：日期, 類別, 標題, 評分, 心得
       newRow = [
         postData.date, 
         postData.type, 
         postData.title, 
         postData.rating, 
         postData.comment
       ];

    } else if (tabName === "Events_DB") {
       // 倒數事件：事件名稱, 日期, 類型
       newRow = [
         postData.title, 
         postData.date, 
         postData.type
       ];
       
    } else if (tabName === "Wishlist_DB") {
       // 願望清單：日期, 項目, 金額, 連結
       newRow = [
         postData.date, 
         postData.item, 
         postData.amount,
         postData.note
       ];
    }

    // 只有當 newRow 有東西時才寫入
    if (newRow.length > 0) {
      sheet.appendRow(newRow);
      return ContentService.createTextOutput("Success");
    } else {
      return ContentService.createTextOutput("Error: 無法識別的分頁或資料為空");
    }
    
  } catch (error) {
    return ContentService.createTextOutput("Error: " + error.toString());
  }
}