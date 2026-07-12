# Move-quality flourish: the board reacts when you play a great move

## The problem

When you step onto a Brilliant, the board does nothing. The move list shows `!!`, the
assessment panel writes a sentence, and a small badge appears in the corner of the
destination square — but the board itself is silent. Chess.com makes the moment land: the
square floods with colour, the glyph punches in, a label says **Brilliant!**, and it fades
to leave both squares tinted in the class colour.

Two concrete gaps:

1. **The last-move highlight is class-blind.** `.sq.hl` (`css/style.css:171`) paints one
   fixed `--hl` colour for every move — brilliant and blunder get the same wash. The
   resting state we want is the *class* colour on both squares.
2. **There is no flourish.** Nothing like it exists.

The resting corner badge from the reference screenshots already exists (`.badge`, drawn in
`js/board.js`) and needs no work.

## Colours

Requested: `#26c2a3` for Brilliant, `#749bbf` for Great.

- `--brilliant` is **already exactly `#26c2a3`** (`css/style.css:7`). No change.
- `--great` is `#5c8bb0` and becomes **`#749bbf`**.

`--great` is also read by the move list, the eval graph dots and the time graph, all of
which pick it up from the variable. Changing it in one place is the whole change.

## What we are building

- **Brilliant and Great flourish.** Fill, glyph, label bubble, fade.
- **Every class keeps** its corner badge and gains class-coloured resting squares.

Only the two rare classes animate. If every move pops, none of them land — and "Good"
fires dozens of times a game.

## Design

### Resting state

`renderBoard` already knows the move's class, since it draws the badge from it. The
highlighted squares get a CSS custom property, `--hl-col`, set from the class colour, and
`.sq.hl` paints that instead of the fixed `--hl`. Both squares take it — origin and
destination — so a Brilliant leaves a teal pair and a Great leaves a blue pair. Moves with
no classification (an unreviewed game, or the exploration board) fall back to today's
neutral highlight.

### The flourish

A single overlay element on the destination square, driven by one CSS keyframe:

1. the square fills with the class colour at full saturation,
2. the glyph (`!!` / `!`) scales up inside it,
3. a rounded label bubble — **Brilliant!** / **Great!** — pops in beside it,
4. it holds for a beat, then fades.

**The resting tint is painted underneath, not applied afterwards.** So the fade-out has
nothing to hand off to and needs no completion callback — it simply reveals the tinted
square already beneath it. This removes the one piece of state that would otherwise have
to survive the animation.

The bubble is clamped so it cannot overflow the board edge on a- and h-file squares.

### Two things that will bite otherwise

- **Rapid navigation.** Clicking down the move list fires a flourish per move. They must
  cancel, not stack, so the flourish is keyed to a token that any new render invalidates.
- **Reduced motion.** `css/style.css:333` already honours `prefers-reduced-motion` — but
  the rule is `*{transition:none !important}`, which kills *transitions* and not
  *animations*. As written, the flourish would still fire for someone whose OS asked for
  no motion. The rule needs `animation:none` alongside it.

## Changes to existing files

- **`css/style.css`** — `--great` recoloured; `.sq.hl` reads `--hl-col`; flourish keyframes,
  fill, glyph and bubble; the `prefers-reduced-motion` fix.
- **`js/board.js`** — set `--hl-col` on highlighted squares; render the flourish overlay
  when asked.
- **`js/app.js`** — trigger the flourish on move navigation, with the cancellation token.
- **`?v=N`** — bumped on every touched JS/CSS reference (see the NOTES.md gotcha).

Independent of `js/motifs.js`; this ships as its own commit.

## Testing

Added to the existing Playwright suite, which already drives the real app and takes
screenshots:

- Stepping onto a Brilliant paints **both** squares `#26c2a3` and shows the `Brilliant!`
  bubble; a Great paints them `#749bbf`.
- A Good move gets its badge and tinted squares and **no** flourish element.
- Clicking rapidly through the move list leaves **exactly one** flourish in the DOM — the
  stacking regression.
- Under `prefers-reduced-motion: reduce`, no flourish animates.
- The bubble stays inside the board for a move onto the a-file and the h-file.
