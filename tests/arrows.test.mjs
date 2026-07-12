// Right-click annotations, like Chess.com/Lichess: right-drag draws an arrow,
// right-click marks a square, drawing the same shape toggles it off, a modifier
// colours it, and any left click clears everything.
import { suite, open, loadPgn } from "./lib/harness.mjs";

const t = suite("arrows");
const { browser, page, errors } = await open();

// A loaded position to draw on (no review needed — arrows work any time).
await loadPgn(page, '[White "W"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *');

const center = async (sq) => {
  const b = await page.locator('[data-sq="' + sq + '"]').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function rightDraw(from, to, { shift = false } = {}) {
  const a = await center(from), b = await center(to);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up({ button: "right" });
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(50);
}
const arrows = () => page.locator("#board svg polyline").count();  // one <polyline> per arrow shaft
const marks = () => page.locator("#board svg circle").count();     // one <circle> per square mark

// The shaft's points, as [[x,y], …]. A straight arrow has two; a knight's has three,
// the middle one being the corner it turns.
const shaft = async () => (await page.locator("#board svg polyline").first().getAttribute("points"))
  .trim().split(/\s+/).map((p) => p.split(",").map(Number));

// draw an arrow
await rightDraw("e2", "e4");
t.ok("right-drag draws an arrow", (await arrows()) === 1, "arrows=" + (await arrows()));

// same arrow again toggles it off
await rightDraw("e2", "e4");
t.ok("drawing the same arrow again removes it", (await arrows()) === 0, "arrows=" + (await arrows()));

// right-click (no travel) marks a square
await rightDraw("d4", "d4");
t.ok("right-click marks a square", (await marks()) === 1, "marks=" + (await marks()));

// a second arrow coexists with the mark
await rightDraw("g1", "f3");
t.ok("a second annotation coexists", (await arrows()) === 1 && (await marks()) === 1,
  "arrows=" + (await arrows()) + " marks=" + (await marks()));

// left click clears every annotation
await page.mouse.click((await center("a3")).x, (await center("a3")).y);
await page.waitForTimeout(50);
t.ok("a left click clears all annotations", (await arrows()) === 0 && (await marks()) === 0,
  "arrows=" + (await arrows()) + " marks=" + (await marks()));

// a modifier picks a different colour (shift = red)
await rightDraw("b1", "c3", { shift: true });
const stroke = await page.locator("#board svg polyline").first().getAttribute("stroke");
t.ok("shift draws a red arrow", stroke === "#a02c2c", "stroke=" + stroke);

// ---- knight arrows bend, like Chess.com ----
// A straight g1-f3 line cuts across squares the knight never visits and reads as a
// bishop move. It must turn a right angle: the long leg first, then into the target.
await page.mouse.click((await center("a3")).x, (await center("a3")).y);   // clear
await rightDraw("e2", "e4");
const straight = await shaft();
t.ok("an ordinary move draws a straight arrow", straight.length === 2,
  "points=" + JSON.stringify(straight));

await page.mouse.click((await center("a3")).x, (await center("a3")).y);   // clear
await rightDraw("g1", "f3");
const knight = await shaft();
const [start, corner, end] = knight;
t.ok("a knight's move draws an elbow, not a straight line", knight.length === 3,
  "points=" + JSON.stringify(knight));
// The corner turns a true right angle: it leaves the origin along one axis and
// arrives at the target along the other. g1-f3 goes g1->g3, then across to f3.
t.ok("the elbow travels the long leg first, then turns square into the target",
  knight.length === 3 && corner[0] === start[0] && corner[1] === end[1] &&
  Math.abs(corner[1] - start[1]) === 2,
  "start=" + start + " corner=" + corner + " end=" + end);

// The same move seen from Black's side must still bend (the elbow is computed after
// the flip, so a mirrored board must not straighten it out).
await page.click("#bFlip");
await page.mouse.click((await center("a3")).x, (await center("a3")).y);
await rightDraw("g1", "f3");
const flipped = await shaft();
t.ok("the elbow survives a board flip", flipped.length === 3, "points=" + JSON.stringify(flipped));
await page.click("#bFlip");   // back to White's view; the arrow stays up for the next check

// navigating away clears annotations too
await page.click("#bNext");
await page.waitForTimeout(50);
t.ok("navigation clears annotations", (await arrows()) === 0, "arrows=" + (await arrows()));

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
