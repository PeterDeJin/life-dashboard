// 快速記收入 Widget/Script for Scriptable (iOS)
// -----------------------------------------------------------------------------
// 用途：不用打開 dashboard，手機點一下就記一筆收入。
// 寫入格式與 dashboard「💵 每月收入 → ＋記收入」完全相同：
//   Expenses_DB 一筆，收支=收入，category=收入類別，item=類別(+備註)，金額正數
//   （當沖收入 / 股票收入 可填負數＝虧損）
//
// 安裝：
//   1. Scriptable → 右上「+」新增腳本 → 把整段貼上
//   2. 填下面 API_URL（跟 dashboard / 餘額 widget 同一個 exec 網址）
//   3. 存檔
// 執行方式（擇一）：
//   - Scriptable 清單直接點這支
//   - 桌面長按 → 加 Scriptable widget → 編輯 → Script 選這支、When Interacting 選 Run Script
//   - 「捷徑」App 新增捷徑 → 加 Run Script in Scriptable → 選這支（之後可對 Siri 說、或放桌面圖示）
// -----------------------------------------------------------------------------

// ===== 設定 =====
const API_URL = "在這裡貼上你的 GAS 部署網址";   // 例：https://script.google.com/macros/s/XXXX/exec
// ================

// 收入類別（cat 必須與 dashboard 的 INCOME_KINDS 一致，否則分不出類；neg=可填負數＝虧損）
const CATS = [
  { cat: "薪資",         neg: false },
  { cat: "當沖收入",     neg: true  },
  { cat: "當沖退手續費", neg: false },
  { cat: "股票收入",     neg: true  },
  { cat: "股利",         neg: false },
  { cat: "利息",         neg: false },
  { cat: "其他收入",     neg: false },
];
// 入帳帳戶（與 dashboard OPTIONS.incAccount 一致；當沖/股利/股票 預設富邦銀行＝交割戶）
const ACCOUNTS = ["華南銀行", "郵局", "富邦銀行", "中國信託", "錢包"];

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
  a.title = "記一筆收入";
  a.message = "選類別";
  CATS.forEach((c) => a.addAction(c.cat));
  a.addCancelAction("取消");
  const i = await a.presentSheet();
  return i === -1 ? null : CATS[i];
}

async function enterAmountNote(catDef) {
  const a = new Alert();
  a.title = catDef.cat;
  a.message = catDef.neg ? "金額（虧損請填負數，如 -500）" : "金額";
  a.addTextField("金額", "");
  a.addTextField("備註（可留空）", "");
  a.addAction("下一步");
  a.addCancelAction("取消");
  const i = await a.presentAlert();
  if (i === -1) return null;
  return { amountRaw: a.textFieldValue(0).trim(), note: a.textFieldValue(1).trim() };
}

async function chooseAccount(catDef) {
  const suggest = /當沖|股利|股票/.test(catDef.cat) ? "富邦銀行" : "華南銀行";
  const ordered = [suggest, ...ACCOUNTS.filter((x) => x !== suggest)];
  const a = new Alert();
  a.title = "入帳帳戶";
  a.message = `預設 ${suggest}（點其他可改）`;
  ordered.forEach((x) => a.addAction(x));
  a.addCancelAction("取消");
  const i = await a.presentSheet();
  return i === -1 ? null : ordered[i];
}

async function main() {
  if (API_URL.includes("貼上")) { await tell("尚未設定", "請先在腳本最上面填 API_URL"); return; }

  const catDef = await chooseCategory();
  if (!catDef) return;

  const an = await enterAmountNote(catDef);
  if (!an) return;

  let amt = parseFloat(an.amountRaw.replace(/,/g, ""));
  if (!amt || isNaN(amt)) { await tell("金額無效", "請輸入數字"); return; }
  if (!catDef.neg) amt = Math.abs(amt);

  const account = await chooseAccount(catDef);
  if (!account) return;

  const item = an.note ? `${catDef.cat} ${an.note}` : catDef.cat;
  const payload = {
    tab: "Expenses_DB", date: todayStr(), type: "收入",
    account, category: catDef.cat, item, amount: amt, id: newId(),
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
    ok ? "✅ 已記收入" : "❌ 寫入失敗",
    ok ? `${catDef.cat}　${amt.toLocaleString("en-US")}　→ ${account}` : res
  );
  if (ok && config.runsWithSiri) Script.setShortcutOutput(`已記 ${catDef.cat} ${amt}`);
}

await main();
Script.complete();
