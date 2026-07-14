// The move-quality flourish and the class-coloured resting squares.
// Stepping FORWARD onto a brilliant/great move floods the square, pops a label,
// and fades to leave both squares tinted in the class colour. Every reviewed
// move tints its squares; only brilliant/great also animate.
import { suite, open, loadPgn, review } from "./lib/harness.mjs";

// Same game the classifier suite uses: 16.Bxh6 is a real bishop sacrifice and
// the one dependable Brilliant we have.
const SAMPLE = '[White "W"]\n[Black "B"]\n[Result "1-0"]\n\n' +
  '1. e4 e5 2. Nc3 Nc6 3. Nf3 Nf6 4. d4 exd4 5. Nxd4 Bb4 6. Nxc6 bxc6 7. Bd3 d5 ' +
  '8. exd5 O-O 9. O-O cxd5 10. Bg5 c6 11. Qf3 Bd6 12. Rae1 Rb8 13. b3 Bb4 14. Qg3 Be6 ' +
  '15. Qh4 h6 16. Bxh6 gxh6 17. Qxh6 Bxc3 18. Rxe6 Ne4 19. Rxe4 dxe4 20. Bxe4 f5 1-0';
const BRILLIANT_PLY = 31;   // 16.Bxh6 (white's 16th move)
const RECAPTURE_PLY = 32;   // 16...gxh6, a plain recapture — not celebrated

const t = suite("flourish");
const { browser, page, errors } = await open();

await loadPgn(page, SAMPLE);
await review(page, "12");

// Step forward ONTO `ply` from the move before it, so the forward-navigation
// path (the only one that fires the flourish) runs — mirroring a real click of
// the next-move button.
async function stepOnto(ply) {
  await page.click("#bStart");
  if (ply - 1 > 0) await page.click('.mv[data-ply="' + (ply - 1) + '"]');
  await page.click("#bNext");
  await page.waitForTimeout(150);
}

const snapshot = () => page.evaluate(() => {
  const fl = document.querySelector(".flourish");
  const hl = [...document.querySelectorAll(".sq.hl.clshl")];
  return {
    flourishes: document.querySelectorAll(".flourish").length,
    bubble: fl ? fl.querySelector(".fl-bubble").textContent : null,
    // the glyph is an SVG now (font glyphs centred differently in every fallback
    // font); the mark it stands for travels in data-g
    glyph: fl ? fl.querySelector(".fl-glyph").dataset.g : null,
    glyphDrawn: fl ? !!fl.querySelector(".fl-glyph svg.clsglyph") : null,
    fillBg: fl ? getComputedStyle(fl.querySelector(".fl-fill")).backgroundColor : null,
    tinted: hl.length,
    tintCol: hl.length ? hl[0].style.getPropertyValue("--hl-col").trim() : null,
  };
});

// --- a Brilliant celebrates -------------------------------------------------
await stepOnto(BRILLIANT_PLY);
{
  const s = await snapshot();
  t.ok("stepping onto the Brilliant shows exactly one flourish", s.flourishes === 1,
    "found " + s.flourishes);
  t.ok("the label reads 'Brilliant!'", s.bubble === "Brilliant!", "got " + s.bubble);
  t.ok("the glyph is the brilliant mark", s.glyph === "!!", "got " + s.glyph);
  t.ok("the glyph is drawn as an SVG, not a font character", s.glyphDrawn === true,
    "no svg.clsglyph inside .fl-glyph");
  t.ok("the fill is the brilliant teal (#26c2a3)", s.fillBg === "rgb(38, 194, 163)",
    "got " + s.fillBg);
  t.ok("both squares are tinted in the class colour", s.tinted === 2, "tinted " + s.tinted);
  t.ok("the resting tint is the brilliant colour", s.tintCol === "var(--brilliant)",
    "got " + s.tintCol);
}

// --- a Brilliant explains WHY it works, like a blunder explains what was better --
{
  const why = await page.evaluate(() => {
    const box = document.getElementById("assessBest");
    return { hidden: box.classList.contains("hidden"), text: box.textContent };
  });
  t.ok("the Brilliant offers a 'why it works' walk-through", !why.hidden && /why it works/i.test(why.text),
    JSON.stringify(why));
  const note = await page.evaluate(() => document.getElementById("assessNote").textContent);
  t.ok("the coach note names the sacrificed piece", /bishop/.test(note), note);

  await page.click("#assessBest");
  await page.waitForTimeout(250);
  const bar = await page.evaluate(() => ({
    shown: !document.getElementById("explainBar").classList.contains("hidden"),
    title: document.getElementById("readMove").textContent,
  }));
  t.ok("Explain opens on the follow-up line", bar.shown, JSON.stringify(bar));
  t.ok("the readout says why, not 'best line'", /why/i.test(bar.title), bar.title);
  await page.click("#explainDone");
  await page.waitForTimeout(150);
}

// --- a plain move tints its squares but does NOT animate ---------------------
await stepOnto(RECAPTURE_PLY);
{
  const s = await snapshot();
  t.ok("a non-brilliant/great move shows no flourish", s.flourishes === 0,
    "found " + s.flourishes);
  t.ok("it still tints its two squares in its class colour", s.tinted === 2,
    "tinted " + s.tinted);
}

// --- rapid navigation must not stack flourishes -----------------------------
await page.click("#bStart");
for (let i = 0; i < 6; i++) await page.click("#bNext");   // no waits: fire them fast
await page.waitForTimeout(80);
{
  const n = await page.evaluate(() => document.querySelectorAll(".flourish").length);
  t.ok("racing through moves leaves at most one flourish", n <= 1, "found " + n);
}

// --- prefers-reduced-motion suppresses the animation ------------------------
await page.emulateMedia({ reducedMotion: "reduce" });
await stepOnto(BRILLIANT_PLY);
{
  const s = await snapshot();
  t.ok("no flourish animates under reduced-motion", s.flourishes === 0,
    "found " + s.flourishes);
  t.ok("the resting tint still shows under reduced-motion", s.tinted === 2,
    "tinted " + s.tinted);
}
await page.emulateMedia({ reducedMotion: null });

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
