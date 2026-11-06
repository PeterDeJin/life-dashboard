// 記帳中心（合併版）Script for Scriptable (iOS)
// -----------------------------------------------------------------------------
// 一個圖示包全部：點開先選「記支出 / 記收入 / 轉帳」，再往下填。
// 寫入格式與 dashboard 各表單完全一致；用的 doPost 本來就有，免重新部署 GAS。
//
// 這是「合併成一支」的版本。若你偏好一個動作一個圖示（少一次選單、更快），
// 就改用分開的 expense-entry.js / income-entry.js / transfer-entry.js。
// 餘額 widget（account-balance-widget.js）維持獨立，因為它是桌面上「一直顯示」的那種。
//
// 安裝：Scriptable 貼上 → 填 API_URL → 存檔。
// -----------------------------------------------------------------------------

// ===== 設定 =====
const API_URL = "在這裡貼上你的 GAS 部署網址";   // 跟 dashboard / widget 同一個 exec 網址
// ================

// 帳戶代號 → 顯示名稱（資料存代號、畫面顯示名稱；與其他腳本/widget 一致）
const LABELS = {
  "ipassmoney": "Line Pay",
  "錢包": "現金錢包",
  "待付款": "待付款",
  "台新信用卡": "台新信用卡",
};
const labelOf = (a) => LABELS[a] || a;

// 支出類別 / 帳戶
const EXP_CATS = ["食", "衣", "住", "行", "育樂", "其他", "娛樂津貼", "代墊"];
const EXP_ACCOUNTS = ["錢包", "中國信託", "華南銀行", "悠遊卡", "icash", "ipassmoney", "學生證", "郵局", "待付款", "台新信用卡"];
// 收入類別（cat 必須與 dashboard INCOME_KINDS 一致；neg=可填負數＝虧損）/ 入帳帳戶
const INC_CATS = [
  { cat: "薪資", neg: false }, { cat: "當沖收入", neg: true }, { cat: "當沖退手續費", neg: false },
  { cat: "股票收入", neg: true }, { cat: "股利", neg: false }, { cat: "利息", neg: false }, { cat: "其他收入", neg: false },
];
const INC_ACCOUNTS = ["華南銀行", "郵局", "富邦銀行", "中國信託", "錢包"];
// 轉帳可選帳戶（與 dashboard OPTIONS.transFrom / transTo 一致）
const TR_FROM = ["郵局", "富邦銀行", "中國信託", "華南銀行", "錢包", "台新銀行"];
const TR_TO = ["錢包", "悠遊卡", "icash", "ipassmoney", "學生證", "待付款", "富邦證券", "中國信託", "郵局", "富邦銀行", "華南銀行", "台新銀行", "台新信用卡"];

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function newId() {
  return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
async function tell(title, msg) {
  const a = new Alert();
  a.title = title;
  if (msg) a.message = msg;
  a.addAction("好");
  await a.presentAlert();
}
async function post(payload) {
  const req = new Request(API_URL);
  req.method = "POST";
  req.headers = { "Content-Type": "text/plain;charset=utf-8" };
  req.body = JSON.stringify(payload);
  req.timeoutInterval = 20;
  try { return await req.loadString(); } catch (e) { return "連線錯誤：" + e; }
}

// ---- 記支出 ----
async function recordExpense() {
  const c = new Alert();
  c.title = "記一筆支出"; c.message = "選類別";
  EXP_CATS.forEach((x) => c.addAction(x));
  c.addCancelAction("取消");
  const ci = await c.presentSheet();
  if (ci === -1) return;
  const cat = EXP_CATS[ci];

  const f = new Alert();
  f.title = cat;
  f.message = cat === "娛樂津貼" ? "從娛樂津貼水缸扣、不佔預算"
    : cat === "代墊" ? "幫人墊、不算自己支出（帳戶照扣）" : "項目與金額";
  f.addTextField("項目（如 午餐）", "");
  f.addTextField("金額", "");
  f.addAction("下一步"); f.addCancelAction("取消");
  if (await f.presentAlert() === -1) return;
  const item = f.textFieldValue(0).trim();
  const amt = Math.abs(parseFloat(f.textFieldValue(1).trim().replace(/,/g, "")));
  if (!item) return tell("缺項目", "請輸入項目名稱");
  if (!amt || isNaN(amt)) return tell("金額無效", "請輸入數字");

  const ac = new Alert();
  ac.title = "付款帳戶";
  EXP_ACCOUNTS.forEach((x) => ac.addAction(labelOf(x)));
  ac.addCancelAction("取消");
  const ai = await ac.presentSheet();
  if (ai === -1) return;
  const account = EXP_ACCOUNTS[ai];

  const res = await post({ tab: "Expenses_DB", date: todayStr(), type: "支出", account, category: cat, item, amount: amt, id: newId() });
  const ok = /Success/i.test(res);
  await tell(ok ? "✅ 記帳成功" : "❌ 寫入失敗", ok ? `${cat}　${item}　${amt.toLocaleString("en-US")}　← ${labelOf(account)}` : res);
}

// ---- 記收入 ----
async function recordIncome() {
  const c = new Alert();
  c.title = "記一筆收入"; c.message = "選類別";
  INC_CATS.forEach((x) => c.addAction(x.cat));
  c.addCancelAction("取消");
  const ci = await c.presentSheet();
  if (ci === -1) return;
  const catDef = INC_CATS[ci];

  const f = new Alert();
  f.title = catDef.cat;
  f.message = catDef.neg ? "金額（虧損請填負數，如 -500）" : "金額";
  f.addTextField("金額", ""); f.addTextField("備註（可留空）", "");
  f.addAction("下一步"); f.addCancelAction("取消");
  if (await f.presentAlert() === -1) return;
  let amt = parseFloat(f.textFieldValue(0).trim().replace(/,/g, ""));
  const note = f.textFieldValue(1).trim();
  if (!amt || isNaN(amt)) return tell("金額無效", "請輸入數字");
  if (!catDef.neg) amt = Math.abs(amt);

  const suggest = /當沖|股利|股票/.test(catDef.cat) ? "富邦銀行" : "華南銀行";
  const ordered = [suggest, ...INC_ACCOUNTS.filter((x) => x !== suggest)];
  const ac = new Alert();
  ac.title = "入帳帳戶"; ac.message = `預設 ${suggest}`;
  ordered.forEach((x) => ac.addAction(x));
  ac.addCancelAction("取消");
  const ai = await ac.presentSheet();
  if (ai === -1) return;
  const account = ordered[ai];

  const item = note ? `${catDef.cat} ${note}` : catDef.cat;
  const res = await post({ tab: "Expenses_DB", date: todayStr(), type: "收入", account, category: catDef.cat, item, amount: amt, id: newId() });
  const ok = /Success/i.test(res);
  await tell(ok ? "✅ 已記收入" : "❌ 寫入失敗", ok ? `${catDef.cat}　${amt.toLocaleString("en-US")}　→ ${account}` : res);
}

// ---- 轉帳 ----
async function recordTransfer() {
  const pick = async (title, list) => {
    const a = new Alert();
    a.title = title;
    list.forEach((v) => a.addAction(labelOf(v)));
    a.addCancelAction("取消");
    const i = await a.presentSheet();
    return i === -1 ? null : list[i];
  };
  const from = await pick("從哪個帳戶轉出", TR_FROM);
  if (!from) return;
  const to = await pick("轉入哪個帳戶", TR_TO.filter((x) => x !== from));
  if (!to) return;

  const f = new Alert();
  f.title = "金額"; f.message = "要轉多少錢";
  f.addTextField("金額", ""); f.addAction("確認"); f.addCancelAction("取消");
  if (await f.presentAlert() === -1) return;
  const amt = Math.abs(parseFloat(f.textFieldValue(0).trim().replace(/,/g, "")));
  if (!amt || isNaN(amt)) return tell("金額無效", "請輸入數字");

  const date = todayStr();
  const pOut = { date, account: from, category: "現金", item: "轉出->" + to, qty: "", amount: -amt, type: "流出" };
  const pIn = { date, account: to, category: "現金", item: "轉入<-" + from, qty: "", amount: amt, type: "流入" };
  const res = await post({ action: "batch", tab: "Asset_Log", records: [pOut, pIn] });
  const ok = /Success/i.test(res);
  await tell(ok ? "✅ 轉帳完成" : "❌ 失敗", ok ? `${labelOf(from)} → ${labelOf(to)}　${amt.toLocaleString("en-US")}` : res);
}

async function main() {
  if (API_URL.includes("貼上")) { await tell("尚未設定", "請先在腳本最上面填 API_URL"); return; }
  const m = new Alert();
  m.title = "記帳中心";
  m.message = "要做什麼？";
  m.addAction("💸 記支出");
  m.addAction("💵 記收入");
  m.addAction("🔄 轉帳");
  m.addCancelAction("取消");
  const i = await m.presentSheet();
  if (i === 0) await recordExpense();
  else if (i === 1) await recordIncome();
  else if (i === 2) await recordTransfer();
}

await main();
Script.complete();
