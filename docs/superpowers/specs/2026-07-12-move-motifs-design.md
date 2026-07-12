# Move motifs: naming *why* a move was bad

## The problem

A blunder currently says:

> **Nf6** is a blunder — this drops material or the game. Nf3 was much stronger.

`coachNote()` (`js/app.js:451`) is a pure function of the move's *class*. Every blunder
in every game gets that same sentence. The app tells you **that** you erred and **what**
to play instead; it never tells you **why** the move lost, which is the only part a
player can learn from.

This is also the missing ingredient under the rest of the roadmap. Retry mode without
it is a guessing game. A cross-game report card without it is "your endgame accuracy is
76%", which nobody can act on. With it, the report card becomes a curriculum: *you lost
eight pieces to knight forks in thirty games.*

## What we are building

Per-move explanations in two directions, plus a per-game rollup:

- **Blame** — why the move you played lost: hung piece, losing exchange, fork, pin/skewer,
  allowed mate.
- **Missed chances** — what you failed to take: free material, a forced mate.
- **Rollup** — one line per game: *"All 3 blunders lost material the same way: pieces left
  undefended. Nothing was forked, nothing was pinned."*

## Non-goals

- No engine queries beyond the ones `reviewGame` already makes. Motifs must not slow a
  review down.
- No new vocabulary of "positional" motifs (weak squares, bad bishop, space). Those are
  not decidable from material and geometry, and a wrong one is worse than none.
- No retry/puzzle mode. Separate feature, separate spec, if ever.

## Detection is static, and that is the whole design

The obvious implementation asks the engine "what would you reply?" and blames the move
for whatever that reply wins. **`docs/NOTES.md` records that exact approach as Brilliant
bug #2**, and it was wrong twice over:

- It blames a move for material that was **already hanging**. The quiet pawn move `h3`
  was flagged a sacrifice with the material balance unchanged at 7 → 7.
- The reply is **not stable**. The same ten games gave 8 Brilliants on one run and 5 on
  the next.

Sacrifice detection was moved to static exchange evaluation for those reasons, and motif
detection inherits the lesson. Motifs are decided by **`seeGain` plus board geometry** —
reading only the position, exact, and identical on every run.

Two uses of engine data are still allowed, because neither is a *choice of move*:

- The **score** of a node (already computed) — used to know a mistake happened, and to
  say "this allows a forced mate in 3" without naming the mating move.
- **`mv.bestUci`** — the engine's best move in the position *before* the move. This is
  already computed, already hash-cleared and reproducible, and already on screen as
  "★ Be7 is best". Reusing it is not the discarded thing.

### The guard that makes or breaks the feature

**A motif fires only if the played move made things worse.** For each candidate, compare
the best static material gain available to the opponent *before* the move with the gain
available *after* it, and stay silent unless the move increased it.

Without this guard the feature reproduces the `h3` bug precisely: it would announce
"you hung the knight" on a quiet move played while the knight was already hanging. This
is the single most likely way this feature ships wrong.

Computing "what was already hanging" needs the opponent to move in `fenBefore`, so it is
evaluated on a **null-move FEN** (same position, side-to-move flipped, en-passant
cleared). That position can be illegal — for instance when the mover was in check — in
which case the comparison is abandoned and the motif does not fire. Silence, not a guess.

### Silence beats a wrong explanation

When nothing fires confidently, `coachNote()` falls back to today's generic sentence. The
feature never invents a reason it cannot prove from the position.

## `js/motifs.js`

A new module: pure, no DOM, no engine, no network. Small enough to hold in one screen and
to test in isolation, the way `review.js` is tested now.

```js
export function explainMove(mv, before, after)  // -> { kind, text } | null
export function rollup(moves, color)            // -> string | null
```

`before` and `after` are the engine nodes `reviewGame` already has in hand for the
positions either side of the move.

### Blame motifs

Fire on `inaccuracy` / `mistake` / `blunder`, analysing `mv.fenAfter` (opponent to move),
subject to the worse-than-before guard above.

| Motif | Decided by |
|---|---|
| **Hung piece** | The opponent can capture on square X and `seeGain` says the whole piece comes off — there is no adequate recapture. |
| **Losing exchange** | X is defended, but the exchange sequence still nets the opponent material. |
| **Fork / double attack** | Some opponent reply exists after which the piece that just moved attacks two of your pieces that are both winnable. The king counts as one of the two — that is the classic check-fork. |
| **Pin / skewer** | Geometric. After an opponent slider move, walk each ray from its square: if the first piece hit is yours and the second on the same ray is your king (pin) or a more valuable piece (skewer), it fires. |
| **Allowed mate** | The engine's *score* after the move is a forced mate for the opponent. Mate-in-1 is additionally confirmed statically. Never names the mating move. |

### Missed-chance motifs

| Motif | Decided by |
|---|---|
| **Missed free material** | `mv.bestUci` is a capture on square X **and** `seeGain(fenBefore, X) > 0`, and the played move was not that capture. |
| **Missed mate** | A forced mate for the mover existed before the move, and the move threw it away. |

Missed-free-material deliberately requires **both** conditions. `seeGain` alone would walk
straight into a poisoned piece — material that is winnable by exchange but loses to a
tactic. The engine's agreement rules that out; SEE proves the material was real. Either
test alone is unsafe.

### Rollup

Groups the mover's motifs across the game and states the pattern in one line, or says
nothing when there is no pattern and nothing when no motifs fired. It is deliberately the
same shape as the aggregation the cross-game Leak Report will need later.

## Changes to existing files

- **`js/review.js`** — export `seeGain` and `VAL` (both currently module-private); put
  `bestUci` on the reviewed move (currently a local); call `explainMove` and attach
  `mv.motif`. Classification logic is untouched.
- **`js/app.js`** — `coachNote()` prefers `mv.motif.text`, falling back to the current
  generic sentence; the rollup renders in the review summary.
- **`?v=N`** — bumped on every touched JS/CSS reference. NOTES.md records that forgetting
  this once cost an hour chasing a bug that did not exist in the code.
- **`docs/NOTES.md`** — updated with the measured numbers below.

## Testing

`tests/motifs.test.mjs`, following the existing convention: **one check per motif**, each
built from a PGN that produces the position, driven through the real app with the
`loadPgn` / `review` helpers in `tests/lib/harness.mjs`.

Two checks matter more than the rest and must exist:

- **The `h3` regression** — a quiet move played while a piece is already hanging must
  produce **no** motif. This is the guard, and it is the bug that already shipped once.
- **Determinism** — reviewing the same game twice produces identical motifs.

## The measurement gate

Every constant in `review.js` is the answer to a bug rather than a guess, because each one
looked fine until it was measured. Every heuristic in this spec is currently a guess.

So before this ships, it runs across a corpus of real games — drawn the same way the
earlier measurements in NOTES.md were (the bulk importer already pulls 30 games per
request from Chess.com and Lichess archives) — and reports, per motif:

- **fire rate** — how often it triggers,
- **precision** — a hand-checked sample, judged by playing the position out,
- **coverage** — what fraction of blunders get no explanation at all.

**The bar is set in advance: a motif ships only if its hand-checked sample is right.** A
motif that cannot clear it is cut, and the generic sentence stays for that case. Coverage
is a *reporting* number, not a target — chasing it is how you get a detector that invents
reasons.

**Pin/skewer is the one to expect to fail**, since a pin's material consequence usually
resurfaces as a plain hung piece a move later, which makes the two hard to attribute
cleanly. If it fails, it is cut rather than shipped wrong.

The resulting numbers go into `docs/NOTES.md` alongside the rest.
