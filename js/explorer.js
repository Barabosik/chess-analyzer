// Human move statistics for the position on the board, from Lichess's free,
// key-less, CORS-open databases. Two sources, chosen by how many pieces are left:
//
//   > 7 pieces  → the opening explorer: "at your rating, N% play this here", the one
//                 thing the engine can't tell you (it knows the best move, not the
//                 popular one, and not how each scores for humans).
//   <= 7 pieces → the endgame tablebase: perfect play, win/draw/loss and the exact
//                 distance, computed not searched — so it is never wrong.
//
// This is a pure client: it fetches and normalises, it touches no DOM. Every call can
// throw (offline, rate-limited); the caller degrades to hiding the panel.

const EXPLORER = "https://explorer.lichess.ovh/lichess";
const TABLEBASE = "https://tablebase.lichess.ovh/standard";

// Pieces on the board — the FEN's first field, letters only.
export function pieceCount(fen) {
  let n = 0;
  for (const ch of fen.split(" ")[0]) if (/[pnbrqk]/i.test(ch)) n++;
  return n;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("explorer HTTP " + res.status);
  return res.json();
}

// The result the API reports for a move is from the POINT OF VIEW OF THE PLAYER TO
// MOVE AFTER IT — i.e. the opponent — so a move that leaves the opponent "loss" is a
// win for the mover. Flip it back to the mover's POV for display.
const FLIP = {
  win: "loss", loss: "win", draw: "draw",
  "cursed-win": "blessed-loss", "blessed-loss": "cursed-win",
  "maybe-win": "maybe-loss", "maybe-loss": "maybe-win", unknown: "unknown",
};

function normalizeTablebase(d) {
  const moves = (d.moves || []).slice(0, 4).map((m) => ({
    san: m.san, uci: m.uci,
    // m.category is the resulting position's side-to-move (the opponent): flip it.
    result: FLIP[m.category] || m.category,
    dtz: m.dtz, dtm: m.dtm, zeroing: m.zeroing,
  }));
  return {
    kind: "tablebase",
    // d.category is already from the side-to-move's POV — the verdict for whoever is on move.
    category: d.checkmate ? "loss" : d.stalemate ? "draw" : d.category,
    dtz: d.dtz, dtm: d.dtm, checkmate: !!d.checkmate, stalemate: !!d.stalemate,
    moves,
  };
}

function normalizeExplorer(d) {
  const total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
  const moves = (d.moves || []).map((m) => {
    const t = (m.white || 0) + (m.draws || 0) + (m.black || 0);
    return {
      san: m.san, uci: m.uci, total: t,
      // share of games in THIS position that continued with this move
      share: total ? t / total : 0,
      // how those games finished, as fractions of this move's games
      white: t ? m.white / t : 0,
      draws: t ? m.draws / t : 0,
      black: t ? m.black / t : 0,
      avgRating: m.averageRating || null,
    };
  });
  return { kind: "explorer", total, opening: d.opening || null, moves };
}

// Look up the position. `ratings` / `speeds` are comma lists of Lichess buckets.
export async function lookupPosition(fen, { ratings = "1600,1800,2000", speeds = "blitz,rapid,classical" } = {}) {
  if (pieceCount(fen) <= 7) {
    return normalizeTablebase(await getJson(TABLEBASE + "?fen=" + encodeURIComponent(fen)));
  }
  const url = EXPLORER + "?variant=standard&fen=" + encodeURIComponent(fen) +
    "&speeds=" + encodeURIComponent(speeds) + "&ratings=" + encodeURIComponent(ratings) +
    "&moves=10&topGames=0&recentGames=0";
  return normalizeExplorer(await getJson(url));
}

// The rating bands offered in the panel. The API's buckets are fixed (0,1000,1200,
// 1400,1600,1800,2000,2200,2500), so each band is a subset of them.
export const RATING_BANDS = [
  { id: "beginner", label: "≤1400", ratings: "1000,1200,1400" },
  { id: "club", label: "1600–2000", ratings: "1600,1800,2000" },
  { id: "master", label: "2200+", ratings: "2200,2500" },
];
