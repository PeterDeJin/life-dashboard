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

// =========================================================
// Bark 推播
// 需先到「專案設定 → 指令碼屬性」新增一個屬性：
//   名稱 BARK_KEY，值＝你的 Bark key（多個用逗號分隔）
// =========================================================
function _bark(title, body) {
  var key = PropertiesService.getScriptProperties().getProperty('BARK_KEY');
  if (!key) return;
  key.split(',').forEach(function (k) {
    k = k.trim(); if (!k) return;
    var url = 'https://api.day.app/' + k + '/' + encodeURIComponent(title) + '/' + encodeURIComponent(body) + '?group=Dashboard';
    try { UrlFetchApp.fetch(url, { muteHttpExceptions: true }); } catch (e) {}
  });
}

// 找某分頁某些標題對應的欄位 index（容錯）
function _colIndex(headers, names) {
  for (var i = 0; i < headers.length; i++) {
    if (names.indexOf(String(headers[i]).trim()) >= 0) return i;
  }
  return -1;
}

// =========================================================
// 智慧記帳提醒（每天 22:00 觸發）：當天還沒記任何一筆才推播
// =========================================================
function dailyLogReminder() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Expenses_DB');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) { _bark('記帳提醒', '今天還沒記帳，回家記一下吧'); return; }

    var dateIdx = _colIndex(data[0], ['日期']); if (dateIdx < 0) dateIdx = 0;
    var today = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd');

    var logged = false;
    for (var i = data.length - 1; i >= 1 && i >= data.length - 80; i--) { // 看最後 ~80 筆就夠
      var d = data[i][dateIdx];
      var ds = (d instanceof Date) ? Utilities.formatDate(d, 'GMT+8', 'yyyy/MM/dd') : String(d).replace(/-/g, '/').trim();
      if (ds === today) { logged = true; break; }
    }
    if (!logged) _bark('記帳提醒', '今天還沒記帳，回家記一下吧');
  } catch (e) {}
}

// =========================================================
// 固定支出自動記帳（每天觸發）：到扣款日就寫一筆進 Expenses_DB
// 需要一個 Recurring_DB 分頁：項目、類別、金額、帳戶、扣款日、啟用
// =========================================================
function autoLogRecurring() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var rSheet = ss.getSheetByName('Recurring_DB');
    var eSheet = ss.getSheetByName('Expenses_DB');
    if (!rSheet || !eSheet) return;

    var rData = rSheet.getDataRange().getValues();
    if (rData.length < 2) return;
    var rH = rData[0];
    var ci = {
      item: _colIndex(rH, ['項目', '項目名稱']),
      cat:  _colIndex(rH, ['類別']),
      amt:  _colIndex(rH, ['金額']),
      acc:  _colIndex(rH, ['帳戶']),
      day:  _colIndex(rH, ['扣款日', '每月幾號', '日']),
      on:   _colIndex(rH, ['啟用', '是否啟用'])
    };
    if (ci.item < 0 || ci.amt < 0 || ci.day < 0) return;

    var now = new Date();
    var todayDay = Number(Utilities.formatDate(now, 'GMT+8', 'd'));
    var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var ym = Utilities.formatDate(now, 'GMT+8', 'yyyy/MM');
    var todayStr = Utilities.formatDate(now, 'GMT+8', 'yyyy/MM/dd');

    // 本月已記過的項目（避免重複）
    var eData = eSheet.getDataRange().getValues();
    var eH = eData[0];
    var eItem = _colIndex(eH, ['項目', '項目名稱']);
    var eDate = _colIndex(eH, ['日期']); if (eDate < 0) eDate = 0;
    var done = {};
    for (var i = 1; i < eData.length; i++) {
      var d = eData[i][eDate];
      var mk = (d instanceof Date) ? Utilities.formatDate(d, 'GMT+8', 'yyyy/MM') : String(d).replace(/-/g, '/').slice(0, 7);
      if (mk === ym) done[String(eData[i][eItem]).trim()] = true;
    }

    function isOn(v) {
      if (ci.on < 0) return true;
      v = String(v).trim().toUpperCase();
      return v === 'TRUE' || v === '是' || v === '1' || v === 'Y' || v === 'YES' || v === 'ON' || v === '';
    }

    var schema = SCHEMAS['Expenses_DB'];
    var headers = getHeaders(eSheet);
    var width = headers.length || schema.length;
    var newRows = [], notify = [];

    for (var r = 1; r < rData.length; r++) {
      var row = rData[r];
      if (!isOn(row[ci.on])) continue;
      var item = String(row[ci.item] || '').trim();
      if (!item) continue;
      var due = Number(row[ci.day]); if (!due) continue;
      if (todayDay !== Math.min(due, lastDay)) continue; // 31 號遇到短月→當月最後一天
      if (done[item]) continue;

      var amt = Number(String(row[ci.amt]).replace(/,/g, '')) || 0;
      newRows.push(buildRowByHeader(headers, schema, {
        date: todayStr,
        category: ci.cat < 0 ? '其他' : (row[ci.cat] || '其他'),
        item: item,
        amount: amt,
        account: ci.acc < 0 ? '' : (row[ci.acc] || ''),
        type: '支出'
      }));
      notify.push(item + ' $' + amt);
      done[item] = true;
    }

    if (newRows.length) {
      eSheet.getRange(eSheet.getLastRow() + 1, 1, newRows.length, width).setValues(newRows);
      _bark('已自動記帳', notify.join('、'));
    }
  } catch (e) {
    _bark('自動記帳失敗', String(e));
  } finally {
    lock.releaseLock();
  }
}

// =========================================================
// 一鍵建立排程：在編輯器選這個函數按「執行」一次即可
// =========================================================
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'autoLogRecurring' || fn === 'dailyLogReminder' || fn === 'updateBetas') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoLogRecurring').timeBased().everyDays(1).atHour(2).create();   // 每天凌晨 2 點：固定支出自動記帳
  ScriptApp.newTrigger('dailyLogReminder').timeBased().everyDays(1).atHour(22).create();  // 每天 22 點：記帳提醒
  ScriptApp.newTrigger('updateBetas').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create(); // 每週日 3 點：更新個股 Beta
}

// =========================================================
// 台股即時報價，給 GOOGLEFINANCE 抓不到的股票用
// 用法：「即時單價」欄打 =STOCK_NOW(A33)，「昨日收盤」欄打 =STOCK_PREV(A33)
// 來源：Yahoo Finance 為主（從 GAS 較穩），證交所 MIS 帶 cookie 備援
// 上市 / 上櫃會自動判斷
// =========================================================
function _round2(x) { return Math.round(Number(x) * 100) / 100; }

function _stockFromYahoo(code) {
  var sfx = ['TW', 'TWO']; // 上市 / 上櫃
  for (var i = 0; i < sfx.length; i++) {
    try {
      var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + code + '.' + sfx[i] + '?interval=1d&range=5d';
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.getResponseCode() !== 200) continue;
      var r = JSON.parse(res.getContentText());
      r = r && r.chart && r.chart.result && r.chart.result[0];
      if (!r || !r.meta || !r.meta.regularMarketPrice) continue;
      var now = r.meta.regularMarketPrice;
      var prev = r.meta.chartPreviousClose;
      try {
        var cl = r.indicators.quote[0].close.filter(function (x) { return x != null; });
        if (cl.length >= 2) prev = cl[cl.length - 2]; // 倒數第二筆＝昨收
      } catch (e) {}
      return { now: _round2(now), prev: _round2(prev) };
    } catch (e) {}
  }
  return null;
}

function _stockFromMIS(code) {
  try {
    // 先取 session cookie（MIS 對外部請求常需要）
    var idx = UrlFetchApp.fetch('https://mis.twse.com.tw/stock/index.jsp', { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    var ck = idx.getAllHeaders()['Set-Cookie'] || idx.getAllHeaders()['set-cookie'] || '';
    if (ck instanceof Array) ck = ck.join('; ');
    var hdr = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://mis.twse.com.tw/stock/', 'Cookie': ck };
    var ex = ['tse_', 'otc_'];
    for (var i = 0; i < ex.length; i++) {
      var url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=' + ex[i] + code + '.tw';
      var d = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: hdr }).getContentText());
      var a = d && d.msgArray && d.msgArray[0];
      if (!a) continue;
      var now = parseFloat(a.z);
      if (isNaN(now) || now <= 0) { var b = a.b ? parseFloat(String(a.b).split('_')[0]) : NaN; now = (!isNaN(b) && b > 0) ? b : parseFloat(a.y); }
      var prev = parseFloat(a.y);
      if (!isNaN(now) && now > 0) return { now: _round2(now), prev: (!isNaN(prev) && prev > 0 ? _round2(prev) : '') };
    }
  } catch (e) {}
  return null;
}

function _stockPrice(code) {
  code = String(code).trim().replace(/\.\d+$/, '');
  if (!code) return null;
  return _stockFromYahoo(code) || _stockFromMIS(code);
}

function STOCK_NOW(code)  { var p = _stockPrice(code); return p ? p.now : ''; }
function STOCK_PREV(code) { var p = _stockPrice(code); return (p && p.prev !== '' && p.prev != null) ? p.prev : ''; }

// =========================================================
// 個股 Beta（對台股加權指數 ^TWII，用兩年週報酬自己算）
// 建議用 updateBetas() 排程每週把整欄寫好；BETA(code) 給臨時查單檔用
// =========================================================
function _weeklyCloses(sym) {
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=1wk&range=2y';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.getResponseCode() !== 200) return null;
    var r = JSON.parse(res.getContentText());
    r = r && r.chart && r.chart.result && r.chart.result[0];
    if (!r || !r.timestamp) return null;
    var ts = r.timestamp, cl = r.indicators.quote[0].close, out = {};
    for (var i = 0; i < ts.length; i++) if (cl[i] != null) out[ts[i]] = cl[i];
    return out;
  } catch (e) { return null; }
}

function _marketCloses() { return _weeklyCloses('%5ETWII'); } // ^TWII 加權指數

function _stockCloses(code) {
  code = String(code).trim();
  return _weeklyCloses(code + '.TW') || _weeklyCloses(code + '.TWO');
}

function _betaFromCloses(stock, mkt) {
  if (!stock || !mkt) return '';
  var keys = [];
  for (var k in stock) if (mkt[k] != null) keys.push(Number(k));
  keys.sort(function (a, b) { return a - b; });
  if (keys.length < 20) return ''; // 樣本太少不算
  var sr = [], mr = [];
  for (var i = 1; i < keys.length; i++) {
    sr.push(stock[keys[i]] / stock[keys[i - 1]] - 1);
    mr.push(mkt[keys[i]] / mkt[keys[i - 1]] - 1);
  }
  var n = mr.length, mbar = 0, sbar = 0, j;
  for (j = 0; j < n; j++) { mbar += mr[j]; sbar += sr[j]; }
  mbar /= n; sbar /= n;
  var cov = 0, varr = 0;
  for (j = 0; j < n; j++) { cov += (mr[j] - mbar) * (sr[j] - sbar); varr += (mr[j] - mbar) * (mr[j] - mbar); }
  if (varr === 0) return '';
  return Math.round((cov / varr) * 100) / 100;
}

// 自訂函數：臨時查單檔（別整欄都用這個，會打很多次 API）
function BETA(code) {
  try {
    code = String(code).trim().replace(/\.\d+$/, '');
    if (!code) return '';
    return _betaFromCloses(_stockCloses(code), _marketCloses());
  } catch (e) { return ''; }
}

// 批次：把 Portfolio 的「個股 Beta」整欄重算寫入（排程每週跑一次）
function updateBetas() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(60000); } catch (e) { return; }
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Portfolio');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var head = data[0];
    var nameIdx = _colIndex(head, ['項目名稱', '項目']);
    var betaIdx = _colIndex(head, ['個股 Beta', '個股Beta', 'Beta']);
    if (nameIdx < 0 || betaIdx < 0) return;

    var mkt = _marketCloses();
    if (!mkt) return;

    for (var r = 1; r < data.length; r++) {
      var name = String(data[r][nameIdx]).trim();
      if (!/^[0-9]{4,6}[A-Z]?$/.test(name)) continue; // 只算看起來像股票代號的列
      var b = _betaFromCloses(_stockCloses(name), mkt);
      if (b !== '') sheet.getRange(r + 1, betaIdx + 1).setValue(b);
      Utilities.sleep(150); // 緩一下，對來源友善
    }
  } catch (e) {
    _bark('Beta 更新失敗', String(e));
  } finally {
    lock.releaseLock();
  }
}
