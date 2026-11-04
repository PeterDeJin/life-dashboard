// 帳戶餘額 Widget for Scriptable (iOS)
// -----------------------------------------------------------------------------
// 安裝：
//   1. App Store 安裝免費的「Scriptable」
//   2. 開 Scriptable → 右上角「+」新增腳本 → 把整段貼上
//   3. 改下面「設定」區：貼上你的 GAS 網址（跟 dashboard 同一個）
//   4. 右上角存檔
//   5. 回桌面 → 長按空白處 → 左上「+」→ 搜尋 Scriptable → 選中尺寸 → 加入
//   6. 長按該 widget →「編輯 Widget」→ Script 選這支、Run 選 Run Script
// 餘額由後端 ?action=balances 算好回傳，widget 只抓一個小 JSON，省流量。
// iOS 會自行決定更新頻率（大約每十幾分鐘）。
// -----------------------------------------------------------------------------

// ===== 設定 =====
const API_URL = "在這裡貼上你的 GAS 部署網址";          // 例：https://script.google.com/macros/s/XXXX/exec
const ONLY = ["富邦銀行", "郵局", "華南銀行", "錢包"];     // 只顯示這幾個帳戶；留空 [] 則顯示全部
const SHOW_TOTAL = true;                                 // 底部顯示各帳戶合計
const SHOW_INVEST = true;                                // 顯示「投組市值」與「總資產」
// ================

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

// 帳戶代號 → 顯示名稱（跟 dashboard 的 FIN.accounts 一致；資料存的是代號）
const LABELS = {
  "ipassmoney": "Line Pay",
  "錢包": "現金錢包",
  "待付款": "待付款",
  "台新信用卡": "台新信用卡",
};
const labelOf = (a) => LABELS[a] || a;

async function getData() {
  const req = new Request(API_URL + "?action=balances");
  req.timeoutInterval = 15;
  return await req.loadJSON();
}

function pickAccounts(accounts) {
  if (!ONLY.length) return accounts;
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ""); // 比對時忽略大小寫與空格
  // ONLY 裡可填「代號」(ipassmoney) 或「顯示名稱」(Line Pay)，兩種都對得上
  return ONLY.map((name) =>
    accounts.find((a) => norm(a.account) === norm(name) || norm(labelOf(a.account)) === norm(name))
  ).filter(Boolean);
}

async function buildWidget() {
  const w = new ListWidget();
  w.setPadding(14, 16, 14, 16);
  const grad = new LinearGradient();
  grad.colors = [new Color("#1e3c72"), new Color("#2a5298")];
  grad.locations = [0, 1];
  w.backgroundGradient = grad;

  let data;
  try {
    data = await getData();
  } catch (e) {
    const t = w.addText("讀取失敗，檢查網址或連線");
    t.textColor = Color.white();
    t.font = Font.systemFont(12);
    return w;
  }

  const title = w.addText("帳戶餘額");
  title.textColor = new Color("#dbe4ff");
  title.font = Font.semiboldSystemFont(13);
  w.addSpacer(6);

  const rows = pickAccounts(data.accounts || []);
  for (const a of rows) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    const name = row.addText(labelOf(a.account));
    name.textColor = Color.white();
    name.font = Font.systemFont(13);
    name.lineLimit = 1;
    row.addSpacer();
    const val = row.addText(money(a.balance));
    val.textColor = a.balance < 0 ? new Color("#ff8a9b") : Color.white();
    val.font = Font.semiboldSystemFont(13);
    w.addSpacer(3);
  }

  if (SHOW_TOTAL) {
    w.addSpacer(4);
    const line = w.addStack();
    line.layoutHorizontally();
    line.centerAlignContent();
    const l = line.addText("合計");
    l.textColor = new Color("#dbe4ff");
    l.font = Font.semiboldSystemFont(13);
    line.addSpacer();
    const sum = rows.reduce((s, a) => s + a.balance, 0);
    const r = line.addText(money(sum));
    r.textColor = Color.white();
    r.font = Font.boldSystemFont(14);
  }

  if (SHOW_INVEST && (data.investValue != null || data.netWorth != null)) {
    w.addSpacer(7);
    const addKV = (label, value, bold) => {
      const s = w.addStack();
      s.layoutHorizontally();
      s.centerAlignContent();
      const l = s.addText(label);
      l.textColor = new Color("#dbe4ff");
      l.font = Font.semiboldSystemFont(12);
      s.addSpacer();
      const v = s.addText(money(value));
      v.textColor = value < 0 ? new Color("#ff8a9b") : Color.white();
      v.font = bold ? Font.boldSystemFont(15) : Font.semiboldSystemFont(13);
      w.addSpacer(2);
    };
    if (data.investValue != null) addKV("投組市值", data.investValue, false);
    if (data.netWorth != null) addKV("總資產", data.netWorth, true);
  }

  w.addSpacer(6);
  const upd = w.addText("更新 " + (data.updated || ""));
  upd.textColor = new Color("#9fb3e0");
  upd.font = Font.systemFont(9);
  return w;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
