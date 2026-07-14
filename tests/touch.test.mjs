import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:8787";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
await ctx.route(/(explorer|tablebase)\.lichess\.ovh/, (r) => r.abort());  // stay offline: no live explorer calls
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.getElementById("engineStatus").textContent === "ready",
  null, { timeout: 90000 });
await page.locator("#board").scrollIntoViewIfNeeded();

// Real touch-typed pointer events, the way a finger produces them.
async function touchDrag(from, to) {
  const c = async (sq) => {
    const b = await page.locator('[data-sq="' + sq + '"]').boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const a = await c(from), b = await c(to);
  await page.evaluate(([a, b, from]) => {
    const opts = (x, y) => ({
      pointerId: 1, pointerType: "touch", isPrimary: true,
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1,
    });
    const sq = document.querySelector('[data-sq="' + from + '"]');
    sq.dispatchEvent(new PointerEvent("pointerdown", opts(a.x, a.y)));
    for (let i = 1; i <= 6; i++) {
      const x = a.x + ((b.x - a.x) * i) / 6, y = a.y + ((b.y - a.y) * i) / 6;
      window.dispatchEvent(new PointerEvent("pointermove", opts(x, y)));
    }
    window.dispatchEvent(new PointerEvent("pointerup", { ...opts(b.x, b.y), buttons: 0 }));
  }, [a, b, from]);
  await page.waitForTimeout(150);
}

await touchDrag("e2", "e4");
const r = await page.evaluate(() => ({
  e4: document.querySelectorAll('[data-sq="e4"] .pc').length,
  e2: document.querySelectorAll('[data-sq="e2"] .pc').length,
  line: document.getElementById("exploreTxt").textContent,
  stuck: document.querySelectorAll(".pc.dragging").length,
}));
const touchAction = await page.evaluate(() =>
  getComputedStyle(document.getElementById("board")).touchAction);

const pass = r.e4 === 1 && r.e2 === 0 && /e4/.test(r.line) && r.stuck === 0;
console.log((pass ? "PASS" : "FAIL") + " touch-drag on iPhone viewport plays the move");
console.log("  e4 piece:", r.e4, "| e2 piece:", r.e2, "| line:", JSON.stringify(r.line),
            "| stuck:", r.stuck);
console.log("  board touch-action:", touchAction, "(must be 'none' or the drag would scroll the page)");
console.log("  page errors:", errs.length ? errs.join(" || ") : "none");

await browser.close();
process.exit(pass && touchAction === "none" && !errs.length ? 0 : 1);
