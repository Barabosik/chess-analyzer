// A plain-English "what to work on" paragraph per side, built entirely from the review
// the app already computed: accuracy, the phase split, the classified moves with their
// motifs, and the clocks. No engine calls — pure synthesis, so it is deterministic and
// unit-testable. The shape is: how you did (with the opening), the one move the game
// turned on, the pattern behind your mistakes, and one actionable thing to drill.

const PHASE_NAME = { opening: "opening", middlegame: "middlegame", endgame: "endgame" };

// The dominant mistake type -> what to actually practise. Keyed on motif kind.
const ADVICE = {
  "hung-piece": "before you move, check that your own pieces are defended — most of your losses were hung material",
  "losing-exchange": "count the captures on a square before you take or trade there",
  "fork": "watch for enemy checks that hit a second piece at the same time — forks cost you here",
  "allowed-mate": "king safety — keep a flight square and don't strip the pawns in front of your king",
  "missed-material": "look for your OWN tactics too — you left the opponent's hanging pieces on the board",
  "missed-mate": "when you're winning, check for a forced mate before playing a quiet move",
};
const PHASE_ADVICE = {
  opening: "learn a few more moves of the openings you actually play",
  middlegame: "slow down and calculate one move deeper in sharp middlegame positions",
  endgame: "study basic endgames — that's where your accuracy fell off",
};
const MOTIF_LABEL = {
  "hung-piece": "left a piece undefended",
  "losing-exchange": "lost material in an exchange",
  "fork": "walked into a fork",
  "allowed-mate": "allowed a forced mate",
  "missed-material": "missed free material the opponent had hanging",
  "missed-mate": "missed a forced mate",
};

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const WRONG = { inaccuracy: 1, mistake: 1, blunder: 1 };

// The mistake type that dominates a side's costly moves (>= half of them, at least twice).
function dominantMotif(moves, color) {
  const mine = moves.filter((m) => m.color === color && m.motif);
  if (mine.length < 2) return null;
  const by = {};
  for (const m of mine) by[m.motif.kind] = (by[m.motif.kind] || 0) + 1;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  if (top[1] < 2 || top[1] / mine.length < 0.5) return null;
  return { kind: top[0], count: top[1], total: mine.length };
}

// The phase this side played worst, if it had enough moves there to mean anything.
function weakestPhase(phases, color) {
  if (!phases) return null;
  let worst = null;
  for (const ph of ["opening", "middlegame", "endgame"]) {
    const e = phases[ph] && phases[ph][color];
    if (!e || e.n < 3) continue;
    if (!worst || e.acc < worst.acc) worst = { phase: ph, acc: e.acc };
  }
  return worst;
}

// The single move that cost the most win probability (the game's turning point).
function turningPoint(moves, color) {
  const bad = moves.filter((m) => m.color === color &&
    (m.cls === "mistake" || m.cls === "blunder") && m.loss != null);
  if (!bad.length) return null;
  bad.sort((a, b) => b.loss - a.loss);
  return bad[0].loss >= 8 ? bad[0] : null;
}

// True when the side's errors got noticeably LESS thought than its good moves.
function rushedErrors(moves, color) {
  const mine = moves.filter((m) => m.color === color && m.spent != null && m.cls !== "book");
  const bad = mine.filter((m) => WRONG[m.cls]).map((m) => m.spent);
  const good = mine.filter((m) => !WRONG[m.cls]).map((m) => m.spent);
  if (bad.length < 3 || good.length < 5) return false;
  const mg = median(good);
  return mg > 0 && median(bad) / mg <= 0.6;
}

// Returns the advice paragraph for `color`, or null if there isn't enough game to judge.
export function gameSummary(color, { moves, review, opening, headers }) {
  if (!review || !moves) return null;
  const mine = moves.filter((m) => m.color === color);
  if (mine.length < 6) return null;

  const name = (color === "w" ? headers.White : headers.Black) || (color === "w" ? "White" : "Black");
  const acc = color === "w" ? review.accWhite : review.accBlack;
  const parts = [];

  // 1. how they did, framed by the opening they were in
  let lead = name + " played at " + acc + "%";
  const op = review.phases && review.phases.opening && review.phases.opening[color];
  if (opening && op && op.n >= 2) {
    lead += (op.acc >= 90 ? ", out of a clean " : ", out of a rough ") + opening[1] + " (" + op.acc + "%)";
  }
  parts.push(lead + ".");

  // 2. the turning point
  const tp = turningPoint(moves, color);
  if (tp) {
    const why = tp.motif && tp.motif.text ? " — " + tp.motif.text.replace(/\.$/, "") : " was the costly slip";
    parts.push("The game turned on move " + tp.moveNo + ": " + tp.san + why + ".");
  }

  // 3. the pattern (a dominant motif), else the weakest phase
  const dom = dominantMotif(moves, color);
  const wp = weakestPhase(review.phases, color);
  if (dom) parts.push(dom.count + " of " + dom.total + " costly moves " + MOTIF_LABEL[dom.kind] + ".");
  else if (wp && wp.acc < acc - 3) parts.push("Most of the damage was in the " + PHASE_NAME[wp.phase] + " (" + wp.acc + "%).");

  // 4. one thing to work on
  let advice = dom ? ADVICE[dom.kind] : (wp ? PHASE_ADVICE[wp.phase] : null);
  if (!advice && tp && tp.motif) advice = ADVICE[tp.motif.kind];
  if (advice) {
    if (rushedErrors(moves, color)) advice += ", and give the critical moves more time — your mistakes were your quick moves";
    parts.push("Work on: " + advice + ".");
  } else if (!tp) {
    parts.push("A clean game — no clear weakness to point at here. Keep it up.");
  }

  return parts.join(" ");
}
