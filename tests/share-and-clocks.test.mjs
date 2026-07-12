import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8787";
const results = [];
const ok = (n, pass, d = "") => {
  results.push({ n, pass, d });
  console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        -> " + d : ""));
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();

// The import card folds away once a game is open; reopen it before touching it.
async function openImport(p = page) {
  if (await p.locator("#impBar").isVisible().catch(() => false)) {
    await p.click("#impToggle");
    await p.waitForTimeout(80);
  }
}

const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

const ready = async (p) => p.waitForFunction(
  () => document.getElementById("engineStatus").textContent === "ready", null, { timeout: 60000 });
const settle = (p) => p.waitForFunction(() => {
  const m = document.getElementById("acctMsg");
  return m && !m.classList.contains("hidden") && !/Fetching|Looking through/.test(m.textContent);
}, null, { timeout: 90000 });
// The copy handler is async (gzip runs in a stream), so wait for the confirmation
// it flashes before reading the clipboard, or we race it.
async function copyAndRead() {
  await page.evaluate(() => document.getElementById("shareNote").classList.add("hidden"));
  await page.click("#shareBtn2");
  await page.waitForSelector("#shareNote:not(.hidden)", { timeout: 10000 });
  return page.evaluate(() => navigator.clipboard.readText());
}

await page.goto(BASE, { waitUntil: "networkidle" });
await ready(page);

// ===== 1. Imported game -> SHORT pointer link =====
await openImport();
await page.fill("#userInput", "https://www.chess.com/game/live/171388438044?username=barab0s1k");
await page.click("#loadUser");
await settle(page);

const barVisible = await page.locator("#shareBar").isVisible();
const kind = await page.locator("#shareKind").textContent();
ok("share bar appears once a game is loaded", barVisible, "kind: " + JSON.stringify(kind));

const shortLink = await copyAndRead();
ok("imported game shares a SHORT pointer link",
  shortLink.includes("#g=cc:171388438044:barab0s1k") && shortLink.length < 120,
  shortLink.length + " chars: " + shortLink);
const note = await page.locator("#shareNote").textContent();
ok("copy shows a confirmation", /copied/i.test(note), JSON.stringify(note));

// ===== 2. That short link actually reopens the game =====
const p2 = await ctx.newPage();
await p2.goto(shortLink, { waitUntil: "networkidle" });
await ready(p2);
await p2.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length > 0, null, { timeout: 60000 });
const reopened = await p2.evaluate(() => ({
  moves: document.querySelectorAll(".mv:not(.empty)").length,
  title: document.getElementById("hdrTitle").textContent.replace(/\s+/g, " ").trim(),
}));
ok("the short link reopens the exact game", reopened.moves === 103 && /barab0s1k/i.test(reopened.title),
  reopened.moves + " moves | " + reopened.title);
await p2.close();

// ===== 3. Clock data from that chess.com PGN =====
const clocks = await page.evaluate(() => ({
  cardVisible: !document.getElementById("timeCard").classList.contains("hidden"),
  sub: document.getElementById("readSub").textContent,
}));
ok("time-per-move card shows for a game with clocks", clocks.cardVisible);

await page.click("#bNext"); await page.click("#bNext"); await page.click("#bNext");
const sub = await page.locator("#readSub").textContent();
ok("readout reports seconds spent on the move", /took\s+[\d.]+\s*s|Took\s+[\d.]+\s*s/i.test(sub),
  JSON.stringify(sub));

// ===== 4. After a review, the clock VERDICT line appears =====
await page.selectOption("#depthSel", "12");
await page.click("#reviewBtn");
await page.waitForSelector("#summary:not(.hidden)", { timeout: 300000 });
const verdict = await page.evaluate(() => {
  const n = document.getElementById("timeNote");
  return { hidden: n.classList.contains("hidden"), text: n.textContent };
});
ok("clock verdict line appears after review", !verdict.hidden && /median/i.test(verdict.text),
  JSON.stringify(verdict.text.slice(0, 150)));

// bars actually drawn (non-blank canvas)
const painted = await page.evaluate(() => {
  const c = document.getElementById("timeGraph");
  const ctx = c.getContext("2d");
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const colors = new Set();
  for (let i = 0; i < d.length; i += 4) colors.add(d[i] + "," + d[i + 1] + "," + d[i + 2]);
  return colors.size;
});
ok("time graph is actually painted with bars", painted > 3, painted + " distinct colours");

// ===== 5. Pasted PGN (no source) -> gzipped link, not a giant one =====
await openImport();
await page.click("#loadSample");
await page.waitForTimeout(500);
const zLink = await copyAndRead();
const rawWouldBe = await page.evaluate(() =>
  (location.origin + location.pathname + "#pgn=" + btoa(document.getElementById("pgnInput").value.trim())).length);
ok("pasted game shares a gzipped link", zLink.includes("#z="),
  zLink.length + " chars (raw #pgn= would be " + rawWouldBe + ")");
// gzip has fixed overhead, so a tiny PGN compresses worse than a real one
// (a 3.4k chess.com PGN with clocks shrinks ~63%). Just require a real saving.
ok("gzipped link is shorter than raw", zLink.length < rawWouldBe * 0.85,
  Math.round((1 - zLink.length / rawWouldBe) * 100) + "% smaller");

const p3 = await ctx.newPage();
await p3.goto(zLink, { waitUntil: "networkidle" });
await ready(p3);
await p3.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length > 0, null, { timeout: 30000 });
const zMoves = await p3.locator(".mv:not(.empty)").count();
ok("the gzipped link round-trips back to the game", zMoves === 103, zMoves + " moves");
await p3.close();

// ===== 6. Old links must not break =====
const legacy = await page.evaluate(() => {
  const pgn = document.getElementById("pgnInput").value.trim();
  return location.origin + location.pathname + "#pgn=" + btoa(unescape(encodeURIComponent(pgn)));
});
const p4 = await ctx.newPage();
await p4.goto(legacy, { waitUntil: "networkidle" });
await ready(p4);
await p4.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length > 0, null, { timeout: 30000 });
ok("legacy #pgn= links still work", (await p4.locator(".mv:not(.empty)").count()) === 103);
await p4.close();

ok("no uncaught page errors", errs.length === 0, errs.slice(0, 3).join(" || ") || "clean");

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log("\n===== " + (results.length - failed.length) + "/" + results.length + " passed =====");
if (failed.length) process.exit(1);
