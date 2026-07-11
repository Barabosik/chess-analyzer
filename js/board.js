// Renders a chess position from a FEN into a grid of squares, with last-move
// highlight, a classification badge, coordinates, and optional click-to-move.
import { CLASSES } from "./review.js";

const GLYPH = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };

export function renderBoard(el, fen, opts = {}) {
  const { flip = false, lastMove = null, badge = null, selected = null, targets = [], onSquareClick = null } = opts;
  const rowsFen = fen.split(" ")[0].split("/");
  const grid = rowsFen.map((fr) => {
    const arr = [];
    for (const ch of fr) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) arr.push(null);
      else arr.push(ch);
    }
    return arr;
  });

  el.innerHTML = "";
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const rr = flip ? 7 - dr : dr; // 0 = rank 8
      const cc = flip ? 7 - dc : dc; // 0 = file a
      const rankNum = 8 - rr;
      const file = "abcdefgh"[cc];
      const name = file + rankNum;
      const piece = grid[rr][cc];
      const light = (rr + cc) % 2 === 0;

      const sq = document.createElement("div");
      sq.className = "sq " + (light ? "l" : "d");
      sq.dataset.sq = name;
      if (lastMove && (name === lastMove.from || name === lastMove.to)) sq.classList.add("hl");
      if (selected === name) sq.classList.add("sel");

      if (piece) {
        const pc = document.createElement("div");
        pc.className = "pc " + (piece === piece.toUpperCase() ? "w" : "b");
        pc.textContent = GLYPH[piece.toLowerCase()];
        sq.appendChild(pc);
      }
      if (targets.includes(name)) {
        const dot = document.createElement("div");
        dot.className = "target" + (piece ? " cap" : "");
        sq.appendChild(dot);
      }
      if (badge && name === badge.square) {
        const b = document.createElement("div");
        b.className = "badge";
        b.style.background = "var(" + CLASSES[badge.cls].v + ")";
        b.textContent = CLASSES[badge.cls].g;
        sq.appendChild(b);
      }
      if (dc === 0) {
        const c = document.createElement("div");
        c.className = "coord r"; c.textContent = rankNum; sq.appendChild(c);
      }
      if (dr === 7) {
        const c = document.createElement("div");
        c.className = "coord f"; c.textContent = file; sq.appendChild(c);
      }
      if (onSquareClick) sq.addEventListener("click", () => onSquareClick(name));
      el.appendChild(sq);
    }
  }
}
