import { chromium } from "playwright";

const SHOT = new URL("./tmp/", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:8787";
const results = [];
const ok = (n, pass, detail = "") => {
  results.push({ n, pass, detail });
  console.log((pass ? "PASS " : "FAIL ") + n + (detail ? "  -> " + detail : ""));
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(/(explorer|tablebase)\.lichess\.ovh/, (r) => r.abort());  // stay offline: no live explorer calls

// The import card folds away once a game is open; reopen it before touching it.
async function openImport(p = page) {
  if (await p.locator("#impBar").isVisible().catch(() => false)) {
    await p.click("#impToggle");
    await p.waitForTimeout(80);
  }
}

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready",
  null, { timeout: 60000 });

const state = () => page.evaluate(() => ({
  title: document.getElementById("hdrTitle").textContent.replace(/\s+/g, " ").trim(),
  moves: document.querySelectorAll(".mv:not(.empty)").length,
  msg: document.getElementById("acctMsg").textContent,
  err: document.getElementById("acctMsg").classList.contains("err"),
  white: document.getElementById("pWName").textContent,
  black: document.getElementById("pBName").textContent,
}));
const bottomLeft = () => page.locator(".board .sq").nth(56).getAttribute("data-sq");

async function loadLink(link) {
  await openImport();
  await page.fill("#userInput", link);
  await page.click("#loadUser");
}
async function settle(timeout = 90000) {
  await page.waitForFunction(() => {
    const m = document.getElementById("acctMsg");
    return m && !m.classList.contains("hidden") &&
      !/Fetching|Searching|Looking through/.test(m.textContent);
  }, null, { timeout });
}

// ---- 1. Chess.com link WITH ?username= (the exact shape the user asked about) ----
await loadLink("https://www.chess.com/game/live/171388438044?username=barab0s1k");
await settle();
let s = await state();
ok("chess.com link opens that exact game", s.moves > 0 && /barab0s1k/i.test(s.title),
  s.moves + " moves | " + s.title);
ok("chess.com link: confirmation message", !s.err && /loaded/i.test(s.msg), JSON.stringify(s.msg));
ok("chess.com link: board faces the linked player (White)", (await bottomLeft()) === "a1",
  "bottom-left=" + (await bottomLeft()) + " white=" + s.white);

// ---- 2. Chess.com link WITHOUT ?username= -> must explain, not silently fail ----
await loadLink("https://www.chess.com/game/live/171388438044");
await settle();
s = await state();
ok("chess.com link without username explains itself", s.err && /username/i.test(s.msg),
  JSON.stringify(s.msg.slice(0, 90)));

// ---- 3. Lichess link ----
await loadLink("https://lichess.org/kAdOQKeh");
await settle();
s = await state();
ok("lichess link opens that exact game", s.moves > 0 && /DrNykterstein/i.test(s.title),
  s.moves + " moves | " + s.title);
ok("lichess link: board defaults to White", (await bottomLeft()) === "a1", "bottom-left=" + (await bottomLeft()));

// ---- 4. Lichess link pinned to black -> board should flip ----
// A 180-degree rotation puts h8 (was top-right) in the bottom-left corner.
await loadLink("https://lichess.org/kAdOQKeh/black");
await settle();
ok("lichess /black link flips the board", (await bottomLeft()) === "h8", "bottom-left=" + (await bottomLeft()));

// ---- 5. A link to a game that isn't in that player's history ----
await loadLink("https://www.chess.com/game/live/999999999999?username=barab0s1k");
await settle(90000);
s = await state();
ok("unknown game id gives a clear miss", s.err && /isn.t among barab0s1k/i.test(s.msg),
  JSON.stringify(s.msg.slice(0, 80)));

// ---- 6. Not a chess link at all ----
await loadLink("https://example.com/whatever");
await settle();
s = await state();
ok("non-chess URL is rejected clearly", s.err && /isn.t a Chess\.com or Lichess/i.test(s.msg),
  JSON.stringify(s.msg));

// ---- 7. Link pasted into the PGN box also works ----
await openImport();
await page.fill("#pgnInput", "https://lichess.org/kAdOQKeh");
await openImport();
await page.click("#loadPgn");
await settle();
s = await state();
ok("a link pasted in the PGN box works too", s.moves > 0 && /DrNykterstein/i.test(s.title),
  s.moves + " moves");

// ---- 8. Username search still works (regression) ----
await openImport();
await page.fill("#userInput", "barab0s1k");
await page.click("#loadUser");
await page.waitForSelector(".grow", { timeout: 25000 });
const rows = await page.locator(".grow").count();
ok("username search still lists games", rows > 0, rows + " rows");
await page.locator(".grow").first().click();
await page.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length > 0, null, { timeout: 10000 });
ok("clicking a listed game still loads it", (await state()).moves > 0);

await page.screenshot({ path: SHOT + "link.png" });

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 4).join(" || ") || "clean");

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log("\n===== " + (results.length - failed.length) + "/" + results.length + " passed =====");
if (failed.length) { failed.forEach((f) => console.log("  FAIL " + f.n + ": " + f.detail)); process.exit(1); }
