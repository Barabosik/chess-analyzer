// Guards the review classifier. Every check here is a bug that actually shipped.
import { suite, open, openImport, loadPgn, review } from "./lib/harness.mjs";

const t = suite("classifier");
const { browser, page, errors } = await open();

const classes = () => page.evaluate(() =>
  [...document.querySelectorAll(".mv:not(.empty)")].map((m) => ({
    san: m.querySelector(".san").textContent,
    cls: m.querySelector(".cg") ? m.querySelector(".cg").textContent : "",
    ev: m.querySelector(".ev") ? m.querySelector(".ev").textContent : "",
  })));
const accuracy = () => page.evaluate(() => ({
  w: parseFloat(document.querySelectorAll("#accStrip .a b")[0].textContent),
  b: parseFloat(document.querySelectorAll("#accStrip .a b")[1].textContent),
}));

// ---------------------------------------------------------------------------
// Checkmate is a win, not a dead-equal position.
// A mated position has no legal moves, so the engine returns "bestmove (none)"
// with no pv. That used to read as 0.00 / 50% and made the MATING move look like
// it had thrown the game away: Scholar's mate scored White at 51% accuracy.
// ---------------------------------------------------------------------------
await loadPgn(page, '[White "W"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0');
await review(page);
{
  const rows = await classes();
  const mate = rows[rows.length - 1];
  const acc = await accuracy();
  t.ok("the mating move is not scored as a blunder",
    mate.cls !== "??" && mate.cls !== "?", mate.san + " -> " + JSON.stringify(mate.cls));
  t.ok("the mating move shows the result, not 0.00",
    mate.ev === "1-0", "eval " + JSON.stringify(mate.ev));
  t.ok("delivering mate does not wreck the mater's accuracy",
    acc.w > 85, "White " + acc.w + "% (was 51.1% with the bug)");
}

// ---------------------------------------------------------------------------
// Stalemate really is 0.00 — and stalemating a won position really is a blunder.
// ---------------------------------------------------------------------------
await loadPgn(page,
  '[White "W"]\n[Black "B"]\n[Result "1/2-1/2"]\n\n1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5 4. Qxc7 Rah6 ' +
  '5. h4 f6 6. Qxd7+ Kf7 7. Qxb7 Qd3 8. Qxb8 Qh7 9. Qxc8 Kg6 10. Qe6 1/2-1/2');
await review(page);
{
  const rows = await classes();
  const last = rows[rows.length - 1];
  t.ok("stalemating a winning position is a blunder worth 0.00",
    last.cls === "??" && last.ev === "0.00", last.san + " [" + last.cls + " " + last.ev + "]");
}

// ---------------------------------------------------------------------------
// Book moves must form an unbroken prefix of the game. Looking up positions
// without regard to the path left isolated "Book" moves stranded after non-book
// ones (9.O-O in this very game) — impossible in a real game, and it happened in
// 42% of games.
// ---------------------------------------------------------------------------
const SAMPLE = '[White "W"]\n[Black "B"]\n[Result "1-0"]\n\n' +
  '1. e4 e5 2. Nc3 Nc6 3. Nf3 Nf6 4. d4 exd4 5. Nxd4 Bb4 6. Nxc6 bxc6 7. Bd3 d5 ' +
  '8. exd5 O-O 9. O-O cxd5 10. Bg5 c6 11. Qf3 Bd6 12. Rae1 Rb8 13. b3 Bb4 14. Qg3 Be6 ' +
  '15. Qh4 h6 16. Bxh6 gxh6 17. Qxh6 Bxc3 18. Rxe6 Ne4 19. Rxe4 dxe4 20. Bxe4 f5 1-0';
await loadPgn(page, SAMPLE);
await review(page);
const first = await classes();
{
  const book = first.map((r) => r.cls === "◇");
  const lastBook = book.lastIndexOf(true);
  const contiguous = lastBook < 0 || book.slice(0, lastBook + 1).every(Boolean);
  t.ok("book moves form an unbroken prefix (no stranded Book move)",
    contiguous,
    "book plies: " + first.map((r, i) => (r.cls === "◇" ? i + 1 : null)).filter(Boolean).join(","));
  const ooIndex = 16;   // ply 17 = 9.O-O, the move that used to be wrongly Book
  t.ok("9.O-O is no longer Book (it is a transposition, not theory)",
    first[ooIndex].cls !== "◇", first[ooIndex].san + " -> " + JSON.stringify(first[ooIndex].cls));
}

// ---------------------------------------------------------------------------
// The same game must classify identically every time. The sacrifice test used to
// depend on the engine's chosen reply, which shifts between runs at the same
// depth as the hash table carries over — the same 10 games gave 8 Brilliants on
// one run and 5 on the next.
// ---------------------------------------------------------------------------
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready",
  null, { timeout: 90000 });
await loadPgn(page, SAMPLE);
await review(page);
const second = await classes();
{
  const same = first.length === second.length &&
    first.every((r, i) => r.cls === second[i].cls);
  const diff = first.map((r, i) => (second[i] && r.cls !== second[i].cls
    ? r.san + " " + r.cls + "->" + second[i].cls : null)).filter(Boolean);
  t.ok("reviewing the same game twice gives identical classifications",
    same, same ? first.length + " moves, byte-identical" : "differs: " + diff.join(", "));
}

// ---------------------------------------------------------------------------
// Brilliant means offering a piece and ending up down on the deal.
//   16.Bxh6! gives a bishop for two pawns — nets 1, and IS a sacrifice.
//   17.Qxh6, 19.Rxe4, 20.Bxe4, gxh6 are recaptures — they give up nothing.
// Requiring 2+ points of net loss killed the first; counting only the mover's own
// material promoted all of the second.
// ---------------------------------------------------------------------------
{
  const brilliant = second.filter((r) => r.cls === "!!").map((r) => r.san);
  // Recaptures and pawn grabs — none of these hands over a piece.
  // (Rxe6 is NOT in this list: it really is an exchange sacrifice, netting 2.)
  const trades = ["gxh6", "dxe4", "Bxe4", "Qxh6"];
  const fake = brilliant.filter((s) => trades.includes(s));
  t.ok("a real piece sacrifice IS Brilliant (16.Bxh6, bishop for two pawns)",
    brilliant.includes("Bxh6"), "Brilliant: [" + brilliant.join(", ") + "]");
  t.ok("plain recaptures are not Brilliant", fake.length === 0,
    fake.length ? "trades wrongly marked: " + fake.join(", ") : "none of " + trades.join(", "));
}

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");
await browser.close();
t.finish();
