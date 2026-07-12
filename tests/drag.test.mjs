import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8787";
const results = [];
const ok = (n, pass, d = "") => {
  results.push({ n, pass, d });
  console.log((pass ? "PASS " : "FAIL ") + n + (d ? "\n        -> " + d : ""));
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready",
  null, { timeout: 60000 });

// Centre of a square, straight from the DOM — no coordinate maths to get wrong.
async function centre(sq) {
  const b = await page.locator('[data-sq="' + sq + '"]').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function dragPiece(from, to, { steps = 8 } = {}) {
  const a = await centre(from), b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(120);
}
const pieceOn = (sq) => page.locator('[data-sq="' + sq + '"] .pc').count();
const board = () => page.evaluate(() => ({
  line: document.getElementById("exploreTxt").textContent,
  barShown: !document.getElementById("exploreBar").classList.contains("hidden"),
  selected: document.querySelectorAll(".sq.sel").length,
  targets: document.querySelectorAll(".target").length,
  dragging: document.querySelectorAll(".pc.dragging").length,
  over: document.querySelectorAll(".sq.over").length,
  grabbable: document.querySelectorAll(".sq.grabbable").length,
}));
const reset = async () => {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready",
    null, { timeout: 60000 });
};

// ---- 1. Only the side to move is grabbable ----
let s = await board();
ok("white's 16 pieces are grabbable at the start", s.grabbable === 16, s.grabbable + " grabbable");

// ---- 2. Drag a legal move ----
await dragPiece("e2", "e4");
s = await board();
ok("dragging e2-e4 plays the move",
  (await pieceOn("e4")) === 1 && (await pieceOn("e2")) === 0 && /e4/.test(s.line),
  "line: " + JSON.stringify(s.line));
ok("drag leaves no piece stuck in the dragging state", s.dragging === 0 && s.over === 0);

// ---- 3. After white moved, black's pieces become the grabbable ones ----
s = await board();
ok("grabbable flips to the new side to move", s.grabbable === 16, s.grabbable + " grabbable");
await dragPiece("e7", "e5");
ok("black can be dragged in turn", (await pieceOn("e5")) === 1 && (await pieceOn("e7")) === 0);

// ---- 4. An illegal drop puts the piece back ----
await reset();
await dragPiece("e2", "e7");        // pawns don't teleport
s = await board();
ok("illegal drop returns the piece and plays nothing",
  (await pieceOn("e2")) === 1 && (await pieceOn("e7")) === 1 && !s.barShown && s.selected === 0,
  "e2 kept, e7 untouched, no line started");

// ---- 5. Dragging off the board cancels ----
await reset();
{
  const a = await centre("d2");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y - 400, { steps: 6 });   // way above the board
  await page.mouse.up();
  await page.waitForTimeout(120);
  s = await board();
  ok("dropping outside the board cancels the move",
    (await pieceOn("d2")) === 1 && !s.barShown && s.dragging === 0);
}

// ---- 6. A piece that isn't yours can't be picked up ----
await reset();
await dragPiece("e7", "e5");        // black, but it's white's move
s = await board();
ok("you cannot drag the side that isn't to move",
  (await pieceOn("e7")) === 1 && !s.barShown && s.selected === 0);

// ---- 7. Press-and-release without moving = click-select (targets shown) ----
await reset();
{
  const a = await centre("g1");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
  s = await board();
  ok("a press with no travel selects the piece and shows its moves",
    s.selected === 1 && s.targets === 2, s.selected + " selected, " + s.targets + " targets (Nf3/Nh3)");
}

// ---- 8. Click-to-move still works, unchanged ----
await page.locator('[data-sq="f3"]').click();
await page.waitForTimeout(120);
ok("click-to-move still completes the move",
  (await pieceOn("f3")) === 1 && (await pieceOn("g1")) === 0);

// ---- 9. The lifted piece really is mid-drag while held ----
await reset();
{
  const a = await centre("d2"), b = await centre("d4");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  const mid = await board();
  const transformed = await page.evaluate(() => {
    const p = document.querySelector(".pc.dragging");
    return p ? p.style.transform : "";
  });
  ok("the piece is lifted and follows the cursor while held",
    mid.dragging === 1 && mid.over === 1 && /translate/.test(transformed),
    "over=" + mid.over + " transform=" + JSON.stringify(transformed.slice(0, 40)));
  await page.mouse.up();
  await page.waitForTimeout(120);
}

// ---- 10. Dragging works on a flipped board (coordinates must not invert) ----
await reset();
await page.click("#bFlip");
await page.waitForTimeout(120);
await dragPiece("e2", "e4");
ok("dragging works with the board flipped",
  (await pieceOn("e4")) === 1 && (await pieceOn("e2")) === 0);

// ---- 11. A capture by drag ----
await reset();
await dragPiece("e2", "e4");
await dragPiece("d7", "d5");
await dragPiece("e4", "d5");        // exd5
ok("capturing by drag works", (await pieceOn("d5")) === 1 && (await pieceOn("e4")) === 0,
  "line: " + JSON.stringify((await board()).line));

ok("no uncaught page errors", errs.length === 0, errs.slice(0, 3).join(" || ") || "clean");

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log("\n===== " + (results.length - failed.length) + "/" + results.length + " passed =====");
if (failed.length) process.exit(1);
