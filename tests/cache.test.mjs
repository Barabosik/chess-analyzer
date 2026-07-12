// A review is ~100 engine searches, and a pure function of (game, depth, engine), so
// re-opening the same game should never redo them. It is cached in IndexedDB.
//
// The dangerous bug here is a key that is too coarse: serving a cheap depth-12 review
// to someone who asked for depth-22 would be silent and wrong. That is pinned below.
import { suite, open, loadPgn } from "./lib/harness.mjs";

const t = suite("cache");
const { browser, page, errors } = await open();

const PGN = '[White "W"]\n[Black "B"]\n[Result "0-1"]\n\n' +
  '1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5 4. Bc4 Bc5 5. d3 Qh4 6. Nf3 Qxf2# 0-1';

const fromCache = () => page.evaluate(() => window.__fromCache);
const acc = () => page.evaluate(() => document.getElementById("accStrip").textContent);

async function review(depth) {
  await page.evaluate(() => { window.__fromCache = undefined; });
  await page.selectOption("#depthSel", depth);
  const t0 = Date.now();
  await page.click("#reviewBtn");
  await page.waitForFunction(() => window.__fromCache !== undefined, null, { timeout: 300000 });
  return Date.now() - t0;
}

await loadPgn(page, PGN);
const coldMs = await review("12");
t.ok("the first review runs the engine", (await fromCache()) === false, "fromCache=" + (await fromCache()));
const coldAcc = await acc();

// Re-open the same game from scratch: the review must come back without the engine.
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready", null, { timeout: 90000 });
await loadPgn(page, PGN);
const warmMs = await review("12");
t.ok("re-opening the same game serves the cached review", (await fromCache()) === true,
  "fromCache=" + (await fromCache()));
t.ok("the cached review is the same review", (await acc()) === coldAcc,
  "cold=" + coldAcc + " warm=" + (await acc()));
t.ok("the cached review is much faster", warmMs < coldMs / 2, "cold=" + coldMs + "ms warm=" + warmMs + "ms");

// THE important one: a different depth is a different review. If the key ignored depth,
// this would silently hand back the depth-12 analysis.
const deepMs = await review("16");
t.ok("asking for a deeper review does NOT serve the shallow cached one",
  (await fromCache()) === false, "fromCache=" + (await fromCache()) + " (depth 16 served from a depth-12 cache!)");
t.ok("the deeper review actually ran the engine", deepMs > warmMs, "deep=" + deepMs + "ms warm=" + warmMs + "ms");

// ...and is then itself cached, independently of the depth-12 one.
await review("16");
t.ok("the deeper review is cached under its own key", (await fromCache()) === true, "fromCache=" + (await fromCache()));
await review("12");
t.ok("the shallow review is still cached alongside it", (await fromCache()) === true, "fromCache=" + (await fromCache()));

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
