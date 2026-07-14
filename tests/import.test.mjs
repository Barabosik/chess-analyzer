import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8787";
const SHOT = new URL("./tmp/", import.meta.url).pathname;

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


const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  // This suite deliberately looks up a player who does not exist. Chess.com
  // answers 404 (which the app turns into a friendly message) and Chromium logs
  // the 404 to the console no matter how gracefully we handle it — so a failed
  // resource load is expected here and is not an app error.
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) {
    errors.push("console.error: " + m.text());
  }
});

await page.goto(BASE, { waitUntil: "networkidle" });

// --- engine boots at all (guards against a broken module graph after the v5 bump) ---
await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready",
  null, { timeout: 60000 });
ok("engine boots to ready", true);

// ================= CHESS.COM =================
await openImport();
await page.selectOption("#siteSel", "chesscom");
await openImport();
await page.fill("#userInput", "barab0s1k");
await page.click("#loadUser");
await page.waitForSelector(".grow", { timeout: 25000 });

const rows = await page.locator(".grow").count();
ok("chess.com: game rows render", rows > 0, rows + " rows");

const msg = await page.locator("#acctMsg").textContent();
ok("chess.com: status message shown", /recent games/.test(msg), JSON.stringify(msg));

// each row must have a W/L/½ badge and a players line
const first = await page.locator(".grow").first().evaluate((r) => ({
  badge: r.querySelector(".gres")?.textContent,
  badgeClass: r.querySelector(".gres")?.className,
  players: r.querySelector(".gp")?.textContent.trim(),
  me: r.querySelector(".gp .me")?.textContent,
  opening: r.querySelector(".gop")?.textContent,
  meta: r.querySelector(".gmeta")?.textContent.trim(),
}));
ok("chess.com: row has W/L/draw badge", ["W", "L", "½"].includes(first.badge), JSON.stringify(first.badge));
ok("chess.com: row bolds the searched player", (first.me || "").toLowerCase() === "barab0s1k", JSON.stringify(first.me));
ok("chess.com: row shows both players", /vs/.test(first.players || ""), JSON.stringify(first.players));
ok("chess.com: row shows opening name", !!first.opening, JSON.stringify(first.opening));
ok("chess.com: row shows time class + date", !!first.meta, JSON.stringify(first.meta));

// --- click a row: it must load that game onto the board ---
await page.locator(".grow").first().click();
await page.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length > 0, null, { timeout: 10000 });

const loaded = await page.evaluate(() => ({
  title: document.getElementById("hdrTitle").textContent,
  moves: document.querySelectorAll(".mv:not(.empty)").length,
  pgnLen: document.getElementById("pgnInput").value.length,
  activeRows: document.querySelectorAll(".grow.on").length,
  reviewEnabled: !document.getElementById("reviewBtn").disabled,
  whiteName: document.getElementById("pWName").textContent,
  blackName: document.getElementById("pBName").textContent,
}));
ok("click row loads the game", loaded.moves > 0, loaded.moves + " moves, title=" + JSON.stringify(loaded.title));
ok("click row fills the PGN box", loaded.pgnLen > 100, loaded.pgnLen + " chars");
ok("clicked row is highlighted", loaded.activeRows === 1, loaded.activeRows + " highlighted");
ok("Analyze button becomes enabled", loaded.reviewEnabled);
ok("player names populate", /\S/.test(loaded.whiteName) && /\S/.test(loaded.blackName),
  loaded.whiteName + " vs " + loaded.blackName);

// --- board orientation follows the searched player's colour ---
const orient = await page.evaluate(() => {
  const g = window.__t_state;
  return null; // state isn't exported; check the DOM instead
});
// bottom-left square of the board tells us the orientation
const bottomLeft = await page.locator(".board .sq").nth(56).getAttribute("data-sq");
const searchedIsBlack = await page.evaluate(() => {
  const me = "barab0s1k";
  return document.getElementById("pBName").textContent.toLowerCase() === me;
});
// Flipped = rotated 180 degrees, so h8 lands in the bottom-left corner.
ok("board is oriented to the searched player",
  searchedIsBlack ? bottomLeft === "h8" : bottomLeft === "a1",
  "searchedIsBlack=" + searchedIsBlack + " bottomLeft=" + bottomLeft);

await page.screenshot({ path: SHOT + "chesscom.png", fullPage: false });

// --- pasting a PGN clears the account-list highlight ---
await openImport();
await page.click("#loadSample");
await page.waitForTimeout(400);
const afterSample = await page.locator(".grow.on").count();
ok("loading the sample clears the row highlight", afterSample === 0, afterSample + " still highlighted");

// ================= LICHESS =================
await openImport();
await page.selectOption("#siteSel", "lichess");
const clearedOnSwitch = await page.locator(".grow").count();
ok("switching site clears the old list", clearedOnSwitch === 0, clearedOnSwitch + " rows left");

await openImport();
await page.fill("#userInput", "DrNykterstein");
await page.click("#loadUser");
await page.waitForSelector(".grow", { timeout: 25000 });
const lrows = await page.locator(".grow").count();
ok("lichess: game rows render", lrows > 0, lrows + " rows");

const lfirst = await page.locator(".grow").first().evaluate((r) => ({
  badge: r.querySelector(".gres")?.textContent,
  players: r.querySelector(".gp")?.textContent.trim(),
  me: r.querySelector(".gp .me")?.textContent,
  opening: r.querySelector(".gop")?.textContent,
}));
ok("lichess: row has badge + players", ["W", "L", "½"].includes(lfirst.badge) && /vs/.test(lfirst.players),
  lfirst.badge + " | " + lfirst.players);
ok("lichess: row bolds the searched player",
  (lfirst.me || "").toLowerCase() === "drnykterstein", JSON.stringify(lfirst.me));
ok("lichess: row shows opening", !!lfirst.opening, JSON.stringify(lfirst.opening));

await page.locator(".grow").first().click();
await page.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length > 0, null, { timeout: 10000 });
const lmoves = await page.locator(".mv:not(.empty)").count();
ok("lichess: click row loads the game", lmoves > 0, lmoves + " moves");

await page.screenshot({ path: SHOT + "lichess.png" });

// ================= ERROR PATHS =================
await openImport();
await page.fill("#userInput", "zzz_no_such_user_qq_9981");
await page.click("#loadUser");
await page.waitForSelector("#acctMsg.err", { timeout: 20000 });
const errMsg = await page.locator("#acctMsg").textContent();
ok("unknown user shows a friendly error", /no such player/i.test(errMsg), JSON.stringify(errMsg));
const listHidden = await page.locator("#gameList").isHidden();
ok("unknown user hides the stale list", listHidden);
const btnReenabled = await page.evaluate(() => !document.getElementById("loadUser").disabled);
ok("Load games button re-enables after an error", btnReenabled);

// empty username is a no-op, not a crash
await openImport();
await page.fill("#userInput", "");
await page.click("#loadUser");
await page.waitForTimeout(300);
ok("empty username does not crash", errors.filter((e) => e.includes("pageerror")).length === 0);

// ================= REVIEW STILL WORKS (regression) =================
await openImport();
await page.selectOption("#siteSel", "chesscom");
await openImport();
await page.fill("#userInput", "barab0s1k");
await page.click("#loadUser");
await page.waitForSelector(".grow", { timeout: 25000 });
await page.locator(".grow").first().click();
await page.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length > 0, null, { timeout: 10000 });
await page.selectOption("#depthSel", "12");
await page.click("#reviewBtn");
await page.waitForSelector("#summary:not(.hidden)", { timeout: 240000 });
const summary = await page.evaluate(() => ({
  accW: document.querySelectorAll("#accStrip .a b")[0].textContent,
  accB: document.querySelectorAll("#accStrip .a b")[1].textContent,
  classified: document.querySelectorAll(".mv .cg").length,
  graph: !document.getElementById("graphCard").classList.contains("hidden"),
}));
ok("full review still runs on an imported game",
  /%/.test(summary.accW) && summary.classified > 0 && summary.graph,
  "acc " + summary.accW + "/" + summary.accB + ", " + summary.classified + " classified");

await page.screenshot({ path: SHOT + "reviewed.png", fullPage: true });

ok("no uncaught page errors", errors.length === 0, errors.slice(0, 6).join(" || ") || "clean");

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log("\n===== " + (results.length - failed.length) + "/" + results.length + " passed =====");
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log("  - " + f.n + ": " + f.detail));
  process.exit(1);
}
