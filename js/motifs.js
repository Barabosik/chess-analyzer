// Naming WHY a move was bad, from the position alone -- never from the engine's
// choice of reply. Asking the engine "what would you play back?" is Brilliant
// bug #2 in docs/NOTES.md: it blames a move for material that was already
// hanging (the quiet h3 was called a sacrifice), and its reply is not stable
// between runs. So every motif here is decided by static exchange evaluation
// (seeGain) plus board geometry -- exact, and identical on every run. The
// engine's SCORE is still used, to know a mistake happened and whether mate is
// forced; its move is not.
import { Chess, SQUARES } from "../vendor/chess.js?v=28";
import { seeGain, VAL } from "./review.js?v=28";

const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const BLAME = { inaccuracy: 1, mistake: 1, blunder: 1 };

// Flip only the side to move, to ask "what could the opponent win if it were
// THEIR turn in the position BEFORE the move?" -- the before/after comparison
// that stops us blaming a move for material that was already hanging.
function nullMove(fen) {
  const p = fen.split(" ");
  p[1] = p[1] === "w" ? "b" : "w";
  p[3] = "-";                 // an en-passant square from the other side is meaningless now
  return p.join(" ");
}

// Value of the piece the reviewed move captured (0 if it wasn't a capture), so
// an even recapture isn't mistaken for a hang.
function capturedValue(mv) {
  try { const p = new Chess(mv.fenBefore).get(mv.to); return p ? VAL[p.type] : 0; } catch (e) { return 0; }
}

function kingSquare(c, color) {
  for (const sq of SQUARES) {
    const p = c.get(sq);
    if (p && p.type === "k" && p.color === color) return sq;
  }
  return null;
}

// The most material the side to move can win by capturing, and where. Reuses
// the same SEE the classifier trusts for sacrifices.
function bestCapture(fen) {
  let c;
  try { c = new Chess(fen); } catch (e) { return null; }
  let caps;
  try { caps = c.moves({ verbose: true }).filter((m) => m.captured); } catch (e) { return null; }
  let best = null;
  const seen = new Set();
  for (const m of caps) {
    if (seen.has(m.to)) continue;
    seen.add(m.to);
    const gain = seeGain(fen, m.to);
    if (gain <= 0) continue;
    if (!best || gain > best.gain) {
      const cheapest = caps.filter((x) => x.to === m.to).sort((a, b) => VAL[a.piece] - VAL[b.piece])[0];
      best = { square: m.to, gain, victim: m.captured, move: cheapest };
    }
  }
  if (best) {
    const cc = new Chess(fen);
    const done = cc.move({ from: best.move.from, to: best.move.to, promotion: best.move.promotion });
    best.san = done ? done.san : null;
  }
  return best;
}

// What the opponent could already win in the position before the move. Returns
// null when that position would be illegal (the mover was in check, so the
// null-move is not a real position) -- in which case we can't prove the loss is
// new, and stay silent.
function winnableBefore(fenBefore, moverColor) {
  const nf = nullMove(fenBefore);
  let c;
  try { c = new Chess(nf); } catch (e) { return null; }
  const opp = moverColor === "w" ? "b" : "w";
  const kSq = kingSquare(c, moverColor);
  if (kSq && c.isAttacked(kSq, opp)) return null;   // mover's king in check with opp to move => illegal
  const bc = bestCapture(nf);
  return bc ? bc.gain : 0;
}

// mover-POV mate distance: + = the mover delivers mate, - = the mover is being
// mated, null = no forced mate. Engine scores are White's POV.
function moverMate(node, whiteMove) {
  const m = node && node.best ? node.best.mate : null;
  if (m == null) return null;
  return whiteMove ? m : -m;
}

function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    return m ? m.san : null;
  } catch (e) { return null; }
}

// A fork we can actually prove: an opponent reply that gives CHECK and, with the
// same piece, attacks a mover piece worth >= a knight that can't be saved (it is
// undefended, or worth more than the attacker so even a trade wins it) -- and
// the checking piece can't simply be captured. Requiring a check keeps this
// precise: the king must move, so the second piece falls.
export function detectFork(fenAfter, moverColor) {
  const opp = moverColor === "w" ? "b" : "w";
  let c;
  try { c = new Chess(fenAfter); } catch (e) { return null; }
  let replies;
  try { replies = c.moves({ verbose: true }); } catch (e) { return null; }
  for (const r of replies) {
    const c2 = new Chess(fenAfter);
    c2.move({ from: r.from, to: r.to, promotion: r.promotion });
    if (!c2.isCheck()) continue;
    const attackerVal = VAL[c2.get(r.to).type];
    // If the mover can just capture the checker with an equal-or-cheaper piece,
    // the check is parried at no loss and it isn't a fork. A queen check on a
    // diagonal that also "hits" the enemy queen is really a queen trade -- the
    // queen captures back (Qf7+?? met by Qxf7). This is the commonest fake fork.
    const takers = c2.moves({ verbose: true }).filter((m) => m.to === r.to && m.captured);
    if (takers.some((m) => VAL[m.piece] <= attackerVal)) continue;
    let bestVictim = null;
    for (const sq of SQUARES) {
      const pc = c2.get(sq);
      if (!pc || pc.color !== moverColor || pc.type === "k" || VAL[pc.type] < 3) continue;
      if (!c2.attackers(sq, opp).includes(r.to)) continue;   // attacked by the checking piece specifically
      const defended = c2.attackers(sq, moverColor).length > 0;
      if (!defended || VAL[pc.type] > attackerVal) {
        if (!bestVictim || VAL[pc.type] > VAL[bestVictim]) bestVictim = pc.type;
      }
    }
    if (bestVictim) return { san: r.san, victim: bestVictim };
  }
  return null;
}

// The opponent left material hanging and the move didn't take it. Requires BOTH
// that SEE proves the capture wins material AND that the engine's own best move
// IS that capture -- either test alone walks into a poisoned piece.
function detectMissed(mv, before) {
  const bestUci = before.best ? before.best.move : before.bestmove;
  if (!bestUci) return null;
  if (mv.uci && bestUci.slice(0, 4) === mv.uci.slice(0, 4)) return null;
  if (mv.san && mv.san.includes("x")) return null;   // you DID capture -> you didn't miss free material
  if (mv.cls === "inaccuracy") return null;          // real free material is a mistake/blunder, not a nudge
  const to = bestUci.slice(2, 4);
  let c;
  try { c = new Chess(mv.fenBefore); } catch (e) { return null; }
  const bm = c.moves({ verbose: true }).find((m) => m.from === bestUci.slice(0, 2) && m.to === to);
  if (!bm || !bm.captured) return null;
  const gain = seeGain(mv.fenBefore, to);
  if (gain < 2) return null;
  return { kind: "missed-material",
    text: "You missed free material — " + bm.san + " wins the " + NAME[bm.captured] + "." };
}

// The one entry point. Returns { kind, text } or null. Silent unless a motif can
// be proven from the position: a wrong reason is worse than none.
export function explainMove(mv, before, after) {
  if (!BLAME[mv.cls]) return null;
  const white = mv.color === "w";

  const mBefore = moverMate(before, white);
  const mAfter = moverMate(after, white);

  // allowed a forced mate (that wasn't already unavoidable)
  if (mAfter != null && mAfter < 0 && !(mBefore != null && mBefore < 0)) {
    return { kind: "allowed-mate", text: "This allows a forced mate in " + Math.abs(mAfter) + "." };
  }
  // had a forced mate and let it slip
  if (mBefore != null && mBefore > 0 && !(mAfter != null && mAfter > 0)) {
    const bestSan = uciToSan(mv.fenBefore, before.best ? before.best.move : before.bestmove);
    return { kind: "missed-mate",
      text: "You had a forced mate in " + mBefore + " here" + (bestSan ? " — " + bestSan + " starts it." : ".") };
  }
  // walked into a fork
  const fork = detectFork(mv.fenAfter, mv.color);
  if (fork) {
    return { kind: "fork",
      text: "This walks into a fork — " + fork.san + " hits your king and " + NAME[fork.victim] + " at once." };
  }
  // hung a piece / dropped material. The net matters: a move that captures a
  // knight and is recaptured on the same square gave up nothing (an even trade),
  // so credit what the move itself took. And a whole rook or queen never goes
  // for a mere "inaccuracy" -- if the engine only docked a little, the piece is
  // compensated, not free.
  const afterCap = bestCapture(mv.fenAfter);
  if (afterCap && afterCap.gain >= 2) {
    const before0 = winnableBefore(mv.fenBefore, mv.color);
    // A greedy grab is a capture that lands where it's then taken -- credit what
    // it won so an even trade isn't read as a loss. A piece simply left en prise
    // (the move captured nothing there) is a clean hang.
    const greedyGrab = afterCap.square === mv.to && capturedValue(mv) > 0;
    const netLoss = afterCap.gain - (greedyGrab ? capturedValue(mv) : 0);
    if (before0 != null && afterCap.gain > before0 && netLoss >= 2 &&
        !(netLoss >= 3 && mv.cls === "inaccuracy")) {
      const on = " on " + afterCap.square;
      // Word by how much was actually lost, net of anything the move grabbed:
      // a whole piece's worth is a hang, a couple of points is a bad exchange.
      if (netLoss >= 3 && VAL[afterCap.victim] >= 3) {
        const tail = afterCap.san ? " — " + afterCap.san + " wins it." : ".";
        return { kind: "hung-piece", text: "This hangs your " + NAME[afterCap.victim] + on + tail };
      }
      const tail = afterCap.san ? " — " + afterCap.san + " wins material." : ".";
      return { kind: "losing-exchange", text: "This drops material" + on + tail };
    }
  }
  // missed free material the opponent had hanging
  return detectMissed(mv, before);
}

const ROLLUP_LABEL = {
  "hung-piece": "left a piece undefended",
  "losing-exchange": "lost material in an exchange",
  "fork": "walked into a fork",
  "allowed-mate": "allowed a forced mate",
  "missed-material": "missed free material the opponent had hanging",
  "missed-mate": "missed a forced mate",
};

// One line per side, only when a single motif dominates that side's mistakes --
// the same grouping the cross-game report will need later. Silent when there is
// no clear pattern.
export function rollup(moves, color) {
  const mine = moves.filter((m) => m.color === color && m.motif);
  if (mine.length < 2) return null;
  const by = {};
  for (const m of mine) by[m.motif.kind] = (by[m.motif.kind] || 0) + 1;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  if (top[1] < 2 || top[1] / mine.length < 0.5) return null;
  return top[1] + " of " + mine.length + " costly moves " + ROLLUP_LABEL[top[0]] + ".";
}
