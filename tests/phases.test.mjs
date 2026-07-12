// Accuracy by phase, and the accuracy fix underneath it.
//
// Book moves used to count toward accuracy. That inflates it: a memorised move is
// theory you remembered, not a move you had to find, and it enters the average as a
// ~0% loss. Accuracy is now computed over non-book moves only, overall and per phase.
import { suite, open, openImport, review } from "./lib/harness.mjs";

const t = suite("phases");
const { browser, page, errors } = await open();

// The bundled sample: a real 103-ply game with a Four Knights book phase, a long
// middlegame, and an endgame it reaches by trading down rather than by move number.
await openImport(page);
await page.click("#loadSample");
await page.waitForTimeout(400);
await review(page, "12");

const rows = () => page.evaluate(() =>
  [...document.querySelectorAll("#phaseRows .phaserow")].map((r) => r.querySelector(".pl").textContent));

t.ok("the phase card is shown",
  await page.evaluate(() => !document.getElementById("phases").classList.contains("hidden")), "phases hidden");

const names = await rows();
t.ok("the game is split into phases", names.length >= 2, "phases=" + JSON.stringify(names));
t.ok("phases appear in game order",
  JSON.stringify(names) === JSON.stringify(["Opening", "Middlegame", "Endgame"].filter((n) => names.includes(n))),
  "phases=" + JSON.stringify(names));

// Every move is assigned to exactly one phase, and the per-phase move counts must
// account for every non-book move — otherwise a phase is silently dropping moves.
const audit = await page.evaluate(() => {
  const mv = window.__moves;
  const nonBook = mv.filter((m) => m.cls !== "book");
  const byPhase = {};
  for (const m of mv) byPhase[m.phase] = (byPhase[m.phase] || 0) + 1;
  return { total: mv.length, nonBook: nonBook.length, byPhase,
    unphased: mv.filter((m) => !m.phase).length,
    book: mv.filter((m) => m.cls === "book").length };
});
t.ok("every move lands in a phase", audit.unphased === 0, JSON.stringify(audit));
t.ok("the game had a book phase to exclude", audit.book > 0, "book moves=" + audit.book);

// The counts shown beside each accuracy must sum to the non-book moves, per side.
const shown = await page.evaluate(() =>
  [...document.querySelectorAll("#phaseRows .phaserow")].map((r) =>
    [...r.querySelectorAll(".pv")].map((v) => v.querySelector(".pc").textContent.trim())));
const sumSide = (i) => shown.reduce((a, r) => a + (+r[i] || 0), 0);
const perSide = await page.evaluate(() => {
  const nb = window.__moves.filter((m) => m.cls !== "book");
  return { w: nb.filter((m) => m.color === "w").length, b: nb.filter((m) => m.color === "b").length };
});
t.ok("the phase move counts add up to every non-book move (White)",
  sumSide(0) === perSide.w, "shown=" + sumSide(0) + " actual=" + perSide.w);
t.ok("the phase move counts add up to every non-book move (Black)",
  sumSide(1) === perSide.b, "shown=" + sumSide(1) + " actual=" + perSide.b);

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
