// A review is ~100 INDEPENDENT positions, so it is split across a pool of separate
// single-threaded engines. Measured 3.5x on six. (This is the opposite of Threads>1
// inside ONE engine, which measured 5-6x SLOWER — see docs/NOTES.md.)
//
// The whole design rests on one property: THE POOL MUST NOT CHANGE THE ANSWER. It holds
// because the hash is cleared before every position, so a position's evaluation no longer
// depends on who searched it or what they searched before it. If that ever breaks, a
// review would silently mean something different on a 4-core laptop than on a 10-core
// one — and the cache, which does not key on pool size, would serve one to the other.
import { suite, open, openImport } from "./lib/harness.mjs";

const t = suite("pool");
const { browser, page, errors } = await open();

await openImport(page);
await page.click("#loadSample");
await page.waitForTimeout(300);

// Review the same game with N engines, straight through reviewGame.
const reviewWith = (workers) => page.evaluate(async ({ workers }) => {
  const { Chess } = await import("/vendor/chess.js");
  const { Engine } = await import("/js/engine.js");
  const { reviewGame } = await import("/js/review.js");

  const c = new Chess(); c.loadPgn(document.querySelector("#pgnInput").value);
  const rc = new Chess();
  const moves = c.history({ verbose: true }).map((h) => {
    const fenBefore = rc.fen(); const m = rc.move(h.san);
    return { san: m.san, from: m.from, to: m.to, uci: m.from + m.to + (m.promotion || ""),
      color: m.color, fenBefore, fenAfter: rc.fen(),
      moveNo: rc.moveNumber() - (m.color === "w" ? 0 : 1), clock: null, spent: null };
  });

  const engines = [];
  for (let k = 0; k < workers; k++) engines.push(new Engine("/vendor/stockfish/stockfish-18-lite-single.js"));
  await Promise.all(engines.map((e) => e.boot()));
  const t0 = performance.now();
  const r = await reviewGame(workers === 1 ? engines[0] : engines, moves, new Chess().fen(), { depth: 12 });
  const ms = Math.round(performance.now() - t0);
  for (const e of engines) e.quit();

  return { ms,
    labels: r.moves.map((m) => m.cls).join(" "),
    best: r.moves.map((m) => m.bestSan || "-").join(" "),
    evals: r.moves.map((m) => m.cpWhite + ":" + m.mateWhite).join(" "),
    acc: r.accWhite + "/" + r.accBlack };
}, { workers });

const one = await reviewWith(1);
const six = await reviewWith(6);

t.ok("six engines give byte-identical LABELS to one", one.labels === six.labels,
  "labels differ on " + one.labels.split(" ").filter((x, i) => x !== six.labels.split(" ")[i]).length + " moves");
t.ok("six engines give byte-identical EVALUATIONS to one", one.evals === six.evals,
  "evals differ on " + one.evals.split(" ").filter((x, i) => x !== six.evals.split(" ")[i]).length + " positions");
t.ok("six engines give the same recommended moves", one.best === six.best,
  "differing best-moves: " + one.best.split(" ").filter((x, i) => x !== six.best.split(" ")[i]).length);
t.ok("six engines give the same accuracy", one.acc === six.acc, "1=" + one.acc + " 6=" + six.acc);
t.ok("the pool is actually faster", six.ms < one.ms,
  "1 engine=" + one.ms + "ms, 6 engines=" + six.ms + "ms (" + (one.ms / six.ms).toFixed(1) + "x)");

// And it must still be reproducible run to run, which is what a static partition buys.
const six2 = await reviewWith(6);
t.ok("the pooled review is reproducible", six.labels === six2.labels && six.evals === six2.evals,
  "label diffs between two pooled runs: " + six.labels.split(" ").filter((x, i) => x !== six2.labels.split(" ")[i]).length);

// The review pool must not outlive the review: six idle engines would hold hundreds of
// idle MB. Reviewing through the UI must leave exactly the one live engine behind.
const before = await page.evaluate(() => performance.getEntriesByType("resource")
  .filter((r) => /stockfish.*\.wasm/.test(r.name)).length);
await page.selectOption("#depthSel", "12");
await page.click("#reviewBtn");
await page.waitForSelector("#summary:not(.hidden)", { timeout: 300000 });
await page.waitForTimeout(1500);
const liveStillWorks = await page.evaluate(async () => {
  const d = document.getElementById("liveDepth");
  const was = d.textContent;
  document.getElementById("bNext").click();          // force a fresh live search
  await new Promise((r) => setTimeout(r, 6000));
  return { was, now: d.textContent };
});
t.ok("the live engine survives the review pool being torn down",
  /depth \d+/.test(liveStillWorks.now), "liveDepth=" + JSON.stringify(liveStillWorks));

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
