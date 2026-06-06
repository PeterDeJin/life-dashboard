// =========================================================
// 分頁欄位對應表（單一設定來源）
// key   = 前端送來的欄位名稱
// names = Google Sheet 裡可接受的標題（容錯，第一個是建議標題）
// 寫入時依「標題名稱」找欄位，調動欄位順序也不會錯位
// =========================================================
var SCHEMAS = {
  Habit_Log:   [['date',['日期']],['english',['英文']],['exercise',['運動習慣','運動']],['reading',['讀書習慣','讀書']],['sleeping',['睡覺習慣','睡覺']]],
  Asset_Log:   [['date',['日期']],['account',['帳戶']],['category',['資產類別','類別']],['item',['項目名稱','項目']],['qty',['數量','持有數量']],['amount',['金額']],['type',['交易型態','型態']]],
  Expenses_DB: [['date',['日期']],['category',['類別']],['item',['項目','項目名稱']],['amount',['金額']],['account',['帳戶']],['type',['收支']]],
  Media_Log:   [['date',['日期']],['type',['類別']],['title',['標題']],['rating',['評分']],['comment',['心得']]],
  Events_DB:   [['title',['事件名稱']],['date',['日期']],['type',['類型']]],
  Wishlist_DB: [['date',['日期']],['item',['項目名稱','項目']],['amount',['預估金額','金額']],['note',['連結/備註','連結','備註']]]
};

function out(s)     { return ContentService.createTextOutput(s); }
function outJson(o)  { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// 讀取標題列
function getHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  return lastCol < 1 ? [] : sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

// 依標題把一筆物件組成正確順序的列；找不到對應標題時退回 schema 預設順序
function buildRowByHeader(headers, schema, payload) {
  var width = headers.length || schema.length;
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  schema.forEach(function(field, defaultIdx) {
    var key = field[0], names = field[1], idx = -1;
    for (var i = 0; i < headers.length; i++) {
      if (names.indexOf(String(headers[i]).trim()) >= 0) { idx = i; break; }
    }
    if (idx < 0) idx = defaultIdx; // 後備：照 schema 順序
    if (idx >= 0 && idx < width) row[idx] = (payload[key] !== undefined ? payload[key] : '');
  });
  return row;
}

// ---------------------------------------------------------
// 1. 讀取資料（給網頁抓資料用）
// ---------------------------------------------------------
function doGet(e) {
  var tabName = e.parameter.tab;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = tabName ? ss.getSheetByName(tabName) : ss.getSheets()[0];

  if (!sheet) return outJson({ error: "找不到分頁: " + tabName });

  var data = sheet.getDataRange().getValues();
  if (data.length === 0) return out(JSON.stringify([]));

  var headers = data[0];
  var rows = data.slice(1);

  var result = rows.map(function(row) {
    var obj = {};
    row.forEach(function(cell, index) {
      if (Object.prototype.toString.call(cell) === '[object Date]') {
        obj[headers[index]] = Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy/MM/dd");
      } else {
        obj[headers[index]] = cell;
      }
    });
    return obj;
  });

  return outJson(result);
}

// ---------------------------------------------------------
// 2. 寫入資料（由前端 fetch POST 觸發）
//    全程上鎖，避免兩個請求同時寫入造成錯亂
// ---------------------------------------------------------
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // 最多等 20 秒
  } catch (err) {
    return out("Error: 系統忙碌中，請稍後重試");
  }

  try {
    var postData = JSON.parse(e.postData.contents);
    var tabName = postData.tab;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tabName);

    if (!sheet) return out("Error: 找不到分頁 " + tabName);

    // ===== A. 刪除 =====
    if (postData.action === "delete") {
      var targetDate = postData.date.toString().replace(/-/g, "/").trim();
      var targetItem = postData.item.toString().trim();
      var targetAmount = parseFloat(postData.amount.toString().replace(/,/g, ""));

      var data = sheet.getDataRange().getValues();
      var lastRow = data.length;
      var limit = Math.max(1, lastRow - 30); // 搜尋最近 30 筆
      var debugLog = "";

      for (var i = lastRow - 1; i >= limit; i--) {
        var row = data[i];

        var rowDate = (row[0] instanceof Date)
          ? Utilities.formatDate(row[0], "GMT+8", "yyyy/MM/dd")
          : row[0].toString().replace(/-/g, "/").trim();

        // 預設記帳表（Index 2=項目, 3=金額）；夢想購物車欄位不同
        var itemIndex = 2, amountIndex = 3;
        if (tabName === "Wishlist_DB") { itemIndex = 1; amountIndex = 2; }

        var rowItem = row[itemIndex].toString().trim();
        var rowAmount = parseFloat(row[amountIndex].toString().replace(/,/g, ""));

        if (i >= lastRow - 3) debugLog += "[Row " + (i + 1) + "] " + rowDate + " | " + rowItem + " | " + rowAmount + "\n";

        if (rowDate === targetDate && Math.abs(rowAmount - targetAmount) < 1 && (rowItem === targetItem || rowItem.includes(targetItem))) {
          sheet.deleteRow(i + 1);
          return out("Deleted");
        }
      }
      return out("NotFound:\n" + debugLog);
    }

    // ===== B. History_Log：前端已排好順序的批次列 =====
    if (tabName === "History_Log") {
      var hRows = postData.rows;
      if (hRows && hRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, hRows.length, hRows[0].length).setValues(hRows);
        return out("Success");
      }
      return out("Error: 沒有收到快照資料");
    }

    // ===== C. 多筆原子寫入（買賣股、轉帳）：records = [物件,...]，同分頁一次寫入 =====
    if (postData.action === "batch") {
      var schemaB = SCHEMAS[tabName];
      if (!schemaB) return out("Error: 不支援批次寫入的分頁 " + tabName);
      var records = postData.records || [];
      if (!records.length) return out("Error: 沒有收到資料");

      var headersB = getHeaders(sheet);
      var width = headersB.length || schemaB.length;
      var rowsB = records.map(function(rec) { return buildRowByHeader(headersB, schemaB, rec); });
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsB.length, width).setValues(rowsB);
      return out("Success");
    }

    // ===== D. 單筆寫入（依標題對應，不再依位置）=====
    var schema = SCHEMAS[tabName];
    if (!schema) return out("Error: 無法識別的分頁 " + tabName);

    var headers = getHeaders(sheet);
    var widthD = headers.length || schema.length;
    var newRow = buildRowByHeader(headers, schema, postData);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, widthD).setValues([newRow]);
    return out("Success");

  } catch (error) {
    return out("Error: " + error.toString());
  } finally {
    lock.releaseLock();
  }
}

// =========================================================
// 自訂函數：黃金存摺價格（台灣銀行牌價，新台幣 / 公克）
// 試算表用法：=GOLD_NOW() 取現價、=GOLD_PREV() 取前一營業日價
// 取「本行買進」價＝你賣出黃金可拿到的價（＝持有黃金的可變現價值）
// 若想改用「本行賣出」價，把下面的 .buy 改成 .sell 即可
// =========================================================
var _GOLD_DAY = 'https://rate.bot.com.tw/gold/chart/day/TWD';   // 當日盤中
var _GOLD_LTM = 'https://rate.bot.com.tw/gold/chart/ltm/TWD';   // 近期每日

function _goldFetch(url) {
  return UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getContentText();
}

// 解析頁面中的「買進,賣出」配對，依原順序回傳 [{buy, sell}, ...]
function _goldPairs(html) {
  var re = /<td class="text-right">\s*([\d,.]+)\s*<\/td>\s*<td class="text-right">\s*([\d,.]+)\s*<\/td>/g;
  var arr = [], m;
  while ((m = re.exec(html)) !== null) {
    arr.push({ buy: Number(m[1].replace(/,/g, '')), sell: Number(m[2].replace(/,/g, '')) });
  }
  return arr;
}

// 現價：當日盤中最後一筆（最新時間）的「本行買進」；當日無資料則用每日表最新一筆
function GOLD_NOW() {
  try {
    var pairs = _goldPairs(_goldFetch(_GOLD_DAY));
    if (pairs.length) return pairs[pairs.length - 1].buy;
    var daily = _goldPairs(_goldFetch(_GOLD_LTM));
    return daily.length ? daily[0].buy : '';
  } catch (e) { return ''; }
}

// 前一營業日價：每日表中「日期 < 今天」的第一筆「本行買進」
function GOLD_PREV() {
  try {
    var html = _goldFetch(_GOLD_LTM);
    var today = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd');
    var re = /(\d{4}\/\d{2}\/\d{2})<\/a><\/td>[\s\S]*?<td class="text-right">\s*([\d,.]+)\s*<\/td>\s*<td class="text-right">\s*([\d,.]+)\s*<\/td>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (m[1] < today) return Number(m[2].replace(/,/g, ''));
    }
    var daily = _goldPairs(html);
    return daily.length ? daily[0].buy : '';
  } catch (e) { return ''; }
}
