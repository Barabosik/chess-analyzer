// The live engine must recover after analysing a solved position. An "infinite"
// search still ends on its own at max depth on a forced mate, delivering a
// bestmove nobody was waiting for; that used to leave the engine's busy flag
// stuck, so the next position's abort() waited forever and the panel froze
// (the "#4 depth 245" that never updated, even back on the main game).
import { suite, open } from "./lib/harness.mjs";

const t = suite("engine-explore");
const { browser, page, errors } = await open();

const liveEval = () => page.evaluate(() => document.getElementById("liveEval").textContent.trim());

// A forced mate (Re8#): the live search races to max depth and self-terminates.
await page.fill("#fenInput", "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1");
await page.click("#loadFen");
await page.waitForTimeout(4000);
const solved = await liveEval();
t.ok("the mate is found", /#/.test(solved), "solved=" + solved);

// Now analyse a fresh, non-mate position. Before the fix this navigation hung
// on abort() and the panel kept showing the mate score.
await page.fill("#fenInput", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
await page.click("#loadFen");
await page.waitForTimeout(3500);
const fresh = await liveEval();
t.ok("live analysis recovers on the next position (no wedge)",
  fresh !== solved && !/#/.test(fresh), "solved=" + solved + " fresh=" + fresh);

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
