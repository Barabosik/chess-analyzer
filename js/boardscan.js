// Read a chess position out of a screenshot of a board — no ML, no model download,
// runs in the browser like everything else. It is tuned for a clean DIGITAL board
// (a screenshot from Lichess / Chess.com), not a photo of a wooden set: the geometry
// is assumed to be a square board sliced evenly into 8×8, white at the bottom.
//
// It is deliberately best-effort. Recognition never has to be perfect because the
// caller lands the result on an editable board for the user to fix — so the honest
// job here is to get most squares right, and to say how sure it is.
//
// How a square is read, and why this holds across board themes and piece colours:
//   - background   = the median of the square's four corners (always board colour).
//   - foreground   = pixels that differ enough from that background = the piece ink.
//   - occupied?    = how much of the square is foreground.
//   - piece TYPE   = which of six cburnett silhouettes the foreground mask matches
//                    (we own those SVGs, so a Lichess-default board matches its own art).
//   - piece COLOUR = whether that foreground is lighter or darker than the square.
// Matching a SHAPE and reading COLOUR separately is what makes it theme-independent:
// neither the board's two colours nor the piece tint enter the type decision.

const PIECES = "vendor/pieces/cburnett/";
const TYPES = ["k", "q", "r", "b", "n", "p"];
const N = 32;                 // each cell is normalised to N×N before matching
const OCC_MIN = 0.06;         // foreground coverage below this = an empty square

// Render the six white cburnett pieces to N×N alpha silhouettes, once. The white set
// is used only for its shape — colour is decided from the screenshot, not the template.
let templatesPromise = null;
function loadTemplates() {
  if (templatesPromise) return templatesPromise;
  templatesPromise = Promise.all(TYPES.map((t) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = N;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, N, N);
      const d = ctx.getImageData(0, 0, N, N).data;
      const mask = new Float32Array(N * N);
      let sum = 0;
      for (let i = 0; i < N * N; i++) { mask[i] = d[i * 4 + 3] / 255; sum += mask[i]; }
      resolve({ code: t, mask, coverage: sum / (N * N) });
    };
    img.onerror = reject;
    img.src = PIECES + "w" + t.toUpperCase() + ".svg";
  })));
  return templatesPromise;
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// Median background colour of a cell, sampled from its four corners (a couple of px in),
// which on a real board are almost always empty square, not piece.
function cellBackground(px, x0, y0, w, h, stride) {
  const samples = [];
  const inset = Math.max(1, Math.round(Math.min(w, h) * 0.08));
  const corners = [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]];
  for (const [cx, cy] of corners) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xi = x0 + cx + dx, yi = y0 + cy + dy;
      const i = (yi * stride + xi) * 4;
      samples.push([px[i], px[i + 1], px[i + 2]]);
    }
  }
  const med = (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1];
  return [med(0), med(1), med(2)];
}

// One cell -> { mask:Float32(N*N), coverage, white }. `mask[i]` is how strongly pixel i
// is foreground (0..1), from its colour distance to the cell background. `white` is the
// piece-colour guess.
//
// Colour is decided by COUNTING interior pixels clearly lighter vs clearly darker than
// the square, NOT from the foreground mask — a cburnett white piece has a black outline
// too, so its darkest pixels are as dark as a black piece's; what actually separates the
// two is the large LIGHT fill a white piece adds and a black piece does not. Counting
// (not extremes) also survives a white fill on a light square, where the fill barely
// clears the foreground threshold used for the shape.
function readCell(px, x0, y0, w, h, stride) {
  const bg = cellBackground(px, x0, y0, w, h, stride);
  const bgL = lum(bg[0], bg[1], bg[2]);
  // Margins scale with the room between the square and pure white / pure black. A light
  // square sits close to a white piece's fill, so a fixed margin misses most of that fill
  // and the black outline wins — reading White's ornate back-rank pieces as black. Taking
  // 35% of the available headroom keeps the fill counted on light squares and the outline
  // counted on dark ones.
  const lightMargin = (255 - bgL) * 0.35;
  const darkMargin = bgL * 0.35;
  const mask = new Float32Array(N * N);
  let cover = 0, lightCount = 0, darkCount = 0;
  for (let ry = 0; ry < N; ry++) {
    for (let rx = 0; rx < N; rx++) {
      // nearest-neighbour sample of the source cell at this normalised position
      const sx = x0 + Math.floor((rx + 0.5) / N * w);
      const sy = y0 + Math.floor((ry + 0.5) / N * h);
      const i = (sy * stride + sx) * 4;
      const dr = px[i] - bg[0], dg = px[i + 1] - bg[1], db = px[i + 2] - bg[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;   // 0..1 (441.67 = √(3·255²))
      mask[ry * N + rx] = dist > 0.18 ? 1 : 0;
      if (mask[ry * N + rx]) cover++;
      const l = lum(px[i], px[i + 1], px[i + 2]);
      if (l > bgL + lightMargin) lightCount++;
      else if (l < bgL - darkMargin) darkCount++;
    }
  }
  // White if there is a SUBSTANTIAL light fill, not merely if light outweighs dark: an
  // ornate white piece (bishop's slit, queen's crown) carries so much internal dark
  // detail that its dark pixels outnumber its light fill, yet a black piece has almost no
  // light fill at all. A 1:4 light-to-dark ratio separates the two with room to spare.
  return { mask, coverage: cover / (N * N), white: lightCount * 4 >= darkCount };
}

// Similarity of two 0/1 masks: intersection-over-union, the standard shape overlap.
function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0.5, y = b[i] > 0.5;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni ? inter / uni : 0;
}

// Trim a solid-colour margin around the board (a screenshot often has one). Scans in
// from each edge while the whole row/column is one flat colour, and stops at the first
// row/column that varies — which, for a board, is its alternating edge. Non-uniform
// surroundings (app chrome, coordinates) won't trim; the result is then implausible and
// the caller refuses it rather than reading noise. Falls back to the whole image if the
// trim collapses.
function autoTrim(px, W, H) {
  const at = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const close = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 36;
  const stepX = Math.max(1, W >> 6), stepY = Math.max(1, H >> 6);
  const rowFlat = (y) => { const c = at(0, y); for (let x = stepX; x < W; x += stepX) if (!close(at(x, y), c)) return false; return true; };
  const colFlat = (x) => { const c = at(x, 0); for (let y = stepY; y < H; y += stepY) if (!close(at(x, y), c)) return false; return true; };
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  while (top < bottom && rowFlat(top)) top++;
  while (bottom > top && rowFlat(bottom)) bottom--;
  while (left < right && colFlat(left)) left++;
  while (right > left && colFlat(right)) right--;
  const w = right - left + 1, h = bottom - top + 1;
  if (w < W * 0.3 || h < H * 0.3) return { x: 0, y: 0, w: W, h: H };
  return { x: left, y: top, w, h };
}

// Attempted, measured, rejected: finding the board INSIDE a busy screenshot by searching
// for the best-scoring 8×8 checkerboard region. A chessboard is self-similar — a box off
// by a fraction of a cell, or by a whole cell, still scores as a checkerboard — so the
// search would not align precisely enough to slice the squares, and it regressed even
// tight boards (a sparse endgame read as garbage). Robust in-image detection needs more
// than a scoring search (gridline projection with sub-pixel peak fitting), which is a
// project of its own. Same call as the multithreading section: measured, worse, dropped.
// So the recognizer stays crop-first: it trims a solid margin and reads what remains, and
// the plausibility gate refuses anything else. The UI asks for a tight crop and says so.

// Scan a source (canvas / image / ImageBitmap): trim a solid margin, then read the 8×8
// (white at the bottom). Returns
// { grid:8×8 of FEN chars|null (rank 8 first), fen, confidence, occupied, plausible }.
export async function scanBoard(source) {
  const templates = await loadTemplates();
  const W = source.width || source.videoWidth, H = source.height || source.videoHeight;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  cv.getContext("2d").drawImage(source, 0, 0, W, H);
  const px = cv.getContext("2d").getImageData(0, 0, W, H).data;
  const crop = autoTrim(px, W, H);

  const grid = [];
  let confSum = 0, occupied = 0;
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      const x0 = crop.x + Math.round(c * crop.w / 8), y0 = crop.y + Math.round(r * crop.h / 8);
      const w = crop.x + Math.round((c + 1) * crop.w / 8) - x0, h = crop.y + Math.round((r + 1) * crop.h / 8) - y0;
      const cell = readCell(px, x0, y0, w, h, W);
      if (cell.coverage < OCC_MIN) { row.push(null); continue; }
      // Best-matching silhouette = piece type.
      let best = null, bestScore = -1, second = -1;
      for (const t of templates) {
        const s = iou(cell.mask, t.mask);
        if (s > bestScore) { second = bestScore; bestScore = s; best = t.code; }
        else if (s > second) second = s;
      }
      row.push(cell.white ? best.toUpperCase() : best);
      occupied++;
      confSum += Math.max(0, bestScore - Math.max(0, second));   // margin over the runner-up
    }
    grid.push(row);
  }
  const confidence = occupied ? confSum / occupied : 0;
  return {
    grid,
    fen: gridToFen(grid),
    occupied,
    confidence,
    // A real position has at most 32 pieces and never fills the board; a garbage read (an
    // uncropped screenshot, a piece set we don't have) fills most squares with barely-
    // distinguishable matches. The caller refuses an implausible result rather than
    // prefilling nonsense the user then has to clear 64 squares of.
    plausible: occupied >= 2 && occupied <= 32 && confidence >= 0.10,
  };
}

// 8×8 grid (rank 8 first) -> the board field of a FEN, then a default rest so it parses.
export function gridToFen(grid, stm = "w") {
  const board = grid.map((row) => {
    let s = "", run = 0;
    for (const cell of row) {
      if (!cell) run++;
      else { if (run) { s += run; run = 0; } s += cell; }
    }
    if (run) s += run;
    return s;
  }).join("/");
  return board + " " + stm + " " + inferCastling(grid) + " - 0 1";
}

// Castling rights are not visible in a still image, so infer the only sane default:
// a side keeps a right only if its king and the matching rook sit on their home squares.
function inferCastling(grid) {
  const at = (r, c) => grid[r] && grid[r][c];
  let s = "";
  if (at(7, 4) === "K") { if (at(7, 7) === "R") s += "K"; if (at(7, 0) === "R") s += "Q"; }
  if (at(0, 4) === "k") { if (at(0, 7) === "r") s += "k"; if (at(0, 0) === "r") s += "q"; }
  return s || "-";
}
