// The "Explain" walk-through: on a non-best move, step through the engine's best
// line move by move, then return with "Got it".
import { suite, open, loadPgn, review } from "./lib/harness.mjs";

const t = suite("explain");
const { browser, page, errors } = await open();

// A short game with a clear blunder (3.Qxe5+) that has a better line.
await loadPgn(page, '[White "W"]\n[Black "B"]\n[Result "0-1"]\n\n' +
  '1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5 4. Bc4 Bc5 5. d3 Qh4 6. Nf3 Qxf2# 0-1');
await review(page, "12");

const barShown = () => page.evaluate(() => !document.getElementById("explainBar").classList.contains("hidden"));
const disabled = (id) => page.evaluate((i) => document.getElementById(i).disabled, id);

await page.click('.mv[data-ply="5"]');   // 3.Qxe5+ (a blunder)
await page.waitForTimeout(200);
t.ok("a non-best move offers a best-move suggestion",
  await page.evaluate(() => !document.getElementById("assessBest").classList.contains("hidden")), "assessBest hidden");

await page.click("#assessBest");         // -> Explain
await page.waitForTimeout(300);
t.ok("Explain opens the walk-through bar", await barShown(), "explainBar hidden");
const line = await page.evaluate(() => document.getElementById("explainTxt").textContent);
t.ok("the bar shows the line and an eval", /[+\-#]/.test(line) && line.replace(/[^A-Za-z]/g, "").length > 2, line);
t.ok("back is disabled on the first move", await disabled("explainPrev"), "prev not disabled at start");

await page.click("#explainNext");        // step forward
await page.waitForTimeout(200);
t.ok("stepping forward enables the back button", !(await disabled("explainPrev")), "prev still disabled after a step");

await page.click("#explainDone");        // Got it
await page.waitForTimeout(200);
t.ok("Got it closes Explain and returns to the review", !(await barShown()), "explainBar still shown");
t.ok("the readout is back on the reviewed move",
  await page.evaluate(() => /Qxe5/.test(document.getElementById("readMove").textContent)),
  await page.evaluate(() => document.getElementById("readMove").textContent));

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
