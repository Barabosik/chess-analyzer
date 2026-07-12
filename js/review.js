// Full-game review: runs the engine over every position, classifies each move,
// and estimates per-side accuracy. Scores throughout are White's POV.
import { Chess } from "../vendor/chess.js?v=8";
import { OPENINGS } from "../vendor/openings.js?v=8";

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// A position is "book" when it appears in the opening database (real theory),
// rather than guessing by move number.
export function bookLookup(fen) {
  const p = fen.split(" ");
  return OPENINGS[p[0] + " " + p[1]] || null;
}
// The deepest named opening the game reached.
export function detectOpening(moves) {
  let last = null;
  for (let i = 0; i < moves.length && i < 30; i++) {
    const e = bookLookup(moves[i].fenAfter);
    if (e) last = e;
  }
  return last;
}

// Classification metadata (id -> glyph/label/colour var). Order = display order.
export const CLASSES = {
  brilliant:  { g: "!!", label: "Brilliant",  v: "--brilliant" },
  great:      { g: "!",  label: "Great move",  v: "--great" },
  best:       { g: "★", label: "Best move", v: "--best" },
  excellent:  { g: "✓", label: "Excellent",   v: "--excellent" },
  good:       { g: "•", label: "Good",     v: "--good" },
  book:       { g: "◇", label: "Book",     v: "--book" },
  inaccuracy: { g: "?!", label: "Inaccuracy",  v: "--inacc" },
  mistake:    { g: "?",  label: "Mistake",     v: "--mistake" },
  blunder:    { g: "??", label: "Blunder",     v: "--blunder" },
};
export const CLASS_ORDER = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder"];

export function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
function evalWhite(node) {
  if (!node) return 0;
  if (node.mate != null) return node.mate > 0 ? 10000 - node.mate * 10 : -10000 - node.mate * 10;
  return node.cp == null ? 0 : node.cp;
}
function wpWhite(node) {
  if (!node) return 50;
  if (node.mate != null) return node.mate > 0 ? 100 : 0;
  return winPct(node.cp == null ? 0 : node.cp);
}
function material(chess, color) {
  let sum = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.color === color) sum += VAL[sq.type];
    }
  }
  return sum;
}
export function accuracy(losses) {
  if (!losses.length) return 100;
  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avg) - 3.1669));
}

// moves: [{san, from, to, uci, color, fenBefore, fenAfter, moveNo}]
// Returns { moves:[...with cpWhite, loss, cls, bestSan], accWhite, accBlack, counts }
export async function reviewGame(engine, moves, startFen, opts = {}) {
  const depth = opts.depth || 14;
  const bookPlies = opts.bookPlies || 10;
  const onProgress = opts.onProgress || (() => {});
  const signal = opts.signal || {};

  // Analyse every node once (positions before each move + the final position).
  const fens = moves.map((m) => m.fenBefore);
  fens.push(moves.length ? moves[moves.length - 1].fenAfter : startFen);

  const node = [];
  for (let i = 0; i < fens.length; i++) {
    if (signal.cancelled) return null;
    const wantMulti = i < moves.length ? 2 : 1; // second-best only needed before a move
    const r = await engine.analyse(fens[i], { depth, multipv: wantMulti });
    node.push(r);
    onProgress(i + 1, fens.length);
  }

  const out = [];
  const counts = { w: {}, b: {} };
  for (const k of CLASS_ORDER) { counts.w[k] = 0; counts.b[k] = 0; }
  const losses = { w: [], b: [] };
  let opening = null;

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const whiteMove = mv.color === "w";
    const toMover = (wpWhiteVal) => (whiteMove ? wpWhiteVal : 100 - wpWhiteVal);

    const before = node[i];
    const after = node[i + 1];
    const wpBefore = toMover(wpWhite(before.best));
    const wpAfter = toMover(wpWhite(after.best));
    const loss = Math.max(0, wpBefore - wpAfter);
    losses[mv.color].push(loss);

    const bestUci = before.best ? before.best.move : before.bestmove;
    const isBest = bestUci && bestUci === mv.uci;
    let bestSan = null;
    if (bestUci) {
      const c = new Chess(mv.fenBefore);
      try {
        const m = c.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4, 5) || undefined });
        bestSan = m ? m.san : null;
      } catch (e) { bestSan = null; }
    }

    // Only-move gap: how much worse the 2nd line is (mover POV win%).
    let gap = null;
    if (before.lines && before.lines.length >= 2) {
      gap = toMover(wpWhite(before.lines[0])) - toMover(wpWhite(before.lines[1]));
    }

    // Sacrifice: mover's material after the opponent's best reply vs before the move.
    let sac = false;
    const cBefore = new Chess(mv.fenBefore);
    const matBefore = material(cBefore, mv.color);
    const reply = after.best ? after.best.move : after.bestmove;
    if (reply) {
      const cAfter = new Chess(mv.fenAfter);
      try {
        cAfter.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4, 5) || undefined });
        if (matBefore - material(cAfter, mv.color) >= 2) sac = true;
      } catch (e) { /* ignore */ }
    }
    const evalAfterMover = whiteMove ? evalWhite(after.best) : -evalWhite(after.best);

    const bookEntry = i < 30 ? bookLookup(mv.fenAfter) : null;
    if (bookEntry) opening = bookEntry;

    let cls;
    if (bookEntry) cls = "book";
    else if (sac && loss < 3 && evalAfterMover >= 80 && evalAfterMover < 9000 && matBefore > 3) cls = "brilliant";
    else if (isBest && gap != null && gap >= 12 && loss < 2) cls = "great";
    else if (isBest) cls = "best";
    else if (loss < 2) cls = "excellent";
    else if (loss < 5) cls = "good";
    else if (loss < 10) cls = "inaccuracy";
    else if (loss < 20) cls = "mistake";
    else cls = "blunder";
    counts[mv.color][cls]++;

    out.push({
      ...mv,
      cpWhite: evalWhite(after.best),
      mateWhite: after.best ? after.best.mate : null,
      loss: Math.round(loss * 10) / 10,
      cls,
      // Book moves are theory — there is no "better" move to suggest.
      bestSan: bookEntry ? null : bestSan,
      bestFrom: bookEntry || !bestUci ? null : bestUci.slice(0, 2),
      bestTo: bookEntry || !bestUci ? null : bestUci.slice(2, 4),
      bestPromo: bookEntry || !bestUci ? null : bestUci.slice(4, 5) || null,
      bestCpWhite: evalWhite(before.best),       // eval if the best move had been played
      bestMateWhite: before.best ? before.best.mate : null,
      showBetter: !bookEntry && (cls === "inaccuracy" || cls === "mistake" || cls === "blunder"),
      opening: bookEntry ? bookEntry[1] : null,
    });
  }

  return {
    moves: out,
    accWhite: Math.round(accuracy(losses.w) * 10) / 10,
    accBlack: Math.round(accuracy(losses.b) * 10) / 10,
    counts,
    opening,
  };
}
