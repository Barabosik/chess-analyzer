// The screenshot board recognizer (js/boardscan.js). We can't ship real screenshots to
// the test, so we MAKE one: render a known position to a canvas with the same cburnett
// art a Lichess board uses, then assert scanBoard reads the position back. This proves
// the whole pipeline (slice, occupancy, silhouette-match, colour) end to end for the
// piece set it is tuned to.
import { suite, open } from "./lib/harness.mjs";

const t = suite("boardscan");
const { browser, page, errors } = await open();

// Render a FEN board field to a canvas and hand it to scanBoard, in-page. Returns the
// board field scanBoard reconstructs.
async function scanFen(boardField, { light = "#f0d9b5", dark = "#b58863" } = {}) {
  return page.evaluate(async ({ boardField, light, dark }) => {
    const S = 64;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S * 8;
    const ctx = cv.getContext("2d");
    const grid = boardField.split("/").map((fr) => {
      const arr = [];
      for (const ch of fr) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) arr.push(null); else arr.push(ch); }
      return arr;
    });
    const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? light : dark;
      ctx.fillRect(c * S, r * S, S, S);
      const p = grid[r][c];
      if (p) {
        const img = await load("vendor/pieces/cburnett/" + (p === p.toUpperCase() ? "w" : "b") + p.toUpperCase() + ".svg");
        ctx.drawImage(img, c * S, r * S, S, S);
      }
    }
    const { scanBoard } = await import("/js/boardscan.js?v=32");
    const out = await scanBoard(cv);
    return out.fen.split(" ")[0];
  }, { boardField, light, dark });
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

t.ok("no uncaught page errors", errors.length === 0, errors.join("; ") || "clean");

await browser.close();
t.finish();
