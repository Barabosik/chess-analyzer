// Renders a chess position from a FEN into a grid of squares, with last-move
// highlight, a classification badge, coordinates, and optional click-to-move.
import { CLASSES } from "./review.js?v=18";

// cburnett SVG piece set (GPL). Path is relative to the HTML document base.
const PIECES = "vendor/pieces/cburnett/";

export function renderBoard(el, fen, opts = {}) {
  const { flip = false, lastMove = null, badge = null, hlClass = null, selected = null, targets = [], arrows = [],
    onSquareClick = null, onSquareDown = null } = opts;
  const stm = fen.split(" ")[1] || "w";
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
      if (lastMove && (name === lastMove.from || name === lastMove.to)) {
        sq.classList.add("hl");
        if (hlClass && CLASSES[hlClass]) {
          sq.classList.add("clshl");
          sq.style.setProperty("--hl-col", "var(" + CLASSES[hlClass].v + ")");
        }
      }
      if (selected === name) sq.classList.add("sel");

      if (piece) {
        const isWhite = piece === piece.toUpperCase();
        // Pieces of the side to move can be picked up and dragged.
        if (isWhite === (stm === "w")) sq.classList.add("grabbable");
        const pc = document.createElement("div");
        pc.className = "pc";
        pc.style.backgroundImage = "url('" + PIECES + (isWhite ? "w" : "b") + piece.toUpperCase() + ".svg')";
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
      if (onSquareDown) sq.addEventListener("pointerdown", (e) => onSquareDown(name, e));
      el.appendChild(sq);
    }
  }

  // Move arrows (drawn in board grid units; board is square so no distortion).
  if (arrows.length) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "arrows");
    svg.setAttribute("viewBox", "0 0 8 8");
    for (const a of arrows) {
      const f = sqCR(a.from, flip), t = sqCR(a.to, flip);
      const x1 = f.c + 0.5, y1 = f.r + 0.5, x2 = t.c + 0.5, y2 = t.r + 0.5;
      const col = a.color || "#f7b34c";
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = 0.4, halfW = 0.18, shaft = 0.15;
      const sx = x1 + Math.cos(ang) * 0.34, sy = y1 + Math.sin(ang) * 0.34;
      const tipx = x2 - Math.cos(ang) * 0.08, tipy = y2 - Math.sin(ang) * 0.08;
      const bx = tipx - Math.cos(ang) * head, by = tipy - Math.sin(ang) * head;
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", bx); line.setAttribute("y2", by);
      line.setAttribute("stroke", col); line.setAttribute("stroke-width", shaft);
      line.setAttribute("stroke-linecap", "round"); line.setAttribute("opacity", "0.9");
      svg.appendChild(line);
      const poly = document.createElementNS(NS, "polygon");
      const lx = bx + Math.cos(ang + Math.PI / 2) * halfW, ly = by + Math.sin(ang + Math.PI / 2) * halfW;
      const rx = bx - Math.cos(ang + Math.PI / 2) * halfW, ry = by - Math.sin(ang + Math.PI / 2) * halfW;
      poly.setAttribute("points", tipx + "," + tipy + " " + lx + "," + ly + " " + rx + "," + ry);
      poly.setAttribute("fill", col); poly.setAttribute("opacity", "0.9");
      svg.appendChild(poly);
    }
    el.appendChild(svg);
  }
}

function sqCR(square, flip) {
  const file = square.charCodeAt(0) - 97, rank = +square[1];
  return { c: flip ? 7 - file : file, r: flip ? rank - 1 : 8 - rank };
}
