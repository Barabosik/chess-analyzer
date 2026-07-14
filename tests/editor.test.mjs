// The visual position editor / confirm-board (the landing surface for screenshot
// import, and usable on its own). Drives it by hand: open it, build a position with the
// palette, and analyze — asserting the game loads with the right FEN. Also checks the
// one-click "Start position" path and that an illegal position is refused, not loaded.
import { suite, open } from "./lib/harness.mjs";

const t = suite("editor");
const { browser, page, errors } = await open();

const hidden = (sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !e || e.classList.contains("hidden");
}, sel);
const fenVal = () => page.inputValue("#fenInput");

// --- open the editor by hand -----------------------------------------------------
await page.click("#scanBtn");
t.ok("the editor opens", !(await hidden("#editorCard")));
t.ok("the palette has 12 pieces + an eraser",
  (await page.$$eval(".palp", (b) => b.length)) === 13, "count");

// --- build K vs K + a pawn, then analyze -----------------------------------------
async function place(code, square) {
  await page.click(`.palp[data-code="${code}"]`);
  await page.click(`#editorBoard .sq[data-sq="${square}"]`);
}
await place("K", "e1");
await place("k", "e8");
await place("P", "e2");
await page.click("#edBlack");                 // Black to move
await page.click("#edAnalyze");
await page.waitForTimeout(150);

t.ok("analyzing closes the editor", await hidden("#editorCard"));
const fen = await fenVal();
t.ok("the built position becomes the game FEN",
  fen.startsWith("4k3/8/8/8/8/8/4P3/4K3 b"), fen);
t.ok("the board on the page shows the built position", await page.evaluate(() =>
  document.querySelectorAll("#board .pc").length === 3), "piece count on board");

// --- one-click start position ----------------------------------------------------
await page.click("#scanBtn");
await page.click("#edStart");
await page.click("#edAnalyze");
await page.waitForTimeout(150);
t.ok("the Start-position button loads the opening", (await fenVal()).startsWith(
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w"), await fenVal());

// --- an illegal position is refused, not loaded ----------------------------------
await page.click("#scanBtn");
await page.click("#edClear");
await place("K", "e1");                        // white king only, no black king
await page.click("#edAnalyze");
await page.waitForTimeout(120);
t.ok("an illegal position keeps the editor open with an error",
  !(await hidden("#editorCard")) && !(await hidden("#edErr")),
  await page.textContent("#edErr").catch(() => ""));

await page.click("#edCancel");
t.ok("cancel closes the editor", await hidden("#editorCard"));

t.ok("no uncaught page errors", errors.length === 0, errors.join("; ") || "clean");

await browser.close();
t.finish();
