import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8787";

const SHOT = new URL("./tmp/", import.meta.url).pathname;
const results = [];
const ok = (n, pass, d = "") => {
  results.push({ n, pass });
  console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        -> " + d : ""));
};

const browser = await chromium.launch();
// A real laptop screen — the case the user complained about.
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });

// The import card folds away once a game is open; reopen it before touching it.
async function openImport(p = page) {
  if (await p.locator("#impBar").isVisible().catch(() => false)) {
    await p.click("#impToggle");
    await p.waitForTimeout(80);
  }
}

const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready",
  null, { timeout: 60000 });

await openImport();
await page.click("#loadSample");
await page.waitForTimeout(500);

ok("no page errors on load (summary element exists again)", errs.length === 0,
  errs.slice(0, 2).join(" || ") || "clean");

const moves = await page.locator(".mv:not(.empty)").count();
ok("the moves list is actually populated", moves === 103, moves + " moves");

// Order of the right column
const order = await page.evaluate(() =>
  [...document.querySelector(".rightcol").children].map((c) => c.id || c.className));
ok("Moves sits directly under the Analyze button",
  /movescard/.test(order[1]), order.join("  |  "));

// The thing the user actually cares about: is the moves list on screen at the
// same time as the board, without scrolling?
const geom = await page.evaluate(() => {
  const b = document.getElementById("board").getBoundingClientRect();
  const m = document.getElementById("movelist").getBoundingClientRect();
  return {
    boardTop: Math.round(b.top), boardBottom: Math.round(b.bottom),
    movesTop: Math.round(m.top), movesBottom: Math.round(m.bottom),
    vh: window.innerHeight,
  };
});
const bothVisible = geom.movesTop < geom.vh && geom.boardTop < geom.vh;
ok("board and moves are both on screen at once (no scrolling to step)", bothVisible,
  "board " + geom.boardTop + "-" + geom.boardBottom +
  ", moves " + geom.movesTop + "-" + geom.movesBottom + ", viewport " + geom.vh);

// Review, then check the overlap bug and the strip
await page.selectOption("#depthSel", "12");
await page.click("#reviewBtn");
await page.waitForSelector("#summary:not(.hidden)", { timeout: 300000 });

const strip = await page.evaluate(() => {
  const s = document.getElementById("accStrip");
  return { hidden: s.classList.contains("hidden"), text: s.textContent.replace(/\s+/g, " ").trim() };
});
ok("accuracy headline stays up top next to the board", !strip.hidden && /%/.test(strip.text),
  JSON.stringify(strip.text));

// Each side gets its rough game-rating estimate under the accuracy.
const est = await page.evaluate(() =>
  [...document.querySelectorAll("#accStrip .a .est")].map((e) => e.textContent));
ok("both players get a game-rating estimate", est.length === 2 && est.every((t) => /≈ \d{3,4}/.test(t)),
  est.join(" | ") || "none");

// The breakdown marks are SVGs (font glyphs sat off-centre, each in its own way).
const glyphs = await page.evaluate(() => ({
  breakdown: document.querySelectorAll("#counts .g svg.clsglyph").length,
  legend: document.querySelectorAll("#legend .g svg.clsglyph").length,
}));
ok("all 9 breakdown and legend marks are drawn as SVGs",
  glyphs.breakdown === 9 && glyphs.legend === 9, JSON.stringify(glyphs));

// The graphs and legend live in the LEFT column now — the space under the board
// used to sit empty while the right column ran on.
const inLeft = await page.evaluate(() =>
  ["graphCard", "timeCard"].every((id) => !!document.getElementById(id).closest(".leftcol")) &&
  !!document.querySelector(".leftcol .legendcard"));
ok("eval graph, time graph and legend fill the left column", inLeft);

// THE OVERLAP: does any SAN visually collide with its classification glyph?
const overlaps = await page.evaluate(() => {
  const bad = [];
  for (const mv of document.querySelectorAll(".mv:not(.empty)")) {
    const san = mv.querySelector(".san"), cg = mv.querySelector(".cg");
    if (!san || !cg) continue;
    const a = san.getBoundingClientRect(), b = cg.getBoundingClientRect();
    if (a.right > b.left + 0.5) bad.push(san.textContent + " over " + cg.textContent);
  }
  return bad;
});
ok("no move text overlaps its classification glyph", overlaps.length === 0,
  overlaps.length ? overlaps.slice(0, 5).join(", ") : "0 collisions across all 103 moves");

// Font size readable
const fs = await page.evaluate(() =>
  getComputedStyle(document.querySelector(".mv .san")).fontSize);
ok("move text is a readable size", parseFloat(fs) >= 14, fs);

const noOverflow = await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth);
ok("still no horizontal overflow", noOverflow);

await page.screenshot({ path: SHOT + "layout-laptop.png" });

// Narrow column: the overlap case from the user's zoomed screenshot
await page.setViewportSize({ width: 900, height: 820 });
await page.waitForTimeout(400);
const overlapsNarrow = await page.evaluate(() => {
  const bad = [];
  for (const mv of document.querySelectorAll(".mv:not(.empty)")) {
    const san = mv.querySelector(".san"), cg = mv.querySelector(".cg");
    if (!san || !cg) continue;
    const a = san.getBoundingClientRect(), b = cg.getBoundingClientRect();
    if (a.right > b.left + 0.5) bad.push(san.textContent);
  }
  return bad;
});
ok("no overlap in a narrow column either", overlapsNarrow.length === 0,
  overlapsNarrow.length ? overlapsNarrow.slice(0, 5).join(", ") : "0 collisions");
await page.screenshot({ path: SHOT + "layout-narrow.png" });

ok("no uncaught errors at the end", errs.length === 0, errs.slice(0, 2).join(" || ") || "clean");

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log("\n===== " + (results.length - failed.length) + "/" + results.length + " passed =====");
if (failed.length) process.exit(1);
