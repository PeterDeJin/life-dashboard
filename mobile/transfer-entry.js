// 快速轉帳 Script for Scriptable (iOS)
// -----------------------------------------------------------------------------
// 用途：不用打開 dashboard，手機點一下就做一筆帳戶間轉帳。
// 寫入格式與 dashboard「🔄 轉帳 / 領錢」完全相同：
//   Asset_Log 兩筆（原子寫入）—— 轉出帳戶 金額負數/型態「流出」、轉入帳戶 金額正數/型態「流入」
//   這兩筆會抵銷，不影響總資產，只在帳戶間搬錢（也不會被算成收入）。
//
// 安裝與執行方式同「快速記收入」那支（Scriptable 貼上 → 填 API_URL → 存檔）。
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

// 可選帳戶（與 dashboard OPTIONS.transFrom / transTo 一致）
const FROM = ["郵局", "富邦銀行", "中國信託", "華南銀行", "錢包", "台新銀行"];
const TO   = ["錢包", "悠遊卡", "icash", "ipassmoney", "學生證", "待付款", "富邦證券",
              "中國信託", "郵局", "富邦銀行", "華南銀行", "台新銀行", "台新信用卡"];

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
async function tell(title, msg) {
  const a = new Alert();
  a.title = title;
  if (msg) a.message = msg;
  a.addAction("好");
  await a.presentAlert();
}
async function pick(title, list) {
  const a = new Alert();
  a.title = title;
  list.forEach((v) => a.addAction(labelOf(v)));
  a.addCancelAction("取消");
  const i = await a.presentSheet();
  return i === -1 ? null : list[i];
}
async function enterAmount() {
  const a = new Alert();
  a.title = "金額";
  a.message = "要轉多少錢";
  a.addTextField("金額", "");
  a.addAction("確認");
  a.addCancelAction("取消");
  const i = await a.presentAlert();
  return i === -1 ? null : a.textFieldValue(0).trim();
}

async function main() {
  if (API_URL.includes("貼上")) { await tell("尚未設定", "請先在腳本最上面填 API_URL"); return; }

  const from = await pick("從哪個帳戶轉出", FROM);
  if (!from) return;
  const to = await pick("轉入哪個帳戶", TO.filter((x) => x !== from));
  if (!to) return;

  const raw = await enterAmount();
  if (raw === null) return;
  const amt = Math.abs(parseFloat(raw.replace(/,/g, "")));
  if (!amt || isNaN(amt)) { await tell("金額無效", "請輸入數字"); return; }

  const date = todayStr();
  const pOut = { date, account: from, category: "現金", item: "轉出->" + to, qty: "", amount: -amt, type: "流出" };
  const pIn  = { date, account: to,   category: "現金", item: "轉入<-" + from, qty: "", amount: amt,  type: "流入" };
  const payload = { action: "batch", tab: "Asset_Log", records: [pOut, pIn] };

  const req = new Request(API_URL);
  req.method = "POST";
  req.headers = { "Content-Type": "text/plain;charset=utf-8" };
  req.body = JSON.stringify(payload);
  req.timeoutInterval = 20;

  let res = "";
  try { res = await req.loadString(); } catch (e) { res = "連線錯誤：" + e; }

  const ok = /Success/i.test(res);
  await tell(
    ok ? "✅ 轉帳完成" : "❌ 失敗",
    ok ? `${labelOf(from)} → ${labelOf(to)}　${amt.toLocaleString("en-US")}` : res
  );
  if (ok && config.runsWithSiri) Script.setShortcutOutput(`轉 ${amt}：${labelOf(from)}→${labelOf(to)}`);
}

await main();
Script.complete();
