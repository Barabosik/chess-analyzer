// Review cache. A review is ~100 engine searches; re-opening the same game used to
// redo every one of them. They are pure functions of (position, depth, engine), so
// they can simply be remembered.
//
// IndexedDB rather than localStorage: a reviewed game is ~20-40 KB of JSON (the moves
// carry each one's principal variation, which is what makes "Explain" instant), and
// localStorage's ~5 MB ceiling would hold only a hundred or so before it started
// throwing. IndexedDB has no practical limit, and stores structured objects without a
// JSON.stringify round-trip.
//
// EVERY input that changes the answer belongs in the key. Depth and engine are in it
// because a depth-12 review is a different review from a depth-22 one, and serving the
// cheap one when the user asked for the deep one is exactly the bug this file could
// most easily cause.

const DB = "chess-analyzer";
const STORE = "reviews";
const VERSION = 1;
const KEEP = 60;          // most-recent reviews to retain; ~2 MB at 35 KB each

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    // Private windows and locked-down browsers can refuse IndexedDB outright. The
    // cache is an optimisation, never a dependency: on failure we resolve to null and
    // every call below turns into a no-op, so the app just reviews as it always did.
    let req;
    try { req = indexedDB.open(DB, VERSION); }
    catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: "key" });
        st.createIndex("at", "at");           // for pruning oldest-first
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);
const wrap = (req) => new Promise((res) => { req.onsuccess = () => res(req.result); req.onerror = () => res(null); });

// A short, stable id for a game+settings. FNV-1a over the position and the moves:
// the full text would make a needlessly long key, and we only need it to collide
// never in practice, not to be cryptographic.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

export function reviewKey({ startFen, moves, depth, engine }) {
  const game = startFen + "|" + moves.map((m) => m.uci).join("");
  // v2: reviews grew fields (est, afterLine, sacPiece, onlyGap) that v1 entries lack.
  // v3: `est` changed shape from a number to a {elo,lo,hi} band; v2 entries would
  //     render `undefined–undefined`, so they must miss and re-run.
  return "v3|" + (engine || "?") + "|d" + depth + "|" + fnv1a(game) + "|" + moves.length;
}

export async function getCached(key) {
  const db = await open();
  if (!db) return null;
  const hit = await wrap(tx(db, "readonly").get(key));
  if (!hit) return null;
  // Touch it, so the games you actually revisit are the ones that survive pruning.
  try { tx(db, "readwrite").put({ ...hit, at: Date.now() }); } catch (e) { /* not worth failing a hit over */ }
  return hit.res;
}

export async function putCached(key, res) {
  const db = await open();
  if (!db) return;
  try { await wrap(tx(db, "readwrite").put({ key, at: Date.now(), res })); }
  catch (e) { return; }                       // quota exceeded: a miss next time is fine
  await prune(db);
}

// Keep the cache bounded: drop the least-recently-used beyond KEEP.
async function prune(db) {
  const all = await wrap(tx(db, "readonly").index("at").getAllKeys());
  if (!all || all.length <= KEEP) return;
  const store = tx(db, "readwrite");
  for (const k of all.slice(0, all.length - KEEP)) store.delete(k);
}

export async function clearCache() {
  const db = await open();
  if (db) await wrap(tx(db, "readwrite").clear());
}

export async function cacheSize() {
  const db = await open();
  if (!db) return 0;
  return (await wrap(tx(db, "readonly").count())) || 0;
}
