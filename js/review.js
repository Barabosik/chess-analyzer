// Full-game review: runs the engine over every position, classifies each move,
// and estimates per-side accuracy. Scores throughout are White's POV.
import { Chess } from "../vendor/chess.js?v=34";
import { OPENINGS } from "../vendor/openings.js?v=34";
import { explainMove } from "./motifs.js?v=34";

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

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

// A move within this many centipawns of the engine's own choice is, in engine
// terms, just as good — so it earns "Best" even if the engine would have played
// something else. Measured on real games: 0cp promotes 37 moves the engine rates
// exactly equal, 10cp promotes 78 (13%), 50cp would promote 35% and make the
// label meaningless.
const BEST_TOL_CP = 10;

// A Brilliant must hand over at least this much material on net, having offered a
// piece (>= 3 points) to do it. See the sacrifice test for why both halves matter.
const SAC_MIN_GIVEN = 1;
// ...and the sacrifice must be SOUND, not merely made from a winning position.
// Requiring the mover to be +0.80 up afterwards (as this used to) throws out every
// sacrifice that just keeps the balance — including the commonest brilliancy there
// is, a bishop for two pawns, which left the sample game at +0.08. Requiring only
// that you are not worse afterwards keeps those, while still rejecting desperation
// sacs from lost positions. The cap on the eval BEFORE the move stops a player who
// is already crushing from earning Brilliants for throwing away spare material.
const SAC_MIN_EVAL_AFTER = 0;      // still sound after the sacrifice
const SAC_MAX_EVAL_BEFORE = 300;   // and not already completely winning
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

// Static exchange evaluation: how much material the side to move can win by
// capturing on `square`, if both sides keep recapturing with their cheapest
// attacker and either may stop when the exchange turns bad.
//
// This replaces asking the engine "what would you reply?" to detect a sacrifice.
// That question is the wrong one twice over: the engine's reply may simply
// collect material that was ALREADY hanging before the move (a quiet pawn move
// like h3 was being called a sacrifice), and its choice of reply is not stable
// between runs at the same depth, so the same game could be reviewed twice and
// report different Brilliants. SEE only looks at the position, so it is exact
// and gives the same answer every time.
const SEE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };   // king captures last

export function seeGain(fen, square) {
  const c = new Chess(fen);
  const caps = c.moves({ verbose: true }).filter((m) => m.to === square && m.captured);
  if (!caps.length) return 0;
  caps.sort((a, b) => SEE_VAL[a.piece] - SEE_VAL[b.piece]);   // cheapest attacker first
  const m = caps[0];
  const c2 = new Chess(fen);
  c2.move({ from: m.from, to: m.to, promotion: m.promotion });
  // taking is optional, so a losing exchange is simply declined
  return Math.max(0, VAL[m.captured] - seeGain(c2.fen(), square));
}
export function accuracy(losses) {
  if (!losses.length) return 100;
  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avg) - 3.1669));
}

// A rough game-rating estimate from the same mean loss that accuracy uses.
//
// Be clear-eyed about what this is: measured against 64 real games, NO mapping from
// single-game play quality to Elo gets closer than ~850 points on average — a quiet
// game reads too strong and a sharp one too weak, whoever is playing (see
// docs/NOTES.md). It was removed for exactly that reason, and re-added by request as
// a labelled estimate. The curve is chosen, not fitted: monotone in mean loss, and
// unlike the old one it does not saturate at 2100 — near-perfect play reads 2800+,
// mean loss ~4%/move reads ~1650, ~8 reads ~900.
//
// Now returned as a BAND, not a lone number, because a lone number reads as a verdict
// the data can't support. The band is the game's OWN spread mapped through the curve:
// the standard error of its mean loss (std / sqrt(n)), so a game of consistent small
// errors gives a tight band and an erratic one a wide band. A width floor keeps even a
// flawless-looking game from reading as a point estimate. This uses no external corpus
// — the centre is deliberately left where it is (there is nothing to re-fit it against),
// so the honest lever is showing uncertainty, not pretending to a lower number.
// null under 8 judged moves, where even this is too much to claim.
const eloCurve = (loss) => 3150 * Math.exp(-0.155 * Math.max(0, loss));
export function estimateElo(losses) {
  if (losses.length < 8) return null;
  const n = losses.length;
  const avg = losses.reduce((a, b) => a + b, 0) / n;
  const variance = losses.reduce((a, b) => a + (b - avg) * (b - avg), 0) / n;
  const se = Math.sqrt(variance / n);          // standard error of the mean loss
  const clamp = (x) => Math.max(250, Math.min(3200, x));
  const r50 = (x) => Math.round(clamp(x) / 50) * 50;
  const elo = eloCurve(avg);
  // More loss -> lower Elo, so the +se edge is the LOW end. Floor the half-width at
  // 200 Elo: one game maps to a band several hundred wide however clean it looks.
  const HALF = 200;
  const lo = Math.min(eloCurve(avg + se), elo - HALF);
  const hi = Math.max(eloCurve(avg - se), elo + HALF);
  return { elo: r50(elo), lo: r50(lo), hi: r50(hi) };
}

// Non-pawn material on the board, both sides: 62 at the start, 0 in a pawn endgame.
// Kings and pawns are excluded because neither ever leaves.
export function nonPawnMaterial(fen) {
  let t = 0;
  for (const ch of fen.split(" ")[0]) {
    const p = ch.toLowerCase();
    if (p === "n" || p === "b") t += 3;
    else if (p === "r") t += 5;
    else if (p === "q") t += 9;
  }
  return t;
}

// Which third of the game a move belongs to, for the accuracy breakdown.
//
// This is a PRESENTATION heuristic, not a claim about chess: it exists so the app can
// say "you leak eval in the middlegame", and it is deliberately crude. The endgame is
// decided by material rather than by move number, because a queen trade on move 14
// really does produce an endgame. The opening runs as long as theory did — floored at
// ply 12 so a game that leaves book on move 2 still has an opening to report, and
// capped at ply 24 so a deeply-booked game doesn't swallow the whole middlegame.
export const PHASE_ENDGAME_NPM = 20;   // of 62
export function phaseOf(fenBefore, ply, openingEndPly) {
  if (nonPawnMaterial(fenBefore) <= PHASE_ENDGAME_NPM) return "endgame";
  return ply <= openingEndPly ? "opening" : "middlegame";
}

// moves: [{san, from, to, uci, color, fenBefore, fenAfter, moveNo}]
// Returns { moves:[...with cpWhite, loss, cls, bestSan], accWhite, accBlack, counts }
export async function reviewGame(engine, moves, startFen, opts = {}) {
  const depth = opts.depth || 14;
  const bookPlies = opts.bookPlies || 10;
  const onProgress = opts.onProgress || (() => {});
  const signal = opts.signal || {};

  // One engine, or a pool of them. A review is ~100 INDEPENDENT positions, so it is
  // embarrassingly parallel: give each engine a slice and they never touch each other.
  //
  // Note this is the opposite of asking one engine for Threads=8. That is Lazy SMP —
  // eight threads piling onto the same short search, thrashing one shared hash table —
  // and it measured 5-6x SLOWER than a single thread here, as well as non-deterministic.
  // Separate engines on separate positions share nothing, so they just scale. (Measured:
  // 12.5s -> 2.6s on six. See docs/NOTES.md.)
  const engines = Array.isArray(engine) ? engine : [engine];

  // Start every engine from a clean transposition table, so a review depends only on the
  // game being reviewed. Otherwise the same game scores differently depending on what was
  // analysed before it, and labels flip around the class boundaries.
  for (const e of engines) if (e.newGame) await e.newGame();

  // Analyse every node once (positions before each move + the final position).
  const fens = moves.map((m) => m.fenBefore);
  fens.push(moves.length ? moves[moves.length - 1].fenAfter : startFen);

  const node = new Array(fens.length);
  const todo = [];
  let done = 0;
  for (let i = 0; i < fens.length; i++) {
    const term = terminalNode(fens[i]);   // checkmate / stalemate: the rules decide, not the engine
    if (term) { node[i] = term; onProgress(++done, fens.length); }
    else todo.push(i);
  }

  // The partition is STATIC — engine k takes every Nth position, always. A dynamic work
  // queue (whoever is free takes the next one) would be marginally faster and would let
  // TIMING decide which engine searches which position. Each engine holds its own hash,
  // so that would make the evaluations depend on the scheduler, and the same game would
  // review differently twice: exactly the irreproducibility this file already fought once.
  const N = engines.length;
  await Promise.all(engines.map(async (e, k) => {
    for (let j = k; j < todo.length; j += N) {
      if (signal.cancelled) return;
      const i = todo[j];
      const wantMulti = i < moves.length ? 2 : 1; // second-best only needed before a move
      // Clear the hash before EVERY position, not just once per review.
      //
      // This looks like a pure cost and is actually a correctness fix. Position i+1 is
      // position i plus one move, so its subtree was ALREADY searched as part of
      // position i's search. Carrying the hash across therefore hands the "after"
      // position an effectively deeper search than the "before" position it is
      // compared against — and `loss` is the difference between exactly those two. The
      // old sequential review had that bias baked in.
      //
      // Clearing per position also makes the answer independent of WHO searched it and
      // in WHAT ORDER, which is what lets the pool return bit-identical results whether
      // it runs on one engine or eight. Reproducibility stops depending on the schedule.
      if (e.newGame) await e.newGame();
      node[i] = await e.analyse(fens[i], { depth, multipv: wantMulti });
      onProgress(++done, fens.length);
    }
  }));
  if (signal.cancelled) return null;

  const out = [];
  const counts = { w: {}, b: {} };
  for (const k of CLASS_ORDER) { counts.w[k] = 0; counts.b[k] = 0; }
  // One row per move, carrying the RAW (unrounded) loss, so accuracy overall and
  // accuracy per phase are computed from the same numbers.
  const rows = [];

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

  // The opening phase runs as long as theory did, floored and capped — see phaseOf.
  const openingEnd = Math.min(24, Math.max(bookEnd, 12));

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

    const bestUci = before.best ? before.best.move : before.bestmove;

    // "Best" used to demand an EXACT match with the engine's move, so a move the
    // engine rates identically but plays differently got demoted to Excellent —
    // 6% of all moves in a real sample. Judge by evaluation instead: a move within
    // a tenth of a pawn of the engine's own is, in engine terms, just as good.
    // (Moves that ARE the engine's move measure a median 1cp of loss here, so the
    // tolerance sits comfortably inside the search noise.)
    const sign = whiteMove ? 1 : -1;
    const cpLoss = sign * evalWhite(before.best) - sign * evalWhite(after.best);
    const isBest = (!!bestUci && bestUci === mv.uci) || cpLoss <= BEST_TOL_CP;

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

    // Sacrifice: the move must OFFER material — after it, the opponent can win at
    // least a couple of points by taking on the square just played to, and the
    // exchange there does not win it back. Two earlier attempts at this were both
    // wrong on real games: counting only the mover's own material called an
    // ordinary recapture a sacrifice (67% of Brilliants were plain trades), and
    // trusting the engine's best reply blamed a quiet move for material that was
    // already hanging before it.
    const cBefore = new Chess(mv.fenBefore);
    const matBefore = material(cBefore, mv.color);
    const taken = cBefore.get(mv.to);                           // what this move captured
    const winBack = seeGain(mv.fenAfter, mv.to);                // what the opponent wins back there
    const offered = new Chess(mv.fenAfter).get(mv.to);          // the piece now standing there
    // Net material handed over. Netting off the capture is essential: queen takes
    // queen and is recaptured gives up nothing, though the exchange on that square
    // still "wins" a queen for the opponent.
    const given = winBack - (taken ? VAL[taken.type] : 0);
    // A sacrifice offers a PIECE and ends up down on the deal. Requiring 2+ points
    // of loss instead would reject the commonest brilliancy there is — a bishop for
    // two pawns (Bxh6!) nets only 1 — while allowing any 1-point loss would promote
    // ordinary pawn sacs. Offering a piece is what makes it a sacrifice; how much
    // is left on the table afterwards only has to be more than nothing.
    const sac = offered && VAL[offered.type] >= 3 && given >= SAC_MIN_GIVEN;
    const evalAfterMover = whiteMove ? evalWhite(after.best) : -evalWhite(after.best);
    const evalBeforeMover = whiteMove ? evalWhite(before.best) : -evalWhite(before.best);

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

    // Book moves are theory, not YOUR play. Counting a memorised move as a 0%-loss
    // move of your own inflates accuracy — the more theory you happen to know, the
    // better your "accuracy" looks without you having found anything over the board.
    // They are excluded from every accuracy number below; they still show as Book in
    // the counts. (Measured on real games: see docs/NOTES.md.)
    const phase = phaseOf(mv.fenBefore, i + 1, openingEnd);
    rows.push({ color: mv.color, loss, book: !!bookEntry, phase });

    let cls;
    if (bookEntry) cls = "book";
    else if (sac && loss < 3 && matBefore > 3 &&
             evalAfterMover >= SAC_MIN_EVAL_AFTER && evalAfterMover < 9000 &&
             evalBeforeMover <= SAC_MAX_EVAL_BEFORE) cls = "brilliant";
    else if (isBest && gap != null && gap >= 12 && loss < 2) cls = "great";
    else if (isBest) cls = "best";
    else if (loss < 2) cls = "excellent";
    else if (loss < 5) cls = "good";
    else if (loss < 10) cls = "inaccuracy";
    else if (loss < 20) cls = "mistake";
    else cls = "blunder";
    counts[mv.color][cls]++;

    // Name WHY a move went wrong (hung piece, fork, allowed mate, missed
    // material...). Decided statically from the position -- see js/motifs.js.
    const motif = explainMove({ ...mv, cls }, before, after);

    // For the rare good moves, keep what makes them explainable: the engine's line
    // FROM AFTER the move (the follow-up that shows why the sacrifice works, or why
    // the only-move holds), the piece a brilliancy offered, and the gap to the
    // second-best move. A bad move explains itself with the line it should have
    // played (bestLine); a brilliant one explains itself with what happens next.
    const celebrated = cls === "brilliant" || cls === "great";
    const afterLine = celebrated && after.best && after.best.pv && after.best.pv.length
      ? after.best.pv : null;

    out.push({
      ...mv,
      phase,
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
      // the engine's principal variation from before the move (UCI), so "Explain"
      // can walk the best line move by move
      bestLine: bookEntry || !before.best ? null : (before.best.pv || null),
      showBetter: !bookEntry && (cls === "inaccuracy" || cls === "mistake" || cls === "blunder"),
      motif: bookEntry ? null : motif,
      afterLine,
      sacPiece: cls === "brilliant" && offered ? offered.type : null,
      sacGiven: cls === "brilliant" ? given : null,
      onlyGap: cls === "great" && gap != null ? Math.round(gap) : null,
      // only positions the book actually names carry an opening name; bridged
      // plies are theory without a name of their own
      opening: named[i] ? named[i][1] : null,
    });
  }

  // Accuracy, over the moves the player actually had to find (book excluded).
  const r1 = (n) => Math.round(n * 10) / 10;
  const accOf = (color, phase) => {
    const ls = rows.filter((r) => r.color === color && !r.book && (!phase || r.phase === phase))
      .map((r) => r.loss);
    return ls.length ? { acc: r1(accuracy(ls)), n: ls.length } : null;   // null = nothing to judge
  };

  const phases = {};
  for (const ph of ["opening", "middlegame", "endgame"]) phases[ph] = { w: accOf("w", ph), b: accOf("b", ph) };

  const lossesOf = (color) =>
    rows.filter((r) => r.color === color && !r.book).map((r) => r.loss);

  return {
    moves: out,
    accWhite: (accOf("w") || { acc: 100 }).acc,
    accBlack: (accOf("b") || { acc: 100 }).acc,
    // Accuracy split by game phase, so the report can say WHERE the play leaks.
    // Each entry is { acc, n } or null when the side had no non-book move there.
    phases,
    // Rough per-side game-rating estimate (or null). See estimateElo for the caveats.
    est: { w: estimateElo(lossesOf("w")), b: estimateElo(lossesOf("b")) },
    counts,
    opening,
  };
}
