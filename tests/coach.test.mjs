// The plain-English "what to work on" summary (js/summary.js). It is a PURE function of
// the review, so this drives it directly with crafted data — no engine needed — and
// checks it names the turning point, the dominant pattern, and an actionable fix.
import { suite, open } from "./lib/harness.mjs";

const t = suite("coach");
const { browser, page, errors } = await open();

// Run gameSummary(color, ctx) in-page and return its string.
const summarize = (color, ctx) => page.evaluate(async ({ color, ctx }) => {
  const { gameSummary } = await import("/js/summary.js");
  return gameSummary(color, ctx);
}, { color, ctx });

// A game where White hangs pieces, rushing the errors, worst in the middlegame.
const hung = (san, moveNo, loss) =>
  ({ color: "w", cls: loss > 20 ? "blunder" : "mistake", loss, moveNo, san, spent: 3,
     motif: { kind: "hung-piece", text: "This hangs your " + (san[0] === "B" ? "bishop" : "rook") + "." } });
const moves = [];
for (let i = 0; i < 8; i++) moves.push({ color: "w", cls: "good", loss: 1, moveNo: i + 1, san: "Nf3", spent: 12 });
for (let i = 0; i < 8; i++) moves.push({ color: "b", cls: "good", loss: 2, moveNo: i + 1, san: "e5", spent: 9 });
moves.push(hung("Bxh6", 16, 35), hung("Bd3", 19, 12), hung("Rd1", 22, 11));

const review = {
  accWhite: 82, accBlack: 90,
  phases: {
    opening: { w: { acc: 95, n: 6 }, b: { acc: 92, n: 6 } },
    middlegame: { w: { acc: 70, n: 8 }, b: { acc: 88, n: 8 } },
    endgame: { w: null, b: null },
  },
};
const ctx = { moves, review, opening: ["C46", "Four Knights Game"], headers: { White: "Niknerf", Black: "Opp" } };
const text = await summarize("w", ctx);

t.ok("names the player and accuracy", /Niknerf played at 82%/.test(text || ""), text);
t.ok("frames it by the opening", /Four Knights Game/.test(text || ""), text);
t.ok("calls out the turning-point move", /move 16: Bxh6/.test(text || ""), text);
t.ok("states the dominant pattern", /3 of 3 costly moves left a piece undefended/.test(text || ""), text);
t.ok("gives an actionable 'Work on' line", /Work on: .*defended/.test(text || ""), text);
t.ok("notices the errors were rushed", /quick moves/.test(text || ""), text);

// A clean game with no mistakes → encouraging, no invented weakness.
const cleanMoves = [];
for (let i = 0; i < 10; i++) cleanMoves.push({ color: "w", cls: "best", loss: 1, moveNo: i + 1, san: "Nf3" });
const clean = await summarize("w", { moves: cleanMoves, review: { accWhite: 97, accBlack: 80, phases: null }, opening: null, headers: {} });
t.ok("a clean game gets an encouraging note, not a fake weakness",
  /clean game/i.test(clean || "") && !/Work on/.test(clean || ""), clean);

// Too little to judge → null (the card then hides).
const tiny = await summarize("w", { moves: [{ color: "w", cls: "good", moveNo: 1, san: "e4" }], review: { accWhite: 100, phases: null }, opening: null, headers: {} });
t.ok("returns null when there's not enough game to judge", tiny === null, JSON.stringify(tiny));

t.ok("no uncaught page errors", errors.length === 0, errors.join("; ") || "clean");

await browser.close();
t.finish();
