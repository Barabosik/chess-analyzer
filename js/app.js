import { Chess } from "../vendor/chess.js?v=4";
import { Engine } from "./engine.js?v=4";
import { renderBoard } from "./board.js?v=4";
import { reviewGame, detectOpening, CLASSES, CLASS_ORDER, winPct } from "./review.js?v=4";

const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// The game the app opens with (barab0s1k vs Niknerf, the one that started this project).
const SAMPLE_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.07.10"]
[White "barab0s1k"]
[Black "Niknerf"]
[Result "1-0"]
[WhiteElo "900"]
[BlackElo "308"]
[ECO "C46"]
[Termination "barab0s1k won on time"]

1. e4 e5 2. Nc3 Nc6 3. Nf3 Nf6 4. d4 exd4 5. Nxd4 Bb4 6. Nxc6 bxc6 7. Bd3 d5
8. exd5 O-O 9. O-O cxd5 10. Bg5 c6 11. Qf3 Bd6 12. Rae1 Rb8 13. b3 Bb4 14. Qg3 Be6
15. Qh4 h6 16. Bxh6 gxh6 17. Qxh6 Bxc3 18. Rxe6 Ne4 19. Rxe4 dxe4 20. Bxe4 f5
21. Bxf5 Rf7 22. Be6 Qf6 23. Bxf7+ Kxf7 24. Qh5+ Kg8 25. Qg4+ Kf8 26. Rd1 c5
27. Rd5 Re8 28. g3 Re5 29. Rd3 Ke7 30. Qd7+ Kf8 31. Qg4 Ke7 32. Qa4 Re1+
33. Kg2 Bd4 34. Qxa7+ Kf8 35. Qa8+ Kg7 36. Rf3 Qe6 37. Qf8+ Kg6 38. h4 c4
39. bxc4 Qxc4 40. h5+ Kh7 41. Rf7+ Qxf7 42. Qxf7+ Bg7 43. a4 Rd1 44. Qg6+ Kh8
45. Qe8+ Kh7 46. a5 Ra1 47. Qg6+ Kh8 48. a6 Be5 49. Qe8+ Kh7 50. Qxe5 Rxa6
51. Qc7+ Kh6 52. Qf7 1-0`;

const state = {
  engine: null, booted: false,
  headers: {}, moves: [], startFen: DEFAULT_FEN,
  ply: 0, flip: false,
  reviewed: false, reviewing: false, cancel: { cancelled: false },
  live: true, reviewDepth: 14, liveLines: 3,
  explore: null, selected: null,
  sound: true, opening: null,
};
try { state.sound = localStorage.getItem("ca_sound") !== "0"; } catch (e) { /* private mode */ }

const $ = (id) => document.getElementById(id);
const el = {};
["board","evalFill","evalNum","engineStatus","pgnInput","fenInput","depthSel","linesSel",
 "movelist","summary","accWhite","accBlack","accWName","accBName","rateWhite","rateBlack","rateWName","rateBName","counts","hdrTitle","hdrMeta",
 "pWName","pBName","pWElo","pBElo","reviewBtn","progress","progressBar","progressTxt","readGlyph",
 "readMove","readSub","live","liveToggle","liveEval","liveDepth","liveLinesBox","exploreBar",
 "exploreTxt","engineName","capW","capB","assessBox","assessGlyph","assessHead","assessEval",
 "assessNote","assessBest","graphCard","evalGraph","openingName","soundToggle","shareBtn"]
  .forEach((k) => (el[k] = $(k)));

// ---------- helpers ----------
function fmtEval(cp, mate) {
  if (mate != null) return (mate > 0 ? "#" : "#-") + Math.abs(mate);
  const v = (cp || 0) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2);
}
function wpFromNode(cp, mate) {
  if (mate != null) return mate > 0 ? 100 : 0;
  return winPct(cp || 0);
}
function currentFen() {
  if (state.explore) return state.explore.chess.fen();
  return state.ply === 0 ? state.startFen : state.moves[state.ply - 1].fenAfter;
}
function pvToSan(fen, uciList, max = 12) {
  const c = new Chess(fen);
  const out = [];
  for (const u of uciList.slice(0, max)) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined });
      if (!m) break;
      out.push(m.san);
    } catch (e) { break; }
  }
  return out;
}
function formatPvSan(fen, sans) {
  const stmWhite = fen.split(" ")[1] === "w";
  let n = parseInt(fen.split(" ")[5] || "1", 10);
  let s = "", white = stmWhite;
  sans.forEach((san, i) => {
    if (white) s += (i ? " " : "") + n + ". " + san;
    else { s += (i === 0 ? n + "... " : " ") + san; n++; }
    white = !white;
  });
  return s;
}

// ---------- sounds (synthesized with WebAudio, no audio files) ----------
let audioCtx = null;
function audio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function blip({ freq = 240, dur = 0.08, gain = 0.13, noisy = false }) {
  if (!state.sound) return;
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(ctx.destination);
  if (noisy) { // capture: short filtered noise burst
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq * 3;
    src.connect(f); f.connect(g); src.start(t); src.stop(t + dur);
  } else {     // move: soft pitch-dropping thock
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur);
  }
}
function playMoveSound(mv) {
  if (!mv) return;
  const san = mv.san || "";
  if (san.includes("#")) return blip({ freq: 500, dur: 0.18, gain: 0.16 });
  if (san.includes("+")) return blip({ freq: 420, dur: 0.10, gain: 0.14 });
  if (san.includes("x") || mv.captured) return blip({ freq: 200, dur: 0.10, gain: 0.18, noisy: true });
  if (san.startsWith("O-O")) return blip({ freq: 175, dur: 0.12, gain: 0.15 });
  blip({ freq: 240, dur: 0.075, gain: 0.12 });
}

// ---------- share link ----------
let chipTimer = null;
function flashChip(msg) {
  el.engineStatus.textContent = msg;
  clearTimeout(chipTimer);
  chipTimer = setTimeout(() => {
    el.engineStatus.textContent = state.booted ? "ready" : "starting…";
  }, 1800);
}
function buildShareLink() {
  const base = location.origin + location.pathname;
  const pgn = el.pgnInput.value.trim();
  if (state.moves.length && pgn) {
    return base + "#pgn=" + btoa(unescape(encodeURIComponent(pgn)));
  }
  if (state.startFen && state.startFen !== DEFAULT_FEN) {
    return base + "#fen=" + encodeURIComponent(state.startFen);
  }
  return base;
}
async function copyShareLink() {
  const url = buildShareLink();
  try {
    await navigator.clipboard.writeText(url);
    flashChip("link copied");
  } catch (e) {
    window.prompt("Copy this link:", url);
  }
}
// Load a game/position that was shared via the URL hash.
function loadFromHash() {
  const h = location.hash || "";
  try {
    if (h.startsWith("#pgn=")) {
      const pgn = decodeURIComponent(escape(atob(h.slice(5))));
      el.pgnInput.value = pgn;
      loadGame(parseGame(pgn));
      return true;
    }
    if (h.startsWith("#fen=")) {
      const fen = decodeURIComponent(h.slice(5));
      new Chess(fen); // validates
      loadGame({ headers: { White: "Position", Black: "analysis" }, moves: [], startFen: fen });
      return true;
    }
  } catch (e) { /* fall through to empty board */ }
  return false;
}

// ---------- captured material ----------
const PIECE_GLYPH = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" };
const INIT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function countPieces(fen) {
  const w = { p: 0, n: 0, b: 0, r: 0, q: 0 }, b = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const ch of fen.split(" ")[0]) {
    const lc = ch.toLowerCase();
    if (w[lc] !== undefined) (ch === ch.toUpperCase() ? w : b)[lc]++;
  }
  return { w, b };
}
function capHtml(list, colorClass) {
  return list.map((t) => '<span class="cap ' + colorClass + '">' + PIECE_GLYPH[t] + "</span>").join("");
}
function renderMaterial(fen) {
  const { w, b } = countPieces(fen);
  const capByWhite = [], capByBlack = [];
  let diff = 0;
  for (const t of ["p", "n", "b", "r", "q"]) {
    for (let i = 0; i < INIT[t] - b[t]; i++) capByWhite.push(t); // black pieces White took
    for (let i = 0; i < INIT[t] - w[t]; i++) capByBlack.push(t); // white pieces Black took
    diff += PVAL[t] * (w[t] - b[t]);
  }
  el.capW.innerHTML = capHtml(capByWhite, "b") + (diff > 0 ? '<span class="adv">+' + diff + "</span>" : "");
  el.capB.innerHTML = capHtml(capByBlack, "w") + (diff < 0 ? '<span class="adv">+' + -diff + "</span>" : "");
}

// Plain-English, coach-style note for a classified move.
function coachNote(mv) {
  const b = mv.bestSan;
  const cap = mv.san.includes("x");
  const check = /[+#]/.test(mv.san);
  switch (mv.cls) {
    case "brilliant": return "A brilliant stroke — you give up material for a decisive initiative.";
    case "great": return "A great find — practically the only move that holds your advantage.";
    case "best": return check ? "The sharpest move — you keep the pressure on."
      : cap ? "The best move — you grab the key material." : "The strongest move in the position.";
    case "good": return "A sound, solid move — nothing lost.";
    case "book": return "A well-known opening move.";
    case "inaccuracy": return "Slightly inaccurate" + (b ? " — " + b + " was a touch stronger." : ".");
    case "mistake": return "A mistake — this hands your opponent chances" + (b ? ". " + b + " was better." : ".");
    case "blunder": return "A blunder — this drops material or the game" + (b ? ". " + b + " was much stronger." : ".");
    default: return "";
  }
}

function renderAssessment() {
  const show = state.reviewed && state.ply > 0 && !state.explore;
  if (!show) { el.assessBox.classList.add("hidden"); return; }
  const mv = state.moves[state.ply - 1];
  const cl = CLASSES[mv.cls];
  el.assessGlyph.textContent = cl.g;
  el.assessGlyph.style.background = "var(" + cl.v + ")";
  el.assessHead.innerHTML = "<b>" + mv.san + "</b> is " + cl.label.toLowerCase();
  el.assessEval.textContent = fmtEval(mv.cpWhite, mv.mateWhite);
  el.assessNote.textContent = coachNote(mv);
  if (mv.bestSan && mv.bestSan !== mv.san) {
    el.assessBest.classList.remove("hidden");
    el.assessBest.classList.add("clickable");
    el.assessBest.innerHTML =
      '<span class="cg" style="color:var(--best)">★</span> <b>' + mv.bestSan + "</b> is best" +
      '<span class="preview-hint">▶ see it</span>' +
      '<span class="evchip">' + fmtEval(mv.bestCpWhite, mv.bestMateWhite) + "</span>";
    el.assessBest.onclick = () => previewBest(mv);
  } else { el.assessBest.classList.add("hidden"); el.assessBest.onclick = null; }
  el.assessBox.classList.remove("hidden");
}

// Play the engine's recommended move on the board (branch from the position
// before the played move) so the user can see where it goes and continue it.
function previewBest(mv) {
  if (!mv || !mv.bestFrom) return;
  playToken++;
  const chess = new Chess(mv.fenBefore);
  try { chess.move({ from: mv.bestFrom, to: mv.bestTo, promotion: mv.bestPromo || undefined }); }
  catch (e) { return; }
  state.explore = { base: mv.fenBefore, chess, arrow: { from: mv.bestFrom, to: mv.bestTo } };
  state.selected = null;
  el.exploreBar.classList.remove("hidden");
  renderExploreLine();
  drawBoard();
  animateMove(mv.bestFrom, mv.bestTo);
  playMoveSound({ san: mv.bestSan || "" });
  renderReadout(); renderAssessment(); restartLive();
}

// Play the NEXT single move of an engine line (one click = one move). The engine
// then re-analyzes the new position, so clicking a line again continues it.
function playLine(fen, pv) {
  if (!pv || !pv.length) return;
  playToken++;
  // Continue the current line if this click starts from the current explore
  // position; otherwise begin a fresh line from `fen`.
  let base, chess;
  if (state.explore && state.explore.chess.fen() === fen) {
    base = state.explore.base;
    chess = state.explore.chess;
  } else {
    base = fen;
    chess = new Chess(fen);
  }
  const u = pv[0];
  let mv;
  try { mv = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined }); }
  catch (e) { return; }
  if (!mv) return;
  state.explore = { base, chess, arrow: { from: mv.from, to: mv.to } };
  state.selected = null;
  el.exploreBar.classList.remove("hidden");
  renderExploreLine();
  drawBoard();
  animateMove(mv.from, mv.to);
  playMoveSound(mv);
  renderReadout(); renderAssessment(); restartLive();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

// Win-probability line across the whole game with dots on notable moves.
function drawEvalGraph() {
  if (!state.reviewed || !state.moves.length) { el.graphCard.classList.add("hidden"); return; }
  el.graphCard.classList.remove("hidden");
  const cv = el.evalGraph;
  const W = Math.max(300, cv.getBoundingClientRect().width), H = 100;
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const N = state.moves.length;
  const pts = [winPct(20)];
  for (const m of state.moves) pts.push(m.mateWhite != null ? (m.mateWhite > 0 ? 100 : 0) : winPct(m.cpWhite));
  const X = (i) => (i / N) * W;
  const Y = (v) => H - (v / 100) * H;

  ctx.fillStyle = cssVar("--panel2"); ctx.fillRect(0, 0, W, H);          // black-advantage ground
  ctx.beginPath(); ctx.moveTo(0, H);
  pts.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
  ctx.lineTo(W, H); ctx.closePath();
  ctx.fillStyle = "#e9e7df"; ctx.fill();                                  // white-advantage area

  ctx.strokeStyle = "rgba(128,128,128,.45)"; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, Y(50)); ctx.lineTo(W, Y(50)); ctx.stroke(); ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(60,66,74,.55)"; ctx.lineWidth = 1;
  ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();

  const notable = { brilliant: 1, great: 1, inaccuracy: 1, mistake: 1, blunder: 1 };
  state.moves.forEach((m, i) => {
    if (!notable[m.cls]) return;
    ctx.beginPath(); ctx.arc(X(i + 1), Y(pts[i + 1]), 3.4, 0, 7);
    ctx.fillStyle = cssVar(CLASSES[m.cls].v); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke();
  });

  const cx = X(state.ply);
  ctx.strokeStyle = cssVar("--accent"); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
}

// ---------- parsing ----------
function parseGame(pgn) {
  const headers = {};
  for (const m of pgn.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) headers[m[1]] = m[2];
  const c = new Chess();
  try { c.loadPgn(pgn); }
  catch (e) { c.loadPgn(pgn.replace(/\{[^}]*\}/g, "").replace(/\$\d+/g, "")); }
  const startFen = headers.FEN ? headers.FEN : DEFAULT_FEN;
  const rc = new Chess(startFen);
  const verbose = c.history({ verbose: true });
  const moves = verbose.map((h, idx) => {
    const fenBefore = rc.fen();
    const m = rc.move(h.san);
    return {
      san: m.san, from: m.from, to: m.to,
      uci: m.from + m.to + (m.promotion || ""),
      color: m.color, fenBefore, fenAfter: rc.fen(),
      moveNo: rc.moveNumber() - (m.color === "w" ? 0 : 1),
    };
  });
  return { headers, startFen, moves };
}

function loadGame(parsed) {
  state.headers = parsed.headers;
  state.moves = parsed.moves;
  state.startFen = parsed.startFen;
  state.ply = 0;
  state.reviewed = false;
  state.review = null;
  state.explore = null;
  state.selected = null;
  state.opening = detectOpening(parsed.moves);
  renderHeader();
  renderOpening();
  renderMoveList();
  el.summary.classList.add("hidden");
  el.reviewBtn.disabled = !state.moves.length || !state.booted;
  goto(0);
}

// ---------- rendering ----------
function renderHeader() {
  const h = state.headers;
  const hasGame = !!(h.White || h.Black || state.moves.length);
  el.hdrTitle.textContent = hasGame ? (h.White || "White") + "  vs  " + (h.Black || "Black")
                                    : "Load a game to analyze";
  el.pWName.textContent = h.White || "White";
  el.pBName.textContent = h.Black || "Black";
  el.pWElo.textContent = h.WhiteElo ? "(" + h.WhiteElo + ")" : "";
  el.pBElo.textContent = h.BlackElo ? "(" + h.BlackElo + ")" : "";
  const bits = [];
  if (h.Date) bits.push(h.Date.replace(/\./g, "-"));
  if (h.ECO) bits.push("ECO " + h.ECO);
  if (h.Result) bits.push(h.Result);
  if (h.Termination) bits.push(h.Termination);
  el.hdrMeta.textContent = hasGame && bits.length ? bits.join("  ·  ")
    : "Paste a PGN or FEN above, upload a .pgn file, or click Load sample.";
}

function renderOpening() {
  const op = state.opening; // [eco, name]
  if (!op) { el.openingName.classList.add("hidden"); return; }
  el.openingName.textContent = op[1] + "  ·  " + op[0];
  el.openingName.classList.remove("hidden");
}

function renderMoveList() {
  const M = state.moves;
  el.movelist.innerHTML = "";
  if (!M.length) {
    el.movelist.innerHTML = '<div class="mvempty-msg">No moves — load a PGN, or a FEN for single-position analysis.</div>';
    return;
  }
  const rows = Math.ceil(M.length / 2);
  for (let r = 0; r < rows; r++) {
    const row = document.createElement("div");
    row.className = "mvrow";
    const no = document.createElement("div");
    no.className = "no"; no.textContent = r + 1 + ".";
    row.appendChild(no);
    for (const idx of [2 * r, 2 * r + 1]) {
      const cell = document.createElement("div");
      if (idx < M.length) {
        const mv = M[idx];
        cell.className = "mv"; cell.dataset.ply = idx + 1;
        let inner = '<span class="san">' + mv.san + "</span>";
        if (state.reviewed) {
          const cl = CLASSES[mv.cls];
          inner += '<span class="cg" style="color:var(' + cl.v + ')">' + cl.g + "</span>";
          inner += '<span class="ev">' + fmtEval(mv.cpWhite, mv.mateWhite) + "</span>";
        }
        cell.innerHTML = inner;
        cell.addEventListener("click", () => { state.explore = null; goto(idx + 1); });
      } else cell.className = "mv empty";
      row.appendChild(cell);
    }
    el.movelist.appendChild(row);
  }
}

// Rough single-game strength estimate mapped from accuracy. It's an estimate,
// not an official rating, and won't match chess.com's proprietary formula exactly.
function estRating(acc) {
  return Math.round(Math.max(100, Math.min(2900, 6.8 * Math.exp(0.0575 * acc))) / 25) * 25;
}

function renderSummary() {
  const R = state.review;
  el.summary.classList.remove("hidden");
  el.accWName.textContent = state.headers.White || "White";
  el.accBName.textContent = state.headers.Black || "Black";
  el.accWhite.textContent = R.accWhite + "%";
  el.accBlack.textContent = R.accBlack + "%";
  el.rateWName.textContent = state.headers.White || "White";
  el.rateBName.textContent = state.headers.Black || "Black";
  el.rateWhite.textContent = estRating(R.accWhite);
  el.rateBlack.textContent = estRating(R.accBlack);
  el.counts.innerHTML = "";
  for (const k of CLASS_ORDER) {
    const w = R.counts.w[k] || 0, b = R.counts.b[k] || 0;
    const row = document.createElement("div");
    row.className = "countrow";
    row.innerHTML =
      '<span class="g" style="background:var(' + CLASSES[k].v + ')">' + CLASSES[k].g + "</span>" +
      '<span class="cl">' + CLASSES[k].label + "</span>" +
      '<span class="cw">' + w + "</span><span class=\"cb\">" + b + "</span>";
    el.counts.appendChild(row);
  }
}

function fmtEvalBar(cp, mate) {
  if (mate != null) return "M" + Math.abs(mate);
  return (Math.abs(cp || 0) / 100).toFixed(1);
}
function updateEvalBar(cp, mate) {
  const wp = wpFromNode(cp, mate);
  el.evalFill.style.transform = "scaleY(" + wp / 100 + ")";
  el.evalNum.textContent = fmtEvalBar(cp, mate);
  el.evalNum.className = "evalnum " + (wp >= 50 ? "bot" : "top");
}

function renderReadout() {
  if (state.explore) {
    el.readGlyph.style.background = "var(--accent)";
    el.readGlyph.textContent = "⌕";
    el.readMove.textContent = "Analysis line";
    el.readSub.innerHTML = "Exploring a variation. <b>Return to game</b> to resume review.";
    return;
  }
  const mv = state.ply > 0 ? state.moves[state.ply - 1] : null;
  if (!mv) {
    el.readGlyph.style.background = "var(--muted)";
    el.readGlyph.textContent = "○";
    el.readMove.textContent = "Starting position";
    el.readSub.innerHTML = "Use ← → keys or click a move. Click a piece to explore lines.";
    return;
  }
  if (state.reviewed) {
    const cl = CLASSES[mv.cls];
    el.readGlyph.style.background = "var(" + cl.v + ")";
    el.readGlyph.textContent = cl.g;
    el.readMove.textContent = mv.moveNo + (mv.color === "w" ? ". " : "... ") + mv.san + "  —  " + cl.label;
    let sub = "Eval " + fmtEval(mv.cpWhite, mv.mateWhite);
    if (mv.loss >= 5) sub += " · lost " + mv.loss + "% win chance";
    if (mv.showBetter && mv.bestSan) sub += ' · better was <b class="bestlink">' + mv.bestSan + "</b>";
    el.readSub.innerHTML = sub;
    const bl = el.readSub.querySelector(".bestlink");
    if (bl) bl.onclick = () => previewBest(mv);
  } else {
    el.readGlyph.style.background = "var(--muted)";
    el.readGlyph.textContent = "•";
    el.readMove.textContent = mv.moveNo + (mv.color === "w" ? ". " : "... ") + mv.san;
    el.readSub.innerHTML = 'Run <b>Analyze game</b> for move classifications.';
  }
}

// ---------- move animation ----------
let playToken = 0; // cancels an in-flight line playback when the user does anything else
function dispCR(square) {
  const file = square.charCodeAt(0) - 97, rank = +square[1];
  return { c: state.flip ? 7 - file : file, r: state.flip ? rank - 1 : 8 - rank };
}
// Slide the piece now sitting on `to` from where it started (FLIP technique).
function animateMove(from, to) {
  const pc = el.board.querySelector('[data-sq="' + to + '"] .pc');
  if (!pc) return;
  const size = el.board.getBoundingClientRect().width / 8;
  const f = dispCR(from), t = dispCR(to);
  const dx = (f.c - t.c) * size, dy = (f.r - t.r) * size;
  pc.style.transition = "none";
  pc.style.transform = "translate(" + dx + "px," + dy + "px)";
  pc.getBoundingClientRect(); // force reflow so the next frame animates
  requestAnimationFrame(() => { pc.style.transition = "transform .2s ease"; pc.style.transform = "translate(0,0)"; });
}

function drawBoard() {
  const fen = currentFen();
  let lastMove = null, badge = null;
  const arrows = [];
  if (state.explore) {
    const h = state.explore.chess.history({ verbose: true });
    const last = h[h.length - 1];
    if (last) lastMove = { from: last.from, to: last.to };
    if (state.explore.arrow) arrows.push({ from: state.explore.arrow.from, to: state.explore.arrow.to, color: "#f7b34c" });
  } else if (state.ply > 0) {
    const mv = state.moves[state.ply - 1];
    lastMove = { from: mv.from, to: mv.to };
    if (state.reviewed) badge = { square: mv.to, cls: mv.cls };
  }
  const targets = state.selected ? legalTargets(fen, state.selected) : [];
  renderBoard(el.board, fen, {
    flip: state.flip, lastMove, badge, selected: state.selected, targets, arrows,
    onSquareClick: onSquareClick,
  });
  renderMaterial(fen);
}

function legalTargets(fen, sq) {
  try {
    const c = new Chess(fen);
    return c.moves({ square: sq, verbose: true }).map((m) => m.to);
  } catch (e) { return []; }
}

// ---------- navigation ----------
function goto(ply) {
  const prev = state.ply;
  playToken++;
  state.ply = Math.max(0, Math.min(state.moves.length, ply));
  state.selected = null;
  drawBoard();
  if (state.ply === prev + 1 && state.ply > 0) {
    const m = state.moves[state.ply - 1]; animateMove(m.from, m.to); playMoveSound(m);
  } else if (state.ply === prev - 1 && prev > 0) {
    const m = state.moves[prev - 1]; animateMove(m.to, m.from); playMoveSound(m);
  }
  renderReadout();
  renderAssessment();
  // eval bar: prefer reviewed data, else let live analysis fill it in.
  if (state.reviewed && state.ply > 0) {
    const mv = state.moves[state.ply - 1];
    updateEvalBar(mv.cpWhite, mv.mateWhite);
  } else if (state.ply === 0) {
    updateEvalBar(20, null);
  }
  document.querySelectorAll(".mv").forEach((e) =>
    e.classList.toggle("active", +e.dataset.ply === state.ply));
  const act = document.querySelector(".mv.active");
  if (act) act.scrollIntoView({ block: "nearest" });
  drawEvalGraph();
  restartLive();
}

// ---------- click-to-move exploration ----------
function onSquareClick(name) {
  if (state.reviewing) return;
  playToken++;
  const fen = currentFen();
  const c = new Chess(fen);
  const piece = c.get(name);
  if (state.selected && state.selected !== name) {
    // attempt a move selected -> name
    try {
      const mv = c.move({ from: state.selected, to: name, promotion: "q" });
      if (mv) {
        const from = state.selected;
        if (!state.explore) state.explore = { base: fen, chess: new Chess(fen) };
        state.explore.chess.move({ from, to: name, promotion: "q" });
        state.explore.arrow = null;
        state.selected = null;
        el.exploreBar.classList.remove("hidden");
        renderExploreLine();
        drawBoard();
        animateMove(from, name);
        playMoveSound(mv);
        renderReadout(); renderAssessment(); restartLive();
        return;
      }
    } catch (e) { /* not a legal move; fall through to reselect */ }
  }
  // select a piece of the side to move
  if (piece && piece.color === fen.split(" ")[1]) {
    state.selected = name;
  } else {
    state.selected = null;
  }
  drawBoard();
}

function renderExploreLine() {
  if (!state.explore) { el.exploreBar.classList.add("hidden"); return; }
  const sans = state.explore.chess.history();
  el.exploreTxt.textContent = formatPvSan(state.explore.base, sans) || "—";
}

function returnToGame() {
  state.explore = null;
  state.selected = null;
  el.exploreBar.classList.add("hidden");
  goto(state.ply);
}

// ---------- live engine ----------
// Debounced + generation-guarded so rapid navigation never overlaps engine
// searches (overlapping stop/position/go corrupts the WASM engine).
let liveGen = 0;
let liveTimer = null;
function restartLive() {
  clearTimeout(liveTimer);
  if (!state.booted || !state.live || state.reviewing) return;
  const gen = ++liveGen;
  liveTimer = setTimeout(async () => {
    if (gen !== liveGen || state.reviewing || !state.live) return;
    const fen = currentFen();
    await state.engine.stopLive();          // fully settle the previous search
    if (gen !== liveGen || state.reviewing) return; // superseded / review started while stopping
    await state.engine.live(fen, {
      multipv: state.liveLines,
      onUpdate: (lines) => { if (gen === liveGen) renderLive(fen, lines); },
    });
  }, 90);
}
function renderLive(fen, lines) {
  if (!lines.length) return;
  const top = lines[0];
  el.liveDepth.textContent = "depth " + top.depth + (top.seldepth ? "/" + top.seldepth : "");
  el.liveEval.textContent = fmtEval(top.cp, top.mate);
  el.liveEval.style.color = wpFromNode(top.cp, top.mate) >= 50 ? "var(--ink)" : "var(--muted)";
  // fill eval bar live only when not showing reviewed eval
  if (!(state.reviewed && state.ply > 0 && !state.explore)) updateEvalBar(top.cp, top.mate);
  el.liveLinesBox.innerHTML = "";
  for (const ln of lines) {
    const sans = pvToSan(fen, ln.pv);
    const div = document.createElement("div");
    div.className = "liveline";
    div.title = "Play the next move of this line";
    div.innerHTML =
      '<span class="lev">' + fmtEval(ln.cp, ln.mate) + "</span>" +
      '<span class="lpv">' + formatPvSan(fen, sans) + "</span>";
    const pv = ln.pv.slice();
    div.addEventListener("click", () => playLine(fen, pv));
    el.liveLinesBox.appendChild(div);
  }
}

// ---------- review ----------
async function runReview() {
  if (!state.moves.length || !state.booted || state.reviewing) return;
  state.reviewing = true;
  clearTimeout(liveTimer); liveGen++;   // cancel any pending live search
  state.cancel = { cancelled: false };
  el.reviewBtn.textContent = "Cancel";
  el.reviewBtn.classList.add("cancel");
  el.progress.classList.remove("hidden");
  await state.engine.stopLive();
  const total = state.moves.length + 1;
  const res = await reviewGame(state.engine, state.moves, state.startFen, {
    depth: state.reviewDepth,
    onProgress: (d) => {
      const pct = Math.round((d / total) * 100);
      el.progressBar.style.transform = "scaleX(" + pct / 100 + ")";
      el.progressTxt.textContent = "Analyzing " + d + " / " + total + " positions (depth " + state.reviewDepth + ")";
    },
    signal: state.cancel,
  });
  state.reviewing = false;
  el.reviewBtn.textContent = "Analyze game";
  el.reviewBtn.classList.remove("cancel");
  el.progress.classList.add("hidden");
  el.progressBar.style.transform = "scaleX(0)";
  if (!res) { restartLive(); return; }
  state.review = res;
  state.moves = res.moves;
  state.reviewed = true;
  renderSummary();
  renderMoveList();
  goto(state.ply);
}

// ---------- engine boot ----------
async function boot() {
  const url = new URL("../vendor/stockfish/stockfish-18-lite-single.js", import.meta.url);
  state.engine = new Engine(url);
  el.engineStatus.textContent = "loading engine (~7 MB)…";
  await state.engine.boot();
  state.booted = true;
  el.engineName.textContent = state.engine.name || "Stockfish 18";
  el.engineStatus.textContent = "ready";
  el.engineStatus.classList.add("ok");
  el.reviewBtn.disabled = !state.moves.length;
  restartLive();
}

// ---------- wire up UI ----------
function bind() {
  $("bStart").onclick = () => { state.explore = null; el.exploreBar.classList.add("hidden"); goto(0); };
  $("bPrev").onclick = () => { state.explore = null; el.exploreBar.classList.add("hidden"); goto(state.ply - 1); };
  $("bNext").onclick = () => { state.explore = null; el.exploreBar.classList.add("hidden"); goto(state.ply + 1); };
  $("bEnd").onclick = () => { state.explore = null; el.exploreBar.classList.add("hidden"); goto(state.moves.length); };
  $("bFlip").onclick = () => { state.flip = !state.flip; drawBoard(); };
  $("returnGame").onclick = returnToGame;

  el.reviewBtn.onclick = () => { state.reviewing ? (state.cancel.cancelled = true) : runReview(); };

  $("loadPgn").onclick = () => {
    const txt = el.pgnInput.value.trim();
    if (!txt) return;
    try { loadGame(parseGame(txt)); }
    catch (e) { alert("Could not parse PGN:\n" + e.message); }
  };
  $("loadFen").onclick = () => {
    const fen = el.fenInput.value.trim();
    if (!fen) return;
    try {
      new Chess(fen); // validates
      loadGame({ headers: { White: "Position", Black: "analysis" }, moves: [], startFen: fen });
    } catch (e) { alert("Invalid FEN:\n" + e.message); }
  };
  $("loadSample").onclick = () => { el.pgnInput.value = SAMPLE_PGN; loadGame(parseGame(SAMPLE_PGN)); };
  $("pgnFile").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { el.pgnInput.value = r.result; try { loadGame(parseGame(r.result)); } catch (err) { alert(err.message); } };
    r.readAsText(f);
  };

  el.depthSel.onchange = () => { state.reviewDepth = +el.depthSel.value; };
  el.linesSel.onchange = () => { state.liveLines = +el.linesSel.value; restartLive(); };
  el.liveToggle.onclick = () => {
    state.live = !state.live;
    el.liveToggle.classList.toggle("on", state.live);
    el.liveToggle.textContent = state.live ? "Engine: on" : "Engine: off";
    el.live.classList.toggle("off", !state.live);
    if (state.live) restartLive(); else state.engine && state.engine.stopLive();
  };
  el.evalGraph.addEventListener("click", (e) => {
    const r = el.evalGraph.getBoundingClientRect();
    state.explore = null; el.exploreBar.classList.add("hidden");
    goto(Math.round(((e.clientX - r.left) / r.width) * state.moves.length));
  });
  window.addEventListener("resize", () => { if (state.reviewed) drawEvalGraph(); });

  el.soundToggle.classList.toggle("on", state.sound);
  el.soundToggle.onclick = () => {
    state.sound = !state.sound;
    el.soundToggle.classList.toggle("on", state.sound);
    try { localStorage.setItem("ca_sound", state.sound ? "1" : "0"); } catch (e) { /* ignore */ }
    if (state.sound) playMoveSound({ san: "e4" }); // preview the sound when enabling
  };
  el.shareBtn.onclick = copyShareLink;
  // Pasting a share link into an already-open tab should load that game.
  window.addEventListener("hashchange", () => { loadFromHash(); });

  $("themeToggle").onclick = () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : cur === "light" ? "dark"
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", next);
  };

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") { $("bPrev").click(); e.preventDefault(); }
    else if (e.key === "ArrowRight") { $("bNext").click(); e.preventDefault(); }
    else if (e.key === "Home") { $("bStart").click(); e.preventDefault(); }
    else if (e.key === "End") { $("bEnd").click(); e.preventDefault(); }
    else if (e.key === "f") $("bFlip").click();
  });
}

// build legend once
function buildLegend() {
  const box = $("legend");
  for (const k of CLASS_ORDER) {
    const it = document.createElement("div");
    it.className = "legitem";
    it.innerHTML = '<span class="g" style="background:var(' + CLASSES[k].v + ')">' + CLASSES[k].g +
      "</span>" + CLASSES[k].label;
    box.appendChild(it);
  }
}

// ---------- init ----------
bind();
buildLegend();
el.depthSel.value = String(state.reviewDepth);
el.linesSel.value = String(state.liveLines);
// A shared #pgn= / #fen= link loads that game; otherwise start empty.
if (!loadFromHash()) loadGame({ headers: {}, moves: [], startFen: DEFAULT_FEN });
boot();
