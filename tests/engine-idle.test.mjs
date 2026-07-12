// The live engine must go idle. It used to run `go infinite`, which searches until
// Stockfish's max depth (~245) — in practice never — so the worker held a core at
// ~90% for as long as the tab stayed open, long after the review had finished. The
// laptop got hot sitting on a finished game. The live search is now depth-capped:
// it converges, emits bestmove, and the worker sleeps.
//
// "Depth stopped climbing" IS "the CPU went idle": the only thing that raises the
// depth is the search still running.
import { suite, open } from "./lib/harness.mjs";

const t = suite("engine-idle");
const { browser, page, errors } = await open();

const LIVE_DEPTH = 20;   // js/app.js LIVE_DEPTH — the cap the live panel searches to

const depth = () => page.evaluate(() => {
  const m = /depth (\d+)/.exec(document.getElementById("liveDepth").textContent);
  return m ? +m[1] : 0;
});

// Wait for the search on the opening position to reach the cap, however slow the
// machine. An uncapped search sails past it and keeps going — which is the bug.
await page.waitForFunction((cap) => {
  const m = /depth (\d+)/.exec(document.getElementById("liveDepth").textContent);
  return m && +m[1] >= cap;
}, LIVE_DEPTH, { timeout: 90000 });

const settled = await depth();
await page.waitForTimeout(6000);
const later = await depth();

t.ok("the live search never searches past its depth cap",
  settled === LIVE_DEPTH, "cap=" + LIVE_DEPTH + " reached=" + settled);
t.ok("the live search terminates instead of burning a core forever",
  later === settled, "depth at settle=" + settled + ", 6s later=" + later);

// Navigating to a new position must start a fresh search that also terminates —
// the cap has to apply to every search, not just the first.
await page.fill("#fenInput", "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3");
await page.click("#loadFen");
await page.waitForFunction((cap) => {
  const m = /depth (\d+)/.exec(document.getElementById("liveDepth").textContent);
  return m && +m[1] >= cap;
}, LIVE_DEPTH, { timeout: 90000 });
const d2 = await depth();
await page.waitForTimeout(5000);
t.ok("a search on the next position terminates too",
  (await depth()) === d2 && d2 === LIVE_DEPTH, "settled=" + d2 + " then=" + (await depth()));

// A backgrounded tab must not analyse at all — that is the version of this bug that
// burns a core while you are not even looking at the page.
//
// The tell has to be the *evaluation*, not the depth: the panel keeps showing the
// last search's numbers while paused (deliberately — no flicker when you tab back),
// so a stale "depth 20" proves nothing. Loading a forced mate does prove it. Only a
// search that actually ran can turn the eval into a mate score.
const setVisibility = (v) => page.evaluate((vis) => {
  Object.defineProperty(document, "visibilityState", { value: vis, configurable: true });
  Object.defineProperty(document, "hidden", { value: vis === "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}, v);
const evalTxt = () => page.evaluate(() => document.getElementById("liveEval").textContent.trim());

const beforeHide = await evalTxt();
await setVisibility("hidden");
await page.fill("#fenInput", "4k3/8/8/8/8/8/8/3QK3 w - - 0 1");   // K+Q v K: a forced mate
await page.click("#loadFen");
await page.waitForTimeout(3000);
const whileHidden = await evalTxt();
t.ok("a hidden tab does not analyse the new position",
  whileHidden === beforeHide && !/[#M]/.test(whileHidden),
  "before=" + beforeHide + " while hidden=" + whileHidden);

// …and picks straight back up when you return to the tab.
await setVisibility("visible");
await page.waitForFunction(() => /[#M]/.test(document.getElementById("liveEval").textContent),
  null, { timeout: 60000 });
t.ok("returning to the tab resumes analysis", /[#M]/.test(await evalTxt()), "eval=" + (await evalTxt()));

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
