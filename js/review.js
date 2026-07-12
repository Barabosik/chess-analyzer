// Full-game review: runs the engine over every position, classifies each move,
// and estimates per-side accuracy. Scores throughout are White's POV.
import { Chess } from "../vendor/chess.js?v=10";
import { OPENINGS } from "../vendor/openings.js?v=10";

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// A position is "book" when it appears in the opening database (real theory),
// rather than guessing by move number.
export function bookLookup(fen) {
  const p = fen.split(" ");
  return OPENINGS[p[0] + " " + p[1]] || null;
}

// Book-phase tuning. Measured over 947 real games: 42% of them reach a named
// position again after leaving the book's named path, and 64% of those holes are
// exactly 2 plies (79% are 3 or fewer) — those are gaps in a sparse book, not
// departures from theory. Long silences are real departures, and the later named
// position is a coincidental transposition.
const BOOK_MAX_PLY = 30;    // theory never runs longer than this
const BOOK_MAX_GAP = 4;     // unnamed plies we will bridge (covers 85% of holes)
const BOOK_MAX_LOSS = 5;    // a move that costs this much win% is not theory
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

// A position with no legal moves has no engine evaluation: Stockfish answers
// "bestmove (none)" with no principal variation, so `best` comes back null and
// the position reads as a dead-equal 0.00. For stalemate that happens to be
// right (a draw IS 0.00). For CHECKMATE it is badly wrong: the mating move looks
// like it threw the game away, and the mater's accuracy collapses (delivering
// Scholar's mate scored 51%). So decide terminal positions ourselves rather than
// asking the engine — which also saves a search.
export const MATE_CP = 100000;   // "won outright", saturates winPct to 100 / 0

function terminalNode(fen) {
  const c = new Chess(fen);
  if (!c.isGameOver()) return null;
  const stm = fen.split(" ")[1] === "b" ? "b" : "w";
  const best = c.isCheckmate()
    // the side to move is the one being mated, so the other side just won
    ? { cp: stm === "b" ? MATE_CP : -MATE_CP, mate: null }
    : { cp: 0, mate: null };                       // stalemate or another draw
  return { stm, bestmove: null, best, lines: [best] };
}

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
    const term = terminalNode(fens[i]);   // checkmate / stalemate: the rules decide, not the engine
    if (term) { node.push(term); onProgress(i + 1, fens.length); continue; }
    const wantMulti = i < moves.length ? 2 : 1; // second-best only needed before a move
    const r = await engine.analyse(fens[i], { depth, multipv: wantMulti });
    node.push(r);
    onProgress(i + 1, fens.length);
  }

  const out = [];
  const counts = { w: {}, b: {} };
  for (const k of CLASS_ORDER) { counts.w[k] = 0; counts.b[k] = 0; }
  const losses = { w: [], b: [] };

  // --- how far did the game actually stay in the opening book? ---
  // Being "in book" is a property of the PATH, not of a single position. Asking
  // only "is this position named?" strands isolated Book moves after non-book
  // ones (impossible in a real game) in ~40% of games, because a game that has
  // long left theory can still transpose onto a named square by coincidence.
  //
  // But the book names ~3.8k specific positions rather than every position in a
  // line — an unbroken chain of named positions only reaches ply 14 — so a short
  // unnamed stretch is a hole in the book, not a departure from theory. Two
  // thirds of those holes are exactly one move each side. So: bridge short holes,
  // and treat a long silence as the end of theory.
  const named = moves.map((m, i) => (i < BOOK_MAX_PLY ? bookLookup(m.fenAfter) : null));
  let bookEnd = 0;      // last ply still counted as theory
  for (let i = 0; i < named.length; i++) {
    if (!named[i]) continue;
    const ply = i + 1;
    if (ply - bookEnd - 1 > BOOK_MAX_GAP) break;   // too long a silence: theory ended here
    bookEnd = ply;
  }
  // The opening is named from the deepest named position the game reached, even
  // past bookEnd — reaching it by transposition still identifies the opening.
  let opening = null;
  for (let i = named.length - 1; i >= 0; i--) if (named[i]) { opening = named[i]; break; }

  let inBook = true;    // cleared for good the moment the game leaves theory

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

    // A move is theory only if the game is still inside the book phase AND the
    // move didn't actually cost anything. That second half matters: without it,
    // a blunder that lands on a named position would be labelled Book, which
    // hides it from the counts and suppresses its "better move" suggestion.
    // A costly move ENDS the book phase rather than merely skipping itself —
    // otherwise book moves could resume after it, which is the very thing this
    // is fixing. So book is always an unbroken prefix of the game.
    const bookEntry = inBook && i + 1 <= bookEnd && loss < BOOK_MAX_LOSS
      ? (named[i] || true) : null;
    if (!bookEntry) inBook = false;

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
      // only positions the book actually names carry an opening name; bridged
      // plies are theory without a name of their own
      opening: named[i] ? named[i][1] : null,
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
