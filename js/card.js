// The shareable report card: one PNG that says how the game went.
//
// Deliberately NOT a screenshot of the page. A screenshot is the wrong shape, carries
// the user's theme, and shows chrome nobody wants to post. This draws a fixed 1200x630
// card (the ratio every site previews links at) in the dark palette, so a card looks the
// same whoever made it.
import { CLASSES, CLASS_ORDER, winPct, MATE_CP } from "./review.js?v=28";

const W = 1200, H = 630, PAD = 40;

// Fixed chrome. The class colours are read from the stylesheet (they are the same in
// both themes), but the background must not be, or a light-theme user would post a
// white card and a dark-theme user a black one.
const BG = "#0f1216", PANEL = "#171b21", INK = "#e6e9ee",
      MUTED = "#98a1ad", LINE = "#2a303a", ACCENT = "#e8c96a";

const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Win probability for White, per ply, starting from the initial position.
function winTrack(moves) {
  const wp = [50];
  for (const m of moves) {
    if (m.mateWhite != null) wp.push(m.mateWhite > 0 ? 100 : 0);
    else if (Math.abs(m.cpWhite || 0) >= MATE_CP) wp.push(m.cpWhite > 0 ? 100 : 0);
    else wp.push(winPct(m.cpWhite || 0));
  }
  return wp;
}

// The eval graph, drawn the way chess sites do it: the area UNDER the curve is White's
// share of the position, so a card where the bottom is mostly pale is a game White won.
function drawGraph(c, moves, x, y, w, h) {
  const wp = winTrack(moves);
  const px = (i) => x + (wp.length < 2 ? 0 : (i / (wp.length - 1)) * w);
  const py = (v) => y + (1 - v / 100) * h;

  c.fillStyle = "#0b0e12";
  roundRect(c, x, y, w, h, 8); c.fill();

  c.save();
  roundRect(c, x, y, w, h, 8); c.clip();

  c.beginPath();
  c.moveTo(px(0), py(wp[0]));
  for (let i = 1; i < wp.length; i++) c.lineTo(px(i), py(wp[i]));
  c.lineTo(px(wp.length - 1), y + h);
  c.lineTo(px(0), y + h);
  c.closePath();
  c.fillStyle = "#e8eaee";
  c.fill();

  // the 50% line: above it Black is better, below it White is
  c.strokeStyle = "rgba(152,161,173,.45)";
  c.setLineDash([5, 5]); c.lineWidth = 1;
  c.beginPath(); c.moveTo(x, py(50)); c.lineTo(x + w, py(50)); c.stroke();
  c.setLineDash([]);

  // mark where the game actually turned
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.cls !== "blunder" && m.cls !== "mistake") continue;
    c.fillStyle = cssVar(CLASSES[m.cls].v);
    c.beginPath(); c.arc(px(i + 1), py(wp[i + 1]), m.cls === "blunder" ? 5 : 4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#0b0e12"; c.lineWidth = 1.5; c.stroke();
  }
  c.restore();
}

export function drawCard(canvas, { headers = {}, moves = [], review = {}, scale = 2 }) {
  canvas.width = W * scale; canvas.height = H * scale;
  const c = canvas.getContext("2d");
  c.setTransform(scale, 0, 0, scale, 0, 0);

  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  c.fillStyle = PANEL;
  roundRect(c, PAD / 2, PAD / 2, W - PAD, H - PAD, 18); c.fill();
  c.strokeStyle = LINE; c.lineWidth = 1; c.stroke();

  const L = PAD + 16, R = W - PAD - 16;

  // --- header ---
  c.textBaseline = "alphabetic";
  c.fillStyle = MUTED; c.font = "600 16px ui-sans-serif,system-ui,sans-serif";
  c.textAlign = "left";  c.fillText("♞  Chess Game Analyzer", L, 66);
  c.textAlign = "right"; c.fillText("Stockfish 18 · in your browser", R, 66);

  // --- players and accuracy ---
  const white = headers.White || "White", black = headers.Black || "Black";
  const trim = (s) => (s.length > 18 ? s.slice(0, 17) + "…" : s);

  const side = (name, acc, x, align) => {
    c.textAlign = align;
    c.fillStyle = INK; c.font = "700 26px ui-sans-serif,system-ui,sans-serif";
    c.fillText(trim(name), x, 126);
    c.fillStyle = ACCENT;
    c.font = "700 62px ui-monospace,SFMono-Regular,Menlo,monospace";
    c.fillText((acc == null ? "–" : acc) + "%", x, 192);
    c.fillStyle = MUTED; c.font = "600 12px ui-sans-serif,system-ui,sans-serif";
    c.fillText("ACCURACY", x, 214);
  };
  side(white, review.accWhite, L, "left");
  side(black, review.accBlack, R, "right");

  // result + opening, down the middle
  c.textAlign = "center";
  const result = headers.Result && headers.Result !== "*" ? headers.Result : "–";
  c.fillStyle = INK; c.font = "700 30px ui-monospace,SFMono-Regular,Menlo,monospace";
  c.fillText(result, W / 2, 150);
  if (review.opening) {
    c.fillStyle = ACCENT; c.font = "600 14px ui-sans-serif,system-ui,sans-serif";
    // Cut to a word, not mid-name: a bare slice leaves "…Scotch Variation Accepted,"
    // with a dangling comma, which looks like a bug rather than a long opening.
    let name = String(review.opening[1] || review.opening);
    if (name.length > 52) name = name.slice(0, 52).replace(/[\s,:;-]+\S*$/, "") + "…";
    c.fillText(name, W / 2, 196);
  }

  // --- the game's shape ---
  drawGraph(c, moves, L, 236, R - L, 132);

  // --- accuracy by phase: where the play actually leaked ---
  const P = review.phases || {};
  const phases = ["opening", "middlegame", "endgame"].filter((p) => P[p] && (P[p].w || P[p].b));
  let y = 402;
  c.textAlign = "left";
  // Each phase (and each move chip) shows White then Black. Say so HERE, next to the
  // numbers, rather than in a legend stranded in the corner of the card.
  c.fillStyle = MUTED; c.font = "600 12px ui-sans-serif,system-ui,sans-serif";
  c.fillText("ACCURACY BY PHASE  ·  WHITE / BLACK", L, y);
  y += 22;
  const colW = (R - L) / 3;
  phases.forEach((p, i) => {
    const x = L + i * colW;
    c.textAlign = "left";
    c.fillStyle = MUTED; c.font = "500 13px ui-sans-serif,system-ui,sans-serif";
    c.fillText(p[0].toUpperCase() + p.slice(1), x, y);
    c.fillStyle = INK; c.font = "700 20px ui-monospace,SFMono-Regular,Menlo,monospace";
    const f = (v) => (v ? v.acc + "%" : "–");
    c.fillText(f(P[p].w), x, y + 28);
    c.fillStyle = MUTED; c.font = "700 20px ui-monospace,SFMono-Regular,Menlo,monospace";
    c.fillText(f(P[p].b), x + 82, y + 28);
  });

  // --- move breakdown, as the badges the app already uses ---
  const counts = review.counts || { w: {}, b: {} };
  const shown = CLASS_ORDER.filter((k) => (counts.w[k] || 0) + (counts.b[k] || 0) > 0);
  y = 500;
  c.textAlign = "left";
  c.fillStyle = MUTED; c.font = "600 12px ui-sans-serif,system-ui,sans-serif";
  c.fillText("MOVES  ·  WHITE / BLACK", L, y);

  y += 20;
  let x = L;
  for (const k of shown) {
    const w = counts.w[k] || 0, b = counts.b[k] || 0;
    const label = w + "/" + b;
    c.font = "700 15px ui-monospace,SFMono-Regular,Menlo,monospace";
    const tw = c.measureText(label).width;
    const chipW = 30 + tw + 16;
    if (x + chipW > R) break;                 // never spill off the card

    c.fillStyle = cssVar(CLASSES[k].v);
    roundRect(c, x, y, 24, 24, 6); c.fill();
    c.fillStyle = "#fff";
    c.font = "800 12px ui-monospace,SFMono-Regular,Menlo,monospace";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(CLASSES[k].g, x + 12, y + 13);

    c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.fillStyle = INK; c.font = "700 15px ui-monospace,SFMono-Regular,Menlo,monospace";
    c.fillText(label, x + 30, y + 18);
    x += chipW;
  }

  // --- footer ---
  c.textAlign = "left"; c.fillStyle = MUTED;
  c.font = "500 13px ui-sans-serif,system-ui,sans-serif";
  c.fillText("barabosik.github.io/chess-analyzer", L, H - 40);
  c.textAlign = "right";
  c.fillText(moves.length ? Math.ceil(moves.length / 2) + " moves" : "", R, H - 40);

  return canvas;
}

export const cardName = (headers = {}) =>
  ((headers.White || "white") + "-vs-" + (headers.Black || "black"))
    .replace(/[^a-z0-9-]+/gi, "-").toLowerCase().slice(0, 60) + ".png";
