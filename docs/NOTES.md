# Engineering notes

Why the analysis code is the way it is, and what's next. Read this before touching
`js/review.js` — most of its constants are the answer to a bug, not a guess.

## The rule that produced everything below

**Measure before changing, and again after.** Every heuristic in `review.js` was
wrong in a way that looked fine until it was measured against real games. The
numbers in the comments are real; re-derive them if you change the code.

`tests/classifier.test.mjs` asserts one bug per check. All of them shipped.

## Bugs that shipped, and what they taught

**Book was a property of the position, not the path.** `bookLookup` only asked "is
this position in the openings book?", so a game that left theory long ago could
transpose onto a named position and get an isolated "Book" move stranded among
non-book ones — impossible in a real game. It happened in **42% of 947 games**.

The naive fix (stop at the first unnamed position) is also wrong: the book names
~3,800 specific positions, not every position in a line — an unbroken chain of
named positions only reaches **ply 14** — so short holes appear *while you are
still in theory*. **64% of holes are exactly 2 plies.** Hence: book is an unbroken
prefix, short holes (≤ 4 plies) are bridged, and a move that costs ≥5% win
probability ends the book phase (otherwise a blunder landing on a named position
would be labelled Book, hiding it from the counts).

**Checkmate scored as a dead draw.** A mated position has no legal moves, so
Stockfish answers `bestmove (none)` with no pv, `best` came back `null`, and
`wpWhite(null)` returned 50. The mating move therefore looked like it had thrown
the game away: **Scholar's mate scored White at 51% accuracy.** Terminal positions
are now decided by the rules, not the engine. Stalemate keeps scoring 0.00 —
which the null produced by accident, and which is correct.

**"Best move" demanded an exact engine match.** A move the engine rates *exactly
equal* to its own was demoted to Excellent — 37 moves, 6% of all moves. Now judged
by evaluation with a 10cp tolerance. Moves that ARE the engine's move measure a
median 1cp of loss, so 10cp sits inside the search noise; 50cp would promote 35%
of all moves and make the label meaningless.

**"Brilliant" was wrong three separate times.** Worth spelling out, because each
fix looked complete and wasn't:

1. It compared only the **mover's own** material before and after, so "I take, you
   recapture" counted as a sacrifice. **8 of 12 Brilliants (67%) were plain trades.**
2. Trusting the engine's **best reply** blamed a move for material that was already
   hanging: the quiet pawn move `h3` was Brilliant with the material balance
   unchanged at 7 → 7. And the reply is not stable — the same 10 games gave **8
   Brilliants on one run and 5 on the next**, because the hash table carries over.
   Sacrifice is now decided by **static exchange evaluation**, which reads only the
   position: exact, and identical every run.
3. The remaining conditions made a real brilliancy unreachable. Requiring 2+ points
   of net material rejects a **bishop for two pawns** (nets 1) — the commonest
   brilliancy there is. And requiring the mover to be **+0.80 up afterwards**
   rejects every sound sacrifice that merely holds the balance. Across 6 real games
   that rule found exactly one Brilliant, and it was one played from an
   already-winning +4.88 — the single case that should *not* count.

   A brilliancy **offers a piece**, is **sound** (not worse afterwards), and is
   **not played from an already-winning position**.

**The live engine never stopped, and cooked the laptop.** The live panel ran
`go infinite`, which searches until it is told to stop or reaches Stockfish's max
depth (~245) — i.e. never. Nothing ever told it to stop: `restartLive` only halts the
*previous* search in order to start the next one. So a core sat at ~90% for as long as
the tab was open, on the last position you happened to look at, long after the review
had finished — and in a background tab you weren't even looking at. Measured: the
search settled at depth 20 and was still climbing (27) six seconds later.

The live search is now **capped at `LIVE_DEPTH` (20)**, so it converges, emits
`bestmove` and the worker sleeps; and it does not run at all while `document.hidden`.
Capping by *depth* rather than by a timeout is deliberate — a time limit would make the
panel's evaluation depend on how fast the machine is, which is the same
non-reproducibility the hash-clearing below exists to prevent. `tests/engine-idle.test.mjs`
pins both halves: depth stops climbing, and a hidden tab doesn't analyse.

**Reviews were not reproducible.** The engine's transposition table carried state
in from whatever was analysed before, so evaluations shifted a few centipawns and
moves near a class boundary flipped (`Be6 ✓→•`, `Qh4 ★→•`). `reviewGame` now clears
the hash first. Caught by the test suite on the day it was written.

## Removed: estimated rating

It mapped accuracy to Elo with `6.8 * exp(0.0575 * acc)`. Checked against **64 real
games spanning 280–3414 Elo** (every imported PGN carries the players' true
ratings): **mean absolute error 1072 Elo.** Two players 2500 points apart produced
the same accuracy (88.4% → real 322; 89.3% → real 2826), and the curve tops out near
2100, so every strong player was under-rated by ~1700.

It is **not fixable by re-fitting**: accuracy does correlate with strength
(r = 0.63), but the best possible mapping still misses by ~850 Elo, because a quiet
game inflates accuracy and a sharp one deflates it whoever is playing. Single-game
accuracy cannot pin down a rating. Don't add it back.

## Move motifs: naming why a move was bad (`js/motifs.js`)

A blunder used to say the same generic sentence every time. `explainMove` now names
the reason — hung piece, losing exchange, fork, allowed mate, missed material, missed
mate — and `coachNote` shows it in place of the generic line. A per-side rollup
(`rollup`) states the pattern when one motif dominates a game's mistakes.

**Detection is static, never the engine's reply.** Asking "what would the engine play
back?" is Brilliant bug #2 all over again: it blames a move for material that was
already hanging (the quiet `h3`) and its reply isn't stable between runs. So motifs are
decided by `seeGain` + geometry (`attackers`), reading only the position. The engine's
*score* is still used — to know a mistake happened, and for the two mate motifs, which
are therefore exact. Its *choice of move* is not.

**The load-bearing guards, each of which was a false positive first:**
- **Already-hanging.** A material motif fires only if the move increased what the
  opponent can win, compared on a null-move of the position before. Without it, a quiet
  move played while a piece hangs gets blamed for the hang.
- **Net of the grab.** An even recapture (Bxc6 … bxc6) reads as "hung a bishop" unless
  you credit what the move itself captured. Word by *net* material lost, not gross.
- **Class consistency.** A "free rook" on a move the engine rated a mere *inaccuracy* is
  a contradiction — the piece is compensated. Minor-piece+ material claims are suppressed
  on inaccuracies; missed-material fires on mistakes/blunders only.
- **You didn't miss what you took.** Missed-material is silent if the played move was
  itself a capture.
- **Fork must be real.** Only check-forks, and only when the checking piece can't be
  captured by an equal-or-cheaper piece (the check is then parried for free), and the
  second target is genuinely winnable. The fake fork this kills: a queen check on a
  diagonal that also "hits" the enemy queen is just a queen trade — the queen captures
  back (`Qf7+??` met by `Qxf7`). `detectFork` is exported and pinned in the test.

**Measured** on 10 real games (84 inaccuracy/mistake/blunder moves, depth 12): 24 got a
motif (**29% coverage** — the rest are positional, correctly silent), and every one of
the 24 was correct on hand-check (hung-piece ×6, allowed-mate ×5, fork ×4, missed-mate
×4, missed-material ×3, losing-exchange ×2). Coverage is a *reporting* number, not a
target — chasing it is how you get a detector that invents reasons. Re-derive these if
you touch the thresholds. `tests/motifs.test.mjs` pins the hung-piece and allowed-mate
wording, determinism, and the already-hanging guard.

Deferred on purpose: **pin/skewer** (its material usually resurfaces as a plain hung
piece a move later, so it's hard to attribute cleanly) and **non-check forks** (lower
precision without a deeper search).

## Interface decisions that were bugs in disguise

**The action and its result must be in the same place.** The move's verdict, the
engine's better move and the "Explain" button used to live in the *engine* panel on the
right, while the readout for that same move, and the walk-through Explain opened, lived
under the board on the left. Pressing a button on the right made the left-hand column
change — two halves of one thought, split across the page. They are now one **coach
card** (`.coach`) under the board: readout → verdict → "★ Bc4 was best · Explain" → the
walk-through, which opens *in place of* the button that summons it. The right column is
now purely engine and statistics.

**A knight's arrow bends.** Drawn straight, g1→f3 cuts diagonally across squares the
knight never visits and reads as a bishop move. It now turns a right angle — the long
leg first, then square into the target — the way Chess.com and Lichess draw it. Arrow
shafts are therefore `<polyline>`, not `<line>` (two points when straight, three when
bent); `tests/arrows.test.mjs` counts and shapes them.

## Things that are still suspect (unmeasured)

- **The accuracy formula's constants** (`103.1668 * exp(-0.04354 * avg) - 3.1669`)
  are inherited and unverified. Same treatment: measure before trusting.
- **Book moves count toward accuracy**, which inflates it. Arguably they shouldn't.
- **`great`** (critical only-move) uses `gap >= 12` win% — never measured.

## What's next, in order

1. **Retry mode.** At each mistake, hide the engine's move and make the player find
   it on the board (drag already works). Everything needed exists: classified moves,
   `previewBest`, click/drag-to-move. The one feature most likely to improve play.
2. **Report card across games + review caching.** 30 games arrive in one request,
   each with result, opening *and* clocks. Aggregate: which openings you lose in,
   which phase leaks eval, whether accuracy collapses in time trouble. Needs caching
   (re-opening a game currently re-runs ~100 engine searches).
3. **Mark where each side left theory** — now trustworthy, and one line of insight:
   "you left book on move 5, your opponent on move 9."
4. **Lichess opening explorer** (free, CORS-open, no auth): "at your rating, 62% play
   this here." The one thing the app can't currently tell you.

## Gotchas

- **A live search ends on its own, so the live handler must expect a `bestmove` it
  never asked for.** It now ends at `LIVE_DEPTH`; back when it was `go infinite` it
  still ended on a solved position, by racing to max depth (~245 — that stray "245" in
  the live panel). Either way a `bestmove` arrives unbidden. The handler used to ignore
  it, so `_busy` stayed stuck `true`, the next `abort()` waited forever for a `bestmove`
  that had already come, and the panel froze — even back on the main game. The live
  handler clears `_busy` on `bestmove`, and `abort()` has a timeout fallback so the UI
  can never hang on a lost one. Pinned by `tests/engine-explore.test.mjs`.
- **Depth is the only honest "is the engine still working?" signal — and only while it
  is climbing.** The panel keeps showing the last search's numbers after it finishes
  (deliberately: no flicker when you tab back), so a stale `depth 20` proves nothing
  about whether a search is running *now*. `engine-idle` tests the paused case by
  loading a forced mate and asserting the eval does *not* turn into a mate score.
- **The "stronger move" suggestion only shows on a real mistake** (`showBetter`).
  Without that gate it told you your best move was "excellent" and then pointed at a
  *worse* move labelled "best" — because the played-move eval and the pre-move best-line
  eval come from different searches and aren't directly comparable near equality.


- **Bump `?v=N` on every JS/CSS change** (`sed -i '' 's/?v=N/?v=N+1/g' js/*.js index.html`).
  Forgetting it once cost an hour: a stale cached module produced a bug that did not
  exist in the code, and the error message pointed somewhere else entirely.
- **Chess.com has no public single-game endpoint.** Its internal `callback/live/game/{id}`
  sends no CORS header (verified from a real browser origin), so games can only be
  found by scanning a *player's* monthly archives. That's why a chess.com link needs
  `?username=`. Lichess has a proper `/game/export/{id}`.
- **Chess.com game IDs are not ordered by date** — ID ranges overlap month to month
  for active players, so the archives cannot be bisected. It has to be a scan.
- **Grid/flex items default to `min-width: auto`** and will happily shove the page
  sideways. This caused a horizontal overflow on phones (565px of content on a 390px
  screen) that predated any of this work.
