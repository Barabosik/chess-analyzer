// The screenshot board recognizer (js/boardscan.js). We can't ship real screenshots to
// the test, so we MAKE one: render a known position to a canvas with the same cburnett
// art a Lichess board uses, then assert scanBoard reads the position back. This proves
// the whole pipeline (slice, occupancy, silhouette-match, colour) end to end for the
// piece set it is tuned to.
import { suite, open } from "./lib/harness.mjs";

const t = suite("boardscan");
const { browser, page, errors } = await open();

// Render a FEN board field to a canvas and hand it to scanBoard, in-page. `margin` draws
// a solid surround the recognizer must trim away first. Returns the board field
// scanBoard reconstructs.
async function scanFen(boardField, { light = "#f0d9b5", dark = "#b58863", margin = 0, surround = "#312e2b" } = {}) {
  return page.evaluate(async ({ boardField, light, dark, margin, surround }) => {
    const S = 64, off = margin;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S * 8 + margin * 2;
    const ctx = cv.getContext("2d");
    if (margin) { ctx.fillStyle = surround; ctx.fillRect(0, 0, cv.width, cv.height); }
    const grid = boardField.split("/").map((fr) => {
      const arr = [];
      for (const ch of fr) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) arr.push(null); else arr.push(ch); }
      return arr;
    });
    const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? light : dark;
      ctx.fillRect(off + c * S, off + r * S, S, S);
      const p = grid[r][c];
      if (p) {
        const img = await load("vendor/pieces/cburnett/" + (p === p.toUpperCase() ? "w" : "b") + p.toUpperCase() + ".svg");
        ctx.drawImage(img, off + c * S, off + r * S, S, S);
      }
    }
    const { scanBoard } = await import("/js/boardscan.js?v=32");
    const out = await scanBoard(cv);
    return out.fen.split(" ")[0];
  }, { boardField, light, dark, margin, surround });
}

// Count how many of the 64 squares two board fields agree on.
function agree(a, b) {
  const exp = (bf) => bf.split("/").map((fr) => {
    let s = ""; for (const ch of fr) s += /\d/.test(ch) ? ".".repeat(+ch) : ch; return s;
  }).join("");
  const A = exp(a), B = exp(b);
  let n = 0; for (let i = 0; i < 64; i++) if (A[i] === B[i]) n++;
  return n;
}

// --- the opening position: every piece type, both colours, on both square colours ---
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const gotStart = await scanFen(START);
t.ok("reads the opening position exactly", gotStart === START, "got " + gotStart);

// --- a sparse endgame: occupancy must not invent pieces on empty squares ------------
const EG = "8/5k2/8/4P3/8/2K5/8/8";
const gotEg = await scanFen(EG);
t.ok("reads a sparse endgame (>=62/64 squares)", agree(gotEg, EG) >= 62,
  "got " + gotEg + " (" + agree(gotEg, EG) + "/64)");

// --- a darker board theme: colour decision must not depend on fixed thresholds -------
const gotDark = await scanFen(START, { light: "#b8b8b8", dark: "#6d6d6d" });
t.ok("survives a greyer board theme (>=60/64)", agree(gotDark, START) >= 60,
  "got " + gotDark + " (" + agree(gotDark, START) + "/64)");

// --- a solid margin around the board is trimmed away before slicing ------------------
const gotMargin = await scanFen(START, { margin: 60 });
t.ok("auto-trims a solid margin, then reads the board (>=60/64)", agree(gotMargin, START) >= 60,
  "got " + gotMargin + " (" + agree(gotMargin, START) + "/64)");

// --- a board embedded in a full "app screenshot" is REFUSED, not misread ------------
// In-image board detection was measured and rejected (see boardscan.js), so a board with
// busy chrome around it can't be aligned — the honest outcome is a refusal, never a
// garbage read the user has to clear.
const embedded = await page.evaluate(async (boardField) => {
  const S = 56, ox = 190, oy = 70, BW = 900, BH = 620;
  const cv = document.createElement("canvas");
  cv.width = BW; cv.height = BH;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#14171b"; ctx.fillRect(0, 0, BW, BH);
  ctx.fillStyle = "#1e232b"; ctx.fillRect(ox + 8 * S + 30, 70, 260, 8 * S);
  ctx.fillStyle = "#2a3038"; for (let i = 0; i < 400; i++) ctx.fillRect(Math.random() * BW, Math.random() * BH, 6, 3);
  const grid = boardField.split("/").map((fr) => {
    const a = []; for (const ch of fr) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) a.push(null); else a.push(ch); } return a;
  });
  const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (r + c) % 2 === 0 ? "#f0d9b5" : "#b58863";
    ctx.fillRect(ox + c * S, oy + r * S, S, S);
    const p = grid[r][c];
    if (p) { const img = await load("vendor/pieces/cburnett/" + (p === p.toUpperCase() ? "w" : "b") + p.toUpperCase() + ".svg"); ctx.drawImage(img, ox + c * S, oy + r * S, S, S); }
  }
  const { scanBoard } = await import("/js/boardscan.js?v=33");
  return (await scanBoard(cv)).plausible;
}, START);
t.ok("refuses a board buried in app chrome (no garbage read)", embedded === false, "plausible=" + embedded);

// --- a non-board image is refused, not read as 64 random pieces ----------------------
const garbage = await page.evaluate(async () => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 512;
  const ctx = cv.getContext("2d");
  const im = ctx.createImageData(512, 512);
  for (let i = 0; i < im.data.length; i += 4) {
    im.data[i] = Math.random() * 255; im.data[i + 1] = Math.random() * 255;
    im.data[i + 2] = Math.random() * 255; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  const { scanBoard } = await import("/js/boardscan.js?v=32");
  const out = await scanBoard(cv);
  return { plausible: out.plausible, occupied: out.occupied };
});
t.ok("refuses a garbage (non-board) image", garbage.plausible === false,
  "plausible=" + garbage.plausible + " occupied=" + garbage.occupied);

t.ok("no uncaught page errors", errors.length === 0, errors.join("; ") || "clean");

await browser.close();
t.finish();
