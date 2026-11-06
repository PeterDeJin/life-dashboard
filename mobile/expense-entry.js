// 快速記支出 Script for Scriptable (iOS)
// -----------------------------------------------------------------------------
// 用途：不用打開 dashboard，手機點一下就記一筆支出。
// 寫入格式與 dashboard「日常記帳 → 收支=支出」完全相同：
//   Expenses_DB 一筆，收支=支出，金額存正數（讀取時依收支自動轉負）。
//   類別「娛樂津貼」= 從娛樂津貼水缸扣、不佔當月預算；
//   類別「代墊」= 幫別人墊、不算自己支出（帳戶照扣）。
//
// 安裝與執行方式同另外兩支（Scriptable 貼上 → 填 API_URL → 存檔）。
// -----------------------------------------------------------------------------

// ===== 設定 =====
const API_URL = "在這裡貼上你的 GAS 部署網址";   // 跟 dashboard / widget 同一個 exec 網址
// ================

// 帳戶代號 → 顯示名稱（資料存代號、畫面顯示名稱；三支腳本與 widget 一致）
const LABELS = {
  "ipassmoney": "Line Pay",
  "錢包": "現金錢包",
  "待付款": "待付款",
  "台新信用卡": "台新信用卡",
};
const labelOf = (a) => LABELS[a] || a;

// 支出類別（與 dashboard expenseCatOptions 一致：FIN.categories ＋ 娛樂津貼 ＋ 代墊）
const CATS = ["食", "衣", "住", "行", "育樂", "其他", "娛樂津貼", "代墊"];
// 付款帳戶（與 dashboard OPTIONS.expAccount 一致）
const ACCOUNTS = ["錢包", "中國信託", "華南銀行", "悠遊卡", "icash", "ipassmoney", "學生證", "郵局", "待付款", "台新信用卡"];

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

async function chooseCategory() {
  const a = new Alert();
  a.title = "記一筆支出";
  a.message = "選類別";
  CATS.forEach((c) => a.addAction(c));
  a.addCancelAction("取消");
  const i = await a.presentSheet();
  return i === -1 ? null : CATS[i];
}

async function enterItemAmount(cat) {
  const a = new Alert();
  a.title = cat;
  a.message =
    cat === "娛樂津貼" ? "從娛樂津貼水缸扣、不佔預算" :
    cat === "代墊" ? "幫人墊、不算自己支出（帳戶照扣）" : "項目與金額";
  a.addTextField("項目（如 午餐）", "");
  a.addTextField("金額", "");
  a.addAction("下一步");
  a.addCancelAction("取消");
  const i = await a.presentAlert();
  if (i === -1) return null;
  return { item: a.textFieldValue(0).trim(), amountRaw: a.textFieldValue(1).trim() };
}

async function chooseAccount() {
  const a = new Alert();
  a.title = "付款帳戶";
  ACCOUNTS.forEach((x) => a.addAction(labelOf(x)));
  a.addCancelAction("取消");
  const i = await a.presentSheet();
  return i === -1 ? null : ACCOUNTS[i];
}

async function main() {
  if (API_URL.includes("貼上")) { await tell("尚未設定", "請先在腳本最上面填 API_URL"); return; }

  const cat = await chooseCategory();
  if (!cat) return;

  const ia = await enterItemAmount(cat);
  if (!ia) return;
  if (!ia.item) { await tell("缺項目", "請輸入項目名稱"); return; }
  const amt = Math.abs(parseFloat(ia.amountRaw.replace(/,/g, "")));
  if (!amt || isNaN(amt)) { await tell("金額無效", "請輸入數字"); return; }

  const account = await chooseAccount();
  if (!account) return;

  const payload = {
    tab: "Expenses_DB", date: todayStr(), type: "支出",
    account, category: cat, item: ia.item, amount: amt, id: newId(),
  };

  const req = new Request(API_URL);
  req.method = "POST";
  req.headers = { "Content-Type": "text/plain;charset=utf-8" };
  req.body = JSON.stringify(payload);
  req.timeoutInterval = 20;

  let res = "";
  try { res = await req.loadString(); } catch (e) { res = "連線錯誤：" + e; }

  const ok = /Success/i.test(res);
  await tell(
    ok ? "✅ 記帳成功" : "❌ 寫入失敗",
    ok ? `${cat}　${ia.item}　${amt.toLocaleString("en-US")}　← ${labelOf(account)}` : res
  );
  if (ok && config.runsWithSiri) Script.setShortcutOutput(`已記 ${cat} ${ia.item} ${amt}`);
}

await main();
Script.complete();
