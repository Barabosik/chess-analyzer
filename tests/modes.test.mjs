// The mode switch: analyze (the app as it was), free board (your moves become the
// game), and play-the-engine (a competitive game with the engine's mouth taped
// shut until it ends).
import { suite, open } from "./lib/harness.mjs";

const t = suite("modes");
const { browser, page, errors } = await open();

const hidden = (sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !e || e.classList.contains("hidden") || e.closest(".hidden") != null;
}, sel);
const moveCount = () => page.locator(".mv:not(.empty)").count();
const clickSquare = async (sq) => {
  const b = await page.locator('[data-sq="' + sq + '"]').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(120);
};
const playMove = async (from, to) => { await clickSquare(from); await clickSquare(to); };

// --- default: analyze mode shows the import card, no play bar -----------------
t.ok("analyze mode is the default and shows the import card", !(await hidden(".import")));
t.ok("no play bar in analyze mode", await hidden("#playBar"));

// --- free board: moves you make ARE the game ----------------------------------
await page.click('.modetab[data-mode="solo"]');
await page.waitForTimeout(100);
t.ok("free board hides the import card", await hidden(".import"));
t.ok("free board shows the play bar", !(await hidden("#playBar")));

await playMove("e2", "e4");
await playMove("e7", "e5");   // the OTHER side — a free board moves both
t.ok("moving both sides records both moves in the game", (await moveCount()) === 2,
  (await moveCount()) + " moves");

// stepping back and playing a different move rewrites the game from there
await page.click("#bPrev");
await page.waitForTimeout(100);
await playMove("c7", "c5");
t.ok("moving from an earlier position rewrites the game (1.e4 c5)", (await moveCount()) === 2,
  (await moveCount()) + " moves");
const sans = await page.evaluate(() =>
  [...document.querySelectorAll(".mv:not(.empty) .san")].map((e) => e.textContent));
t.ok("the rewritten game reads 1. e4 c5", sans.join(" ") === "e4 c5", sans.join(" "));

t.ok("the free-board game can be analyzed", await page.evaluate(() =>
  !document.getElementById("reviewBtn").disabled), "review button disabled");

// the PGN box mirrors the built-up game, so share links carry it
const pgn = await page.evaluate(() => document.getElementById("pgnInput").value);
t.ok("the PGN box mirrors the free-board game", /1\. e4 c5/.test(pgn), JSON.stringify(pgn));

// --- play the engine -----------------------------------------------------------
await page.click('.modetab[data-mode="bot"]');
await page.waitForTimeout(100);
t.ok("bot mode shows the setup card", !(await hidden("#playSetup")));

await page.selectOption("#botElo", "0");        // weakest + fastest, for the test
await page.click("#botStart");
await page.waitForTimeout(200);
t.ok("starting hides the setup and shows the game bar",
  (await hidden("#playSetup")) && !(await hidden("#playBar")));

// competitive silence: no live panel, no eval bar, no review
t.ok("the live engine panel is hidden during the game", await hidden("#live"));
t.ok("the eval bar is hidden during the game", await hidden(".evalbar"));
t.ok("the review button is locked during the game", await page.evaluate(() =>
  document.getElementById("reviewBtn").disabled), "review button enabled mid-game");

await playMove("e2", "e4");
await page.waitForFunction(() => document.querySelectorAll(".mv:not(.empty)").length >= 2,
  null, { timeout: 20000 });
t.ok("the engine answers with its own move", (await moveCount()) >= 2,
  (await moveCount()) + " moves");

// resigning ends the game and unlocks the analysis
await page.click("#botResign");
await page.waitForTimeout(200);
t.ok("resigning ends the game", await page.evaluate(() =>
  /resigned/i.test(document.getElementById("playTxt").textContent)),
  await page.evaluate(() => document.getElementById("playTxt").textContent));
t.ok("the review unlocks after the game", await page.evaluate(() =>
  !document.getElementById("reviewBtn").disabled), "review button still disabled");
t.ok("the live panel returns after the game", !(await hidden("#live")));
t.ok("the result lands in the header", await page.evaluate(() =>
  /(1-0|0-1)/.test(document.getElementById("hdrMeta").textContent)),
  await page.evaluate(() => document.getElementById("hdrMeta").textContent));

// --- back to analyze ------------------------------------------------------------
await page.click('.modetab[data-mode="analyze"]');
await page.waitForTimeout(100);
t.ok("analyze mode brings the import card back", !(await hidden(".import")));

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
