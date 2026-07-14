// A game against the bot must NOT show a game-rating band: the opponent's strength is
// one we set (≈400), and beating a piece-hanging bot makes anyone read strong, so the
// number is noise. The review still runs and accuracy still shows — only the rating is
// suppressed. (That the band DOES appear for an ordinary game is covered by layout.test.)
import { suite, open, loadPgn, review } from "./lib/harness.mjs";

const t = suite("rating");
const { browser, page, errors } = await open();

// The Opera Game — decisive, long enough that both sides clear the 8-judged-move floor,
// so a rating band WOULD show if it weren't suppressed. Headers name White as the bot.
const BOT_PGN = `[White "Stockfish (≈400)"]
[Black "You"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

await loadPgn(page, BOT_PGN);
await review(page, "12");

const accText = await page.textContent("#accStrip");
const estCount = await page.$$eval("#accStrip .est", (e) => e.length);

t.ok("the review ran (accuracy is shown)", /%/.test(accText || ""), JSON.stringify(accText));
t.ok("a game vs the bot shows NO game-rating band", estCount === 0, estCount + " .est elements");

t.ok("no uncaught page errors", errors.length === 0, errors.join("; ") || "clean");

await browser.close();
t.finish();
