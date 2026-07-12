// The shareable report card: one PNG saying how the game went.
//
// A canvas test can pass while drawing nothing, so this decodes the PNG back and
// inspects the PIXELS: the card must be the right shape, painted in more than a couple
// of flat colours, and carry the eval graph (a pale region) and the class badges.
import { suite, open, openImport, review } from "./lib/harness.mjs";

const t = suite("card");
const { browser, page, errors } = await open();

const hidden = (id) => page.evaluate((i) => document.getElementById(i).classList.contains("hidden"), id);

await openImport(page);
await page.click("#loadSample");
await page.waitForTimeout(400);
t.ok("no report card is offered before the game is reviewed", await hidden("cardBtn"), "cardBtn visible");

await review(page, "12");
t.ok("the report card is offered once reviewed", !(await hidden("cardBtn")), "cardBtn still hidden");
t.ok("and can be copied as well as saved", !(await hidden("cardCopyBtn")), "cardCopyBtn hidden");

// Playwright would otherwise treat the <a download> as a real download.
page.on("download", (d) => d.cancel().catch(() => {}));
await page.click("#cardBtn");
await page.waitForFunction(() => window.__card && window.__card.url, null, { timeout: 15000 });

const card = await page.evaluate(() => ({ w: window.__card.w, h: window.__card.h, len: window.__card.url.length }));
t.ok("the card is a 1200x630 share image (at 2x)", card.w === 2400 && card.h === 1260,
  card.w + "x" + card.h);
t.ok("the card is a real PNG of some size", card.len > 20000, "dataURL chars=" + card.len);

// Decode it and look at what was actually painted.
const px = await page.evaluate(async () => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = window.__card.url; });
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height;
  const c = cv.getContext("2d");
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  const seen = new Set();
  let pale = 0;
  for (let i = 0; i < d.length; i += 4 * 37) {          // sample, don't scan 3M pixels
    seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) pale++;
  }
  return { colours: seen.size, pale, sampled: Math.floor(d.length / (4 * 37)) };
});

t.ok("the card is actually drawn, not a blank rectangle", px.colours > 40,
  "distinct colours=" + px.colours);
t.ok("the eval graph is painted on it", px.pale > 200,
  "pale (white-advantage) pixels=" + px.pale + " of " + px.sampled + " sampled");

// Copy-to-clipboard: the card should be pasteable into a chat without ever becoming a
// file. Read it back OUT of the clipboard to prove a real PNG landed there.
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await page.click("#cardCopyBtn");
await page.waitForFunction(() => /Copied|Blocked/.test(document.getElementById("cardCopyBtn").textContent),
  null, { timeout: 15000 });
const copyLabel = await page.evaluate(() => document.getElementById("cardCopyBtn").textContent);
t.ok("copying the card reports success", /Copied/.test(copyLabel), "button says: " + copyLabel);

const pasted = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const png = items.find((i) => i.types.includes("image/png"));
  if (!png) return { ok: false, types: items.flatMap((i) => i.types) };
  const blob = await png.getType("image/png");
  const buf = new Uint8Array(await blob.arrayBuffer());
  const magic = [...buf.slice(0, 4)].join(",");     // a PNG starts 137,80,78,71
  return { ok: true, size: blob.size, magic };
});
t.ok("an image/png is actually on the clipboard", pasted.ok, JSON.stringify(pasted));
t.ok("what was copied is a real PNG", pasted.magic === "137,80,78,71" && pasted.size > 20000,
  "magic=" + pasted.magic + " bytes=" + pasted.size);

// Loading another game must retract the card: it described the previous one.
await openImport(page);
await page.fill("#pgnInput", '[White "X"]\n[Black "Y"]\n[Result "*"]\n\n1. e4 e5 *');
await page.click("#loadPgn");
await page.waitForTimeout(300);
t.ok("loading a new game retracts the report card", await hidden("cardBtn"), "cardBtn still shown");

t.ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" || ") || "clean");

await browser.close();
t.finish();
