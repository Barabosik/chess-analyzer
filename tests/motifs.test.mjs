// Motif detection: naming WHY a move went wrong. Each check is built from a
// position that produces the motif, driven through the real app, reading the
// coach note the user actually sees (#assessNote). One check per motif, plus the
// two guarantees the spec calls mandatory: determinism, and the "already hanging"
// guard that must NOT blame a quiet move for a pre-existing hang.
import { suite, open, loadPgn, review } from "./lib/harness.mjs";
import { detectFork } from "../js/motifs.js?v=20";

const t = suite("motifs");
const { browser, page, errors } = await open();

// The note shown when you stand on a given ply.
async function noteAt(ply) {
  await page.click('.mv[data-ply="' + ply + '"]');
  await page.waitForTimeout(60);
  return page.evaluate(() => document.getElementById("assessNote").textContent.trim());
}
// Every blame-class move with its class and note — for eyeballing precision.
const blameNotes = () => page.evaluate(() =>
  window.__moves.filter((m) => ["inaccuracy", "mistake", "blunder"].includes(m.cls))
    .map((m) => ({ no: m.moveNo, san: m.san, color: m.color, cls: m.cls,
      kind: m.motif ? m.motif.kind : null, text: m.motif ? m.motif.text : null })));

// --- hung piece: 3.Qxe5+ grabs a pawn and hangs the queen to Nxe5 -----------
await loadPgn(page, '[White "W"]\n[Black "B"]\n[Result "0-1"]\n\n1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5 0-1');
await review(page, "12");
const assessBestShown = () => page.evaluate(() => {
  const e = document.getElementById("assessBest");
  return !!e && !e.classList.contains("hidden");
});
{
  const note = await noteAt(5);           // 3.Qxe5+ (a blunder)
  t.ok("hanging the queen is named a hung piece", /queen/i.test(note) && /hangs/i.test(note), note);
  t.ok("a blunder suggests a stronger move", await assessBestShown(), "assessBest hidden on a blunder");
  await noteAt(6);                         // 3...Nxe5 wins the queen back — a best move
  t.ok("a best move does not suggest a worse alternative", !(await assessBestShown()),
    "assessBest shown on a best move");
}

// --- allowed mate: Scholar's mate, 3...Nf6 lets Qxf7# in ---------------------
await loadPgn(page, '[White "W"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0');
await review(page, "12");
{
  const note = await noteAt(6);           // 3...Nf6
  t.ok("a move that permits mate is named an allowed mate", /forced mate/i.test(note), note);
}

// --- determinism: the same game reviewed twice gives identical motifs -------
const SAMPLE = '[White "W"]\n[Black "B"]\n[Result "1-0"]\n\n' +
  '1. e4 e5 2. Nc3 Nc6 3. Nf3 Nf6 4. d4 exd4 5. Nxd4 Bb4 6. Nxc6 bxc6 7. Bd3 d5 ' +
  '8. exd5 O-O 9. O-O cxd5 10. Bg5 c6 11. Qf3 Bd6 12. Rae1 Rb8 13. b3 Bb4 14. Qg3 Be6 ' +
  '15. Qh4 h6 16. Bxh6 gxh6 17. Qxh6 Bxc3 18. Rxe6 Ne4 19. Rxe4 dxe4 20. Bxe4 f5 1-0';
await loadPgn(page, SAMPLE);
await review(page, "12");
const run1 = await page.evaluate(() => window.__moves.map((m) => m.motif ? m.motif.text : ""));
await loadPgn(page, SAMPLE);
await review(page, "12");
const run2 = await page.evaluate(() => window.__moves.map((m) => m.motif ? m.motif.text : ""));
t.ok("motifs are byte-identical across two reviews of the same game",
  JSON.stringify(run1) === JSON.stringify(run2),
  "run1 != run2");

// --- the guard: a quiet move played while a rook is ALREADY hanging must not
//     be blamed for hanging it. Black's Ra8 sits en prise to Bxa8 the whole
//     time; ...h6 (a mistake here) changes nothing about that, so no hung-piece.
await loadPgn(page,
  '[SetUp "1"]\n[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 0 1"]\n' +
  '[Result "*"]\n\n1... h6 2. d3 *');
await review(page, "12");
{
  const bn = await blameNotes();
  const h6 = bn.find((m) => m.san === "h6");
  // whatever else it may be, it must NOT be attributed as hanging a piece
  t.ok("a quiet move is not blamed for a pre-existing hang",
    !h6 || h6.kind !== "hung-piece", JSON.stringify(h6));
}

// --- fork detector: a "fork" the forked piece can just capture is not a fork.
// The reported Qf7+?? case (met by Qxf7) must NOT be called a fork; a genuine
// knight check-fork must still fire.
t.ok("a queen check the enemy queen captures back is not a fork",
  detectFork("5Q2/8/6k1/8/2qb3P/5RP1/P1P2PK1/4r3 w - - 0 40", "b") === null,
  JSON.stringify(detectFork("5Q2/8/6k1/8/2qb3P/5RP1/P1P2PK1/4r3 w - - 0 40", "b")));
t.ok("a real knight check-fork still fires",
  (detectFork("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b") || {}).victim === "r", "Nc7+ should fork Ke8 + Ra8");

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
