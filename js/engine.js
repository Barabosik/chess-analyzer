// Thin UCI wrapper around the Stockfish WASM Web Worker.
// One search runs at a time; callers await abort() implicitly before starting a new one.

function parseInfo(line, stm) {
  const t = line.split(/\s+/);
  const info = { multipv: 1, depth: 0, seldepth: 0, cp: null, mate: null, nodes: 0, nps: 0, pv: [] };
  for (let i = 0; i < t.length; i++) {
    const k = t[i];
    if (k === "depth") info.depth = +t[i + 1];
    else if (k === "seldepth") info.seldepth = +t[i + 1];
    else if (k === "multipv") info.multipv = +t[i + 1];
    else if (k === "nodes") info.nodes = +t[i + 1];
    else if (k === "nps") info.nps = +t[i + 1];
    else if (k === "score") {
      const type = t[i + 1], val = +t[i + 2];
      // UCI scores are from the side-to-move POV; normalise to White's POV.
      if (type === "cp") info.cp = stm === "w" ? val : -val;
      else if (type === "mate") info.mate = stm === "w" ? val : -val;
    } else if (k === "pv") { info.pv = t.slice(i + 1); break; }
  }
  info.move = info.pv[0] || null;
  return info;
}

export class Engine {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.listeners = new Set();
    this.booted = false;
    this._busy = false;
    this._liveFn = null;
    this.name = "Stockfish";
  }

  boot() {
    this.worker = new Worker(this.url);
    this.worker.onmessage = (e) => {
      const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
      if (line) this._emit(line);
    };
    return new Promise((resolve) => {
      const fn = (l) => {
        if (l.startsWith("id name")) this.name = l.slice(8).trim();
        if (l === "uciok") this.post("isready");
        if (l === "readyok") { this.off(fn); this.booted = true; resolve(this); }
      };
      this.on(fn);
      this.post("uci");
    });
  }

  post(cmd) { this.worker.postMessage(cmd); }
  on(fn) { this.listeners.add(fn); }
  off(fn) { this.listeners.delete(fn); }
  _emit(line) { for (const fn of [...this.listeners]) fn(line); }

  setMultiPV(n) { this.post("setoption name MultiPV value " + n); }

  // Clear the transposition table. Without this a review's evaluations depend on
  // whatever was analysed before it, so the same game reviewed twice could come
  // back with different labels around the class boundaries. Positions within one
  // review are still searched in the same order, so the hash is still reused for
  // speed — it just no longer carries state in from earlier games.
  newGame() {
    return new Promise((res) => {
      const fn = (l) => { if (l === "readyok") { this.off(fn); res(); } };
      this.on(fn);
      this.post("ucinewgame");
      this.post("isready");
    });
  }

  // Halt any running search and wait for the engine to settle (bestmove).
  abort() {
    if (this._liveFn) { this.off(this._liveFn); this._liveFn = null; }
    if (!this._busy) return Promise.resolve();
    return new Promise((res) => {
      const fn = (l) => {
        if (l.startsWith("bestmove")) { this.off(fn); this._busy = false; res(); }
      };
      this.on(fn);
      this.post("stop");
    });
  }

  // Fixed-depth analysis of one position. Resolves at bestmove.
  // Returns { stm, bestmove, best, lines:[{multipv,cp,mate,pv,move,depth}] } (scores in White POV).
  async analyse(fen, { depth = 15, multipv = 1 } = {}) {
    await this.abort();
    this._busy = true;
    this.setMultiPV(multipv);
    const stm = fen.split(" ")[1] || "w";
    return new Promise((res) => {
      const lines = {};
      const fn = (l) => {
        if (l.startsWith("info") && l.includes(" pv ") && l.includes(" score ")) {
          const i = parseInfo(l, stm);
          if (i) lines[i.multipv] = i;
        } else if (l.startsWith("bestmove")) {
          this.off(fn);
          this._busy = false;
          const arr = Object.values(lines).sort((a, b) => a.multipv - b.multipv);
          const bm = l.split(" ")[1];
          res({ stm, bestmove: bm === "(none)" ? null : bm, best: arr[0] || null, lines: arr });
        }
      };
      this.on(fn);
      this.post("position fen " + fen);
      this.post("go depth " + depth);
    });
  }

  // Continuous ("infinite") analysis for the live panel. Streams via onUpdate(lines).
  async live(fen, { multipv = 3, onUpdate } = {}) {
    await this.abort();
    this._busy = true;
    this.setMultiPV(multipv);
    const stm = fen.split(" ")[1] || "w";
    const lines = {};
    this._liveFn = (l) => {
      if (l.startsWith("info") && l.includes(" pv ") && l.includes(" score ")) {
        const i = parseInfo(l, stm);
        if (i) {
          lines[i.multipv] = i;
          onUpdate && onUpdate(Object.values(lines).sort((a, b) => a.multipv - b.multipv));
        }
      }
    };
    this.on(this._liveFn);
    this.post("position fen " + fen);
    this.post("go infinite");
  }

  stopLive() { return this.abort(); }
}
