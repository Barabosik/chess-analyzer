# Contributing to Chess Analyzer

Thanks for your interest in improving Chess Analyzer! Pull requests are welcome,
whether it's a bug fix, a new feature, or a docs tweak.

## Ways to contribute

- **Bug fixes** — something rendering wrong, a PGN that won't parse, a broken control.
- **Features** — new piece sets, more engine/analysis options, opening names,
  per-move time from PGN clocks, PGN export of the annotated game, an openings graph, etc.
- **Polish** — accessibility, mobile layout, keyboard shortcuts, theming.
- **Docs** — clearer README, examples, screenshots.

If you're planning something big, open an issue first so we can agree on the approach
before you spend time on it.

## Development setup

There is **no build step** — it's plain HTML, CSS, and ES modules. You just need to
serve the folder over HTTP (ES modules and the WASM worker won't load from `file://`):

```bash
git clone https://github.com/Barabosik/chess-analyzer.git
cd chess-analyzer
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works (`npx serve`, VS Code Live Server, etc.).

## Project structure

```
index.html            markup + layout
css/style.css         theme tokens, board, panels (light & dark)
js/engine.js          UCI wrapper around the Stockfish Web Worker
js/review.js          full-game review + move classification + accuracy
js/board.js           FEN -> board rendering, highlights, click-to-move
js/app.js             UI state, PGN/FEN import, navigation, live analysis
vendor/               chess.js, Stockfish 18 lite WASM, cburnett pieces
```

## Testing your change

There's an end-to-end suite. It drives a real browser against a real Stockfish, so it
exercises the app the way you do — no mocks.

```bash
npm install
npm run test:setup     # downloads Chromium (once)
npm test               # runs everything
npm test drag links    # or just the suites whose names match
```

The app itself still has **no dependencies and no build step** — `package.json` exists
only for the tests, and the suite serves the folder itself.

| suite | what it protects |
|---|---|
| `classifier` | checkmate scores as a win; book moves form an unbroken prefix; Brilliant means a real sacrifice; the same game reviews identically twice |
| `import` | username import from Chess.com / Lichess, and a full review end to end |
| `links` | opening one game from a pasted link, and the errors when that can't work |
| `share-and-clocks` | short pointer links, gzipped PGN links, per-move clock times |
| `drag` | drag-and-drop and click-to-move, legal and illegal drops |
| `touch` | dragging with a finger on a phone viewport |
| `layout` | board and moves visible together; move text never overlaps its glyph |

Some suites hit the live Chess.com and Lichess APIs, so they need a network connection.

Every check in `classifier.test.mjs` is a bug that actually shipped — if you touch
`review.js`, run it. And when you fix a bug, add the assertion that would have caught it.

## Coding style

- Vanilla JS, ES modules, **no framework and no build tooling** — please keep it that way.
- Avoid adding runtime dependencies. Vendored libraries live in `vendor/` and are pinned.
- Match the surrounding style: 2-space indent, descriptive names, small focused functions.
- Style through the CSS custom properties (theme tokens) so light and dark both work.
- Keep pieces/assets **freely licensed** (GPL / CC / public domain). Do not add
  proprietary assets (e.g. images or fonts copied from other chess sites).

## Submitting a pull request

1. Fork the repo and create a branch: `git checkout -b my-change`.
2. Make your change; keep the PR focused on one thing.
3. Test it by hand (see above) and mention what you checked in the PR description.
4. Open the PR against `main` with a clear title and a short description of the what and why.

## License

Chess Analyzer is licensed under the **GNU General Public License v3** (because it bundles
Stockfish). By contributing, you agree that your contributions are licensed under GPLv3 too.
