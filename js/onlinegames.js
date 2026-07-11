// Fetch a player's recent games straight from Chess.com or Lichess.
// Both expose public, key-less, CORS-enabled endpoints, so this runs from the
// browser with no server and no login. Everything is normalised to one shape:
//
//   { id, url, pgn, white, black, whiteElo, blackElo, result, date,
//     timeClass, opening, rated }
//
// `result` is always "1-0" / "0-1" / "1/2-1/2".

export const SITES = {
  chesscom: { label: "Chess.com", profile: (u) => "https://www.chess.com/member/" + u },
  lichess: { label: "Lichess", profile: (u) => "https://lichess.org/@/" + u },
};

export class LookupError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // "notfound" | "empty" | "ratelimit" | "network"
  }
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new LookupError("Could not reach the server. Check your connection.", "network");
  }
  if (res.status === 404) throw new LookupError("No such player.", "notfound");
  if (res.status === 429) throw new LookupError("The site is rate-limiting us. Wait a moment and try again.", "ratelimit");
  if (!res.ok) throw new LookupError("The site returned an error (" + res.status + ").", "network");
  return res;
}

// ---------- Chess.com ----------
// Games are grouped into one archive per month, so walk backwards from the
// newest month until we have enough games (or run out of recent history).
async function fetchChessCom(user, max) {
  const arch = await (await getJson(
    "https://api.chess.com/pub/player/" + encodeURIComponent(user) + "/games/archives")).json();
  const months = (arch.archives || []).slice().reverse();
  const out = [];
  for (const url of months.slice(0, 6)) {
    const data = await (await getJson(url)).json();
    const games = (data.games || []).filter((g) => g.rules === "chess" && g.pgn);
    for (const g of games.reverse()) {
      // Chess.com puts the *reason* a game ended in each colour's `result`
      // field; exactly one side says "win", and if neither does it was a draw.
      const wWin = g.white.result === "win";
      const bWin = g.black.result === "win";
      out.push({
        id: g.uuid || g.url,
        url: g.url,
        pgn: g.pgn,
        white: g.white.username,
        black: g.black.username,
        whiteElo: g.white.rating || null,
        blackElo: g.black.rating || null,
        result: wWin ? "1-0" : bWin ? "0-1" : "1/2-1/2",
        date: new Date((g.end_time || 0) * 1000),
        timeClass: g.time_class || null,
        opening: ecoUrlToName(g.eco),
        rated: !!g.rated,
      });
      if (out.length >= max) return out;
    }
  }
  if (!out.length) throw new LookupError("That account has no standard games yet.", "empty");
  return out;
}

// Chess.com gives an openings URL rather than a name:
// ".../openings/Four-Knights-Game-Scotch-Variation...11.Qf3-Bd6" -> "Four Knights Game: Scotch Variation"
function ecoUrlToName(url) {
  if (!url || typeof url !== "string") return null;
  const slug = url.split("/openings/")[1];
  if (!slug) return null;
  const name = slug.split(/\.{3}|\d+\./)[0].replace(/-/g, " ").trim();
  return name ? name.replace(/\s+/g, " ") : null;
}

// ---------- Lichess ----------
// One newline-delimited-JSON request returns the games with PGNs inline.
function lichessName(p) {
  if (p.user && p.user.name) return p.user.name;
  if (p.aiLevel) return "Stockfish level " + p.aiLevel;
  return "Anonymous";
}
async function fetchLichess(user, max) {
  const url = "https://lichess.org/api/games/user/" + encodeURIComponent(user) +
    "?max=" + max + "&pgnInJson=true&opening=true&clocks=true&sort=dateDesc";
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
  } catch (e) {
    throw new LookupError("Could not reach Lichess. Check your connection.", "network");
  }
  if (res.status === 404) throw new LookupError("No such player.", "notfound");
  if (res.status === 429) throw new LookupError("Lichess is rate-limiting us. Wait a moment and try again.", "ratelimit");
  if (!res.ok) throw new LookupError("Lichess returned an error (" + res.status + ").", "network");

  const text = await res.text();
  const rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const out = rows
    .filter((g) => g.variant === "standard" && g.pgn)
    .map((g) => {
      const w = g.players.white || {}, b = g.players.black || {};
      return {
        id: g.id,
        url: "https://lichess.org/" + g.id,
        pgn: g.pgn,
        white: lichessName(w),
        black: lichessName(b),
        whiteElo: w.rating || null,
        blackElo: b.rating || null,
        result: g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : "1/2-1/2",
        date: new Date(g.createdAt || 0),
        timeClass: g.speed || null,
        opening: (g.opening && g.opening.name) || null,
        rated: !!g.rated,
      };
    });
  if (!out.length) throw new LookupError("That account has no standard games yet.", "empty");
  return out;
}

export function fetchGames(site, user, { max = 30 } = {}) {
  const u = (user || "").trim();
  if (!u) return Promise.reject(new LookupError("Enter a username first.", "empty"));
  return site === "lichess" ? fetchLichess(u, max) : fetchChessCom(u, max);
}

// Which colour the looked-up player had, and how the game went for them.
export function playerSide(game, user) {
  const u = (user || "").toLowerCase();
  if (game.white.toLowerCase() === u) return "w";
  if (game.black.toLowerCase() === u) return "b";
  return null;
}
export function outcomeFor(game, user) {
  const side = playerSide(game, user);
  if (!side || game.result === "1/2-1/2") return "draw";
  const won = (side === "w" && game.result === "1-0") || (side === "b" && game.result === "0-1");
  return won ? "win" : "loss";
}
