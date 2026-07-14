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

## Estimated rating: removed, then re-added as a labelled estimate

Removed first: it mapped accuracy to Elo with `6.8 * exp(0.0575 * acc)`. Checked
against **64 real games spanning 280–3414 Elo** (every imported PGN carries the
players' true ratings): **mean absolute error 1072 Elo.** Two players 2500 points
apart produced the same accuracy (88.4% → real 322; 89.3% → real 2826), and the
curve tops out near 2100, so every strong player was under-rated by ~1700.

It is **not fixable by re-fitting**: accuracy does correlate with strength
(r = 0.63), but the best possible mapping still misses by ~850 Elo, because a quiet
game inflates accuracy and a sharp one deflates it whoever is playing. Single-game
accuracy cannot pin down a rating.

**Re-added by explicit request** (2026-07), with the error owned rather than hidden:
`estimateElo` in `review.js` maps mean win%-loss to `3150 * exp(-0.155 * L)`,
clamped to [250, 3200] and rounded to 50 — deliberately coarse. The curve is
*chosen, not fitted* (there is no fit worth making — see above); what it fixes over
the old one is the 2100 ceiling, so strong play can at least read strong. It shows
as "game rating ≈ N" under each accuracy, needs ≥ 8 judged moves, and the
ratingnote under the breakdown says plainly that one game misses by several hundred
points either way. A clean game by a 900 will read 2000+; that is the feature's
honest limit, and chess.com's equivalent does the same.

**Then shown as a band, not a lone number** (2026-07, after "played like 2k" feedback
on an ordinary game). The complaint was correct, and it is exactly the limit above: an
ordinary quiet game averages ~3% win% lost per move, and 3% maps to ~2000 whoever
played it, so one number reads as a verdict the data cannot support. Nothing here is
recalibratable. There is no corpus stored in the repo to re-fit against, and even the
best possible fit still misses by ~850, so moving the centre down would only guess, and
would under-rate strong play in the bargain. The honest lever is uncertainty, not a
lower number. `estimateElo` now returns `{elo, lo, hi}`, where the band is the game's
OWN spread: the standard error of its mean loss (`std/sqrt(n)`) mapped back through the
curve, so a consistent game reads tight and an erratic one wide. A half-width floor of
200 Elo keeps even a flawless-looking game from reading as a point. It shows as
"≈ lo–hi · provisional". The genuinely trustworthy number is a multi-game average
(variance falls with N), which is the pending "report card across games" work. Cache
key bumped v2→v3 because `est` changed shape from a number to a band.

**Not shown at all for a game against the bot** (2026-07, after a ≈400 bot game read
"1850–2500"). Two reasons compound there. The opponent's strength is one we SET, so
estimating it is absurd; and beating a bot that hangs pieces is easy to do accurately, so
the winner reads strong too. Worse, win%-loss SATURATES once a side is completely
winning or losing — each further move can only lose a sliver of an already-near-zero
win%, so blunders in a decided game stop counting and accuracy (hence the rating)
inflates. `renderSummary` detects the bot from its header name (`Stockfish (≈…)`) and
omits the band. `tests/rating.test.mjs` reviews a decisive bot-headed game and asserts
accuracy shows but no band does.

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

## The classification marks are drawn, not typed (`js/glyphs.js`)

The badges (board, breakdown, legend, coach card, flourish) used to show text
glyphs — ★ ✓ • ◇ !! ?! — centred with flexbox. Flexbox centres the *line box*; where
the shape sits inside its em box is up to whichever fallback font supplied that
character, and every one differs (the star low, the diamond high, the exclamation
marks thin and off-axis). That is why "every badge looked slightly misaligned" and
no CSS nudge fixed all of them at once. They are now inline SVGs from one 24×24
grid: centred by construction, identical on every platform, and the `!` / `!!`
finally have real weight. The move *list* keeps text glyphs — inline with text,
baseline-aligned, where fonts do the right thing — with a heavier face on `!`/`!!`
(`.cg.fat`). Tests read `data-g` on the flourish glyph now, not textContent.

## Modes: analyze / free board / play the engine

One switch above the import card. "Free board" makes a board move a move IN the
game (append, or rewrite-from-here when behind), so a hand-built line can be
analyzed like an imported one; the PGN box is kept in sync (`gamePgn`) so share
links keep working. "Play the engine" is a real game against a strength-limited
Stockfish, and the app tapes the engine's mouth shut while it runs: no eval bar, no
live lines, no review button until the game ends or you resign (`renderModeUi`).

Two things here are load-bearing:

- **Strength must not leak.** `Engine.play()` sets `UCI_Elo` / `Skill Level` for
  its one search and resets on its `bestmove`; `analyse()` and `live()` also assert
  full strength before every search. Without both halves, a review run after a bot
  game would be quietly scored by a 1200-rated engine — every evaluation subtly
  wrong and nothing to say why.
- **UCI_Elo floors at 1320**, so the sub-1300 settings fall back to Skill Level with
  short movetimes — a "beginner" that thinks for ten seconds reads as strong even when
  it isn't. The ≈-labels are estimates, not calibrated ratings.

**Skill Level 0 is not a beginner** (2026-07, after a "600 felt like 900-1k" report).
That was right: Stockfish's weakest setting still plays about 1000 to 1350, because
Skill Level only adds noise to move choice, it never hangs a piece the way a real
beginner does, and `UCI_Elo` cannot go below 1320. So the old "600 / 800" labels were
fiction. Below club strength the bot now drops a genuine blunder some fraction of the
time (`blunder` in `BOT_LEVELS`): with that probability `botMove` plays a uniformly
random legal move (`randomLegalMove`) instead of the engine's pick. A random move at
rate p strictly lowers move quality, which is the one thing that is certain here; the
rates (0.35 at ≈400 down to 0.05 at ≈1000) are chosen, not calibrated, because a bot's
true Elo can only be read from many games, the same honesty as the rating curve. Two
guards matter: the randomness lives ONLY in `botMove`, and `analyse`/`live` still
assert full strength before every search, so no evaluation is ever weakened; and the
random move is instant, which also reads right, since a beginner's blunder comes fast
rather than after a long think. The ladder gained a sub-600 rung (≈400) so a true
beginner has something to play.

## Interface decisions that were bugs in disguise

**The action and its result must be in the same place.** The move's verdict, the
engine's better move and the "Explain" button used to live in the *engine* panel on the
right, while the readout for that same move, and the walk-through Explain opened, lived
under the board on the left. Pressing a button on the right made the left-hand column
change — two halves of one thought, split across the page. They are now one **coach
card** (`.coach`) under the board: readout → verdict → "★ Bc4 was best · Explain" → the
walk-through, which opens *in place of* the button that summons it. The right column is
now purely engine and statistics.

**A brilliancy explains itself forwards.** A bad move gets a walk-through of the
line it should have played (`bestLine`, from before the move). A brilliant move IS
the best line, so that shape has nothing to show — what convinces is the line
*after* it: the opponent's best try failing. `afterLine` (the pv of the position
after the move, already searched) powers a "See why it works" row that reuses the
same Explain bar; the coach note names the piece offered (`sacPiece`) and, for a
Great, how much the second-best move gives up (`onlyGap`). Stored only for
brilliant/great to keep cached reviews small; cache key bumped v1→v2 for the new
fields.

**A knight's arrow bends.** Drawn straight, g1→f3 cuts diagonally across squares the
knight never visits and reads as a bishop move. It now turns a right angle — the long
leg first, then square into the target — the way Chess.com and Lichess draw it. Arrow
shafts are therefore `<polyline>`, not `<line>` (two points when straight, three when
bent); `tests/arrows.test.mjs` counts and shapes them.

## Review caching (`js/cache.js`)

A review is ~100 engine searches and a **pure function of (game, depth, engine)**, so it
is cached in IndexedDB and re-opening a game is instant. localStorage was the wrong
store: a reviewed game is 20–40 KB (each move carries its principal variation — that's
what makes "Explain" instant), so its ~5 MB ceiling would hold barely a hundred games
before throwing. LRU, 60 games.

**Every input that changes the answer is in the key** (`v1|engine|depth|hash|len`). The
worst bug this file could cause is silently serving a depth-12 review to someone who
asked for depth-22, so `tests/cache.test.mjs` pins exactly that: review at 12, ask for
16, assert it re-runs; then assert both are cached side by side. IndexedDB is refused
outright in some private windows — every call degrades to a no-op rather than failing.

## The shareable report card (`js/card.js`)

A 1200×630 PNG of how the game went, drawn on a canvas — **not** a screenshot of the
page. A screenshot is the wrong aspect ratio for a link preview, carries whatever theme
the user happens to be in, and shows chrome nobody wants to post. So the card is drawn
in a fixed dark palette and looks identical whoever made it. Class colours are still
read from the stylesheet (they are theme-independent), but the background must not be,
or a light-theme user would post a white card and a dark-theme user a black one.

The eval graph fills the area *under* the curve, the way chess sites do it, so White's
share of the game is literally the pale part; mistakes and blunders are dotted on it.

Two things a canvas gets wrong quietly, both fixed and worth remembering: a bare
`slice()` on the opening name cuts mid-word and leaves a dangling comma ("…Scotch
Variation Accepted,"), which reads as a bug rather than a long name — cut back to a word
boundary and add an ellipsis. And every W/B pair (`97% / 92.5%`, `36/29`) needs its
"WHITE / BLACK" legend *beside the numbers*, not stranded in a corner of the card.

`tests/card.test.mjs` decodes the PNG back and inspects the pixels — a canvas test
passes happily while drawing nothing, so it asserts the image is 2400×1260, has >40
distinct colours, and actually contains the pale eval-graph region.

## The engine pool, and the bias it uncovered

A review is ~100 **independent** positions, so it is split across a pool of separate
single-threaded engines — created for the review and torn down after it, because six
idle WASM instances would hold hundreds of MB for a machine that has stopped reviewing.
One engine stays behind for the live panel. Measured: **3.5x** (depth 14: 8.8s → 2.5s on
six; depth 18: 60.7s → 18.6s). The default review depth is therefore **16, not 14** —
the speedup is better spent on depth than on finishing early.

Two rules hold it together, and both are load-bearing:

**The partition is static.** Engine *k* takes every *N*th position, always. A dynamic
work queue would be slightly faster and would let the *scheduler* decide which engine
searches which position — so the evaluations would depend on timing and the same game
would review differently twice.

**The hash is cleared before every position, not once per review.** This looks like a
pure cost and is really a correctness fix. Position *i+1* is position *i* plus one move,
so its subtree was **already searched** as part of position *i*'s search. Carrying the
hash across handed the "after" position an effectively deeper search than the "before"
position it is compared against — and `loss` is precisely the difference between those
two. **The old sequential review was quietly flattering every move that was played.**

Clearing per position removes that bias *and* makes a position's evaluation independent
of who searched it and in what order. That is what lets one engine and six return
**bit-identical** results (`tests/pool.test.mjs` asserts exactly this: 0/103 labels,
evals, best-moves or accuracy differ), which in turn is why pool size is deliberately
**not** in the cache key — a cached review stays valid on any machine.

Cost of the fix, on the sample game at depth 14: accuracy **95.1/91.8 → 94.2/90.5**.
That is a correction, not a regression, and it is in the same family as the book-move fix.

## Threading: measured, and rejected

Multi-threaded Stockfish (`stockfish-18-lite.wasm` + `coi-serviceworker` to fake
COOP/COEP on Pages, which cannot send headers) looked like a free 4–8x. **It is the
opposite.** Measured on the sample game, depth 14, 103 plies, 10 cores:

| | time | reproducible |
|---|---|---|
| `Threads=1` (what ships) | **9.9 s** | yes — identical labels + evals |
| `Threads=8` | **53–61 s** | **no — 21 of 103 labels flipped between two runs** |

A review is ~100 *short* fixed-depth searches, and Lazy SMP's thread-sync overhead
dwarfs the useful work at that size; threads pay off in one *long* search, not many
small ones. And Stockfish is only reproducible at `Threads=1`, so it also reintroduces
the label-flipping the hash-clearing above exists to prevent. Don't reach for this again
without re-measuring.

The full-net builds (`stockfish-18.wasm`) are **107.8 MB** — over GitHub's hard 100 MB
per-file limit, and Pages does not resolve Git LFS pointers, so they cannot be
self-hosted here. unpkg does serve them with `cross-origin-resource-policy: cross-origin`,
and the worker takes its wasm URL from `self.location.hash`, so an opt-in "maximum
strength" engine is possible. Not yet measured for whether it changes any verdict.

## Things that are still suspect (unmeasured)

- **The accuracy formula's constants** (`103.1668 * exp(-0.04354 * avg) - 3.1669`)
  are inherited and unverified. Same treatment: measure before trusting.
- **`great`** (critical only-move) uses `gap >= 12` win% — never measured.
- **The phase boundaries** (`phaseOf`: endgame at ≤ 20 non-pawn material, opening = book
  length floored at ply 12 / capped at 24) are a presentation heuristic, picked not
  measured. They decide only which bucket a move is reported in, never its label.

## Fixed: book moves no longer inflate accuracy

They used to count as ~0%-loss moves of your own. They aren't your play — they are
theory you remembered, so the more of it you knew, the better your "accuracy" looked
without you having found anything over the board. Accuracy is now computed over non-book
moves only (`rows[]` carries the raw, unrounded loss, so overall and per-phase accuracy
come from the same numbers). Measured on the sample game at depth 14 (8 book moves of
103): **95.4/92.4 → 95.1/91.8**, so +0.3 White and +0.6 Black of inflation — small on a
lightly-booked game, and it grows with the amount of theory played.

## Opening explorer + endgame tablebase (`js/explorer.js`)

The one thing the engine could never tell you: not the best move, but the *popular* one,
and how it scores for humans at your level. Lichess exposes it free, key-less and
CORS-open, so the panel runs from the browser like everything else. Two sources, chosen
by piece count: over 7 pieces asks the opening explorer ("at your rating, N% play this",
with a white/draw/black result bar per move); 7 or fewer asks the tablebase, which is
*computed, not searched*, so its win/draw/loss verdict is exact and its distance is
DTZ (to the next pawn move or capture), not to mate. Clicking any move plays it on the
board, reusing the existing exploration line.

Three rules keep it from being annoying. It follows the board position but NOT the
engine on/off toggle (someone who muted the engine may still want opening stats), so it
refreshes from `restartLive` before that toggle's guard. It keeps the live panel's two
courtesies: silent during a competitive bot game and in a hidden tab. And because it is
a bonus, a failed request (offline, rate-limited) hides the panel rather than showing an
error. Requests are debounced 260ms so arrowing through a game does not fire one per
ply, and each `fen|band` result is cached for the session. The tablebase verdict is the
side-to-move's; a move's reported category is the *opponent's*, so it is flipped back to
the mover's POV before display (a move leaving the opponent "loss" is our win).

The tests mock both Lichess endpoints with `page.route`, and the harness blocks those
hosts by default so no other suite makes a live call — the suite stays offline and
reproducible, as the rest of it is.

**Live-verification status.** The tablebase shape was confirmed against the real API
(`category`/`dtz`/`checkmate`/`stalemate`, and each move's `category` in the opponent's
POV, which we flip). The opening explorer could NOT be reached from the build
environment: `explorer.lichess.ovh` answered `401` on every path while
`tablebase.lichess.ovh` answered `200`, which is Lichess rate-limiting/blocking the
explorer for datacenter IPs, not a bug here. So the explorer parser follows Lichess's
documented shape (`white`/`draws`/`black`, `opening`, `moves[].{uci,san,white,draws,
black,averageRating}`) and is exercised only against a mock. If a user's browser is
also refused, the panel degrades to hidden and only the tablebase half shows; that is
by design, but the explorer half is worth a real-browser check.

## Screenshot import + position editor (`js/boardscan.js`, editor in `js/app.js`)

Take a screenshot of a board and keep analysing from it. The feature is two halves: a
best-effort recognizer, and a confirm-board that makes an imperfect read safe.

**The recognizer reads a square by shape and colour separately, which is what makes it
theme-independent.** For each of the 64 cells: the background is the median of the four
corners (always board colour); foreground is pixels far enough from it (the piece ink);
occupancy is how much of the cell is foreground; the piece TYPE is whichever of the six
cburnett silhouettes the foreground mask overlaps best (we ship that art, so a Lichess
board matches its own SVGs by IoU); the piece COLOUR is read from luminance. Neither the
board's two colours nor the piece tint enters the type decision.

Two colour rules were each a wrong read first, found by the render-and-read-back test:
- **Adaptive luminance margin.** A fixed ±25 margin read White's back-rank pieces as
  black on light squares, because a light square (lum ~220) sits close to a white fill
  (~255) so most of the fill fell under the margin and the black outline won. The margin
  is now 35% of the headroom to pure white / black, so the fill is counted on light
  squares and the outline on dark ones.
- **Light-fill ratio, not majority.** An ornate white piece (bishop's slit, queen's
  crown) carries so much internal dark detail that its dark pixels outnumber its light
  fill, yet a black piece has almost no light fill. So colour is white when
  `lightCount * 4 >= darkCount` (a 1:4 ratio), not when light simply outweighs dark.

It assumes a clean digital board, white at the bottom. It trims a SOLID margin first
(`autoTrim` scans in from each edge while the whole row/column is one flat colour and
stops at the board's alternating edge), so a screenshot with a plain surround works; it
does not detect a board inside busy app chrome, read orientation, or read the side to
move. All of that is the editor's job, which is the point: the scan only has to get most
squares close.

**It refuses a nonsense read rather than prefilling it.** The first real paste was an
uncropped screenshot: every one of 64 cells caught fragments of the misaligned grid, so
all 64 read "occupied" with near-random silhouette matches (2% confidence), and the
editor opened with 64 wrong pieces to clear. A position has at most 32 pieces and never
fills the board, so `scanBoard` now returns `plausible` (`2 ≤ occupied ≤ 32` and
confidence ≥ 0.10); an implausible read opens the editor EMPTY with a plain "crop to just
the board" message instead. The honest limit stands: without real in-image board
detection it needs a tight crop, and it says so.

**The confirm-board is the reliable half, and is useful on its own** — pick a piece, click
squares, set who is to move, analyze; the first way to build an arbitrary position without
typing a FEN. Castling rights are not in a still image, so they are inferred (a side keeps
a right only if its king and the matching rook are on home squares). An illegal position
(`new Chess(fen)` throws) is refused with a plain reason rather than loaded. A scan lands
here pre-filled with its guess and a confidence figure; every scan failure also lands here
(empty), so the feature never dead-ends. Paste an image anywhere (⌘V) to scan it; only
image clipboard items are intercepted, so pasting a PGN still works.

The recognizer is tested by MAKING a screenshot: render a known FEN to a canvas with the
same cburnett art and assert `scanBoard` reads it back (opening position exactly, a
sparse endgame and a greyer theme within tolerance). The editor is driven end to end.

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
4. ~~**Lichess opening explorer**~~ — done, see the section above (also added the 7-piece
   endgame tablebase alongside it).

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
