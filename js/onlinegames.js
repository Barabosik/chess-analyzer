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

// ---------- open one specific game from its link ----------

// Understands the links both sites hand out, e.g.
//   https://www.chess.com/game/live/171388438044?username=barab0s1k
//   https://www.chess.com/analysis/game/live/171388438044?tab=review
//   https://lichess.org/kAdOQKeh          (also /kAdOQKeh/black, and 12-char player links)
export function parseGameUrl(input) {
  const s = (input || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);

  if (host === "lichess.org") {
    // The first path segment is the 8-char game id; player links append a
    // 4-char token, and the board may be pinned to a colour.
    const seg = segs.find((x) => /^[a-zA-Z0-9]{8,12}$/.test(x));
    if (!seg) return null;
    return {
      site: "lichess",
      id: seg.slice(0, 8),
      color: segs.includes("black") ? "black" : segs.includes("white") ? "white" : null,
    };
  }

  if (host === "chess.com") {
    // The id is the last all-digits segment, wherever it sits in the path.
    const id = [...segs].reverse().find((x) => /^\d+$/.test(x));
    if (!id) return null;
    return { site: "chesscom", id, user: (u.searchParams.get("username") || "").trim() };
  }
  return null;
}

// How far back through the monthly archives we will hunt for one game.
// Chess.com game ids are NOT ordered by date (months overlap heavily for active
// players), so there is no way to jump to the right month — it has to be a scan.
const MAX_ARCHIVE_SCAN = 24;

export async function fetchGameByUrl(input, { onProgress = () => {}, fallbackUser = "" } = {}) {
  const ref = parseGameUrl(input);
  if (!ref) throw new LookupError("That isn't a Chess.com or Lichess game link.", "badurl");

  if (ref.site === "lichess") {
    let res;
    try {
      res = await fetch("https://lichess.org/game/export/" + ref.id + "?clocks=true&opening=true",
        { headers: { Accept: "application/x-chess-pgn" } });
    } catch (e) {
      throw new LookupError("Could not reach Lichess. Check your connection.", "network");
    }
    if (res.status === 404) throw new LookupError("Lichess has no game with that id.", "notfound");
    if (res.status === 429) throw new LookupError("Lichess is rate-limiting us. Wait a moment.", "ratelimit");
    if (!res.ok) throw new LookupError("Lichess returned an error (" + res.status + ").", "network");
    const pgn = (await res.text()).trim();
    if (!pgn) throw new LookupError("That game has no moves to analyze.", "empty");
    return { id: ref.id, url: "https://lichess.org/" + ref.id, pgn, color: ref.color, user: "" };
  }

  // Chess.com publishes games per player per month and has no public
  // single-game endpoint (its internal one sends no CORS header, so a static
  // page cannot call it). A game can therefore only be found by knowing one of
  // its players: the ?username= a Share link carries, or — for links that lack
  // it, like /analysis/ ones — whoever the user last looked up.
  const user = (ref.user || fallbackUser || "").trim();
  if (!user) {
    throw new LookupError(
      "Chess.com only serves games by player, so this link alone isn't enough. " +
      "Search your username above first, then paste the link again — or use the link from their " +
      "Share button, which ends with ?username=…",
      "nouser");
  }
  const arch = await (await getJson(
    "https://api.chess.com/pub/player/" + encodeURIComponent(user) + "/games/archives")).json();
  const months = (arch.archives || []).slice().reverse().slice(0, MAX_ARCHIVE_SCAN);
  for (const month of months) {
    onProgress("Looking through " + user + "’s games (" + month.slice(-7).replace("/", "-") + ")…");
    const data = await (await getJson(month)).json();
    const hit = (data.games || []).find((g) => g.url && g.url.split("/").pop() === ref.id);
    if (hit) {
      if (!hit.pgn) throw new LookupError("That game has no moves to analyze.", "empty");
      return { id: ref.id, url: hit.url, pgn: hit.pgn, color: null, user };
    }
  }
  throw new LookupError(
    "That game isn’t among " + user + "’s last " + months.length + " months of games. " +
    "If it’s someone else’s game, Chess.com will only hand it over by player — add " +
    "?username=THEIR_NAME to the link, or paste the game’s PGN below instead.",
    "notfound");
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
