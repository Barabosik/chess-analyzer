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

There's no automated test suite yet, so please test by hand before opening a PR.
Serve the app locally and check the flows your change touches, at minimum:

1. The page loads with **no errors** in the browser console.
2. **Load sample**, then **Analyze game** — the review completes and shows accuracy,
   move classifications, the coach bubble, and the evaluation graph.
3. Step through moves (`←` / `→`, clicking moves, the eval graph).
4. Import works: paste a PGN, upload a `.pgn`, and load a FEN.
5. Both **light and dark** themes still look right (toggle top-right).

Adding a lightweight automated test (e.g. a Playwright/Puppeteer smoke test) is itself
a very welcome contribution.

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
