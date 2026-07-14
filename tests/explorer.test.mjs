// The opening explorer / endgame tablebase panel (js/explorer.js). Lichess's real
// databases are external, so this suite MOCKS both endpoints with page.route — the
// app must render their shapes correctly, and must step aside quietly when they fail.
import { suite, open, loadPgn } from "./lib/harness.mjs";

const t = suite("explorer");
const { browser, page, errors } = await open();

const hidden = (sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !e || e.classList.contains("hidden");
}, sel);

// A canned opening-explorer answer: e4 the popular choice, d4 second.
const EXPLORER_JSON = {
  white: 520, draws: 180, black: 300,
  opening: { eco: "B00", name: "King's Pawn Game" },
  moves: [
    { uci: "e2e4", san: "e4", white: 300, draws: 90, black: 160, averageRating: 1850 },
    { uci: "d2d4", san: "d4", white: 150, draws: 60, black: 90, averageRating: 1840 },
    { uci: "g1f3", san: "Nf3", white: 70, draws: 30, black: 50, averageRating: 1830 },
  ],
};
// A canned tablebase answer: side to move is winning, Qg2# style best move.
const TABLEBASE_JSON = {
  category: "win", dtz: 3, dtm: 5, checkmate: false, stalemate: false,
  moves: [
    { uci: "g2b2", san: "Qb2+", category: "loss", dtz: -2, dtm: -4, zeroing: false },
    { uci: "g2g6", san: "Qg6", category: "loss", dtz: -6, dtm: -8, zeroing: false },
  ],
};

let mode = "ok";   // "ok" serves JSON, "fail" aborts — flipped per test
await page.route("**/explorer.lichess.ovh/**", (route) =>
  mode === "fail" ? route.abort()
    : route.fulfill({ contentType: "application/json", body: JSON.stringify(EXPLORER_JSON) }));
await page.route("**/tablebase.lichess.ovh/**", (route) =>
  mode === "fail" ? route.abort()
    : route.fulfill({ contentType: "application/json", body: JSON.stringify(TABLEBASE_JSON) }));

// --- opening explorer renders for a normal position -----------------------------
await loadPgn(page, "1. e4 e5 2. Nf3 Nc6 *");
await page.waitForSelector("#explorerCard:not(.hidden) .exrow", { timeout: 8000 });
const rows = await page.$$eval("#explorerCard .exrow .exsan", (els) => els.map((e) => e.textContent));
t.ok("opening explorer lists the database moves", rows.slice(0, 2).join(",") === "e4,d4", rows.join(" "));
t.ok("the title reads 'Opening explorer'",
  (await page.textContent("#explorerTitle")) === "Opening explorer");

const bar = await page.$eval("#explorerCard .exrow .wdl", (e) => ({
  w: e.querySelector(".w").style.width, d: e.querySelector(".d").style.width, b: e.querySelector(".b").style.width }));
t.ok("each move shows a white/draw/black result bar", !!bar.w && !!bar.d && !!bar.b, JSON.stringify(bar));

// --- clicking a move plays it on the board --------------------------------------
await page.click("#explorerCard .exrow");
await page.waitForTimeout(200);
t.ok("clicking a database move plays it (exploration line opens)", !(await hidden("#exploreBar")));

// --- tablebase renders for a <=7-piece position ---------------------------------
await page.click("#returnGame").catch(() => {});
await page.evaluate(() => {
  document.getElementById("fenInput").value = "7k/8/8/8/8/8/6Q1/6K1 w - - 0 1";  // K+Q vs K, 3 pieces
  document.getElementById("loadFen").click();
});
await page.waitForSelector("#explorerCard:not(.hidden) .tbverdict", { timeout: 8000 });
t.ok("tablebase title shows for an endgame", (await page.textContent("#explorerTitle")) === "Endgame tablebase");
t.ok("tablebase gives the winning verdict",
  /Winning/.test(await page.textContent("#explorerCard .tbverdict")),
  await page.textContent("#explorerCard .tbverdict"));
const vis = await page.evaluate(() => document.getElementById("explorerRating").style.visibility);
t.ok("the rating selector is hidden for perfect-play positions", vis === "hidden", "visibility=" + JSON.stringify(vis));

// --- graceful degradation: when the API is down, the panel just leaves -----------
mode = "fail";
await page.evaluate(() => {
  document.getElementById("fenInput").value = "8/8/4k3/8/8/2K5/8/4R3 w - - 0 1";  // fresh (uncached) endgame
  document.getElementById("loadFen").click();
});
await page.waitForTimeout(1200);
t.ok("the panel hides itself when the database is unreachable", await hidden("#explorerCard"));

t.ok("no uncaught page errors", errors.length === 0, errors.join("; ") || "clean");

await browser.close();
t.finish();
