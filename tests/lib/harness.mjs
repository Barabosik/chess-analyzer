// Shared helpers for the end-to-end suites.
import { chromium } from "playwright";

export const BASE = process.env.BASE || "http://localhost:8787";

export function suite(name) {
  const results = [];
  return {
    ok(label, pass, detail = "") {
      results.push({ label, pass, detail });
      console.log((pass ? "  PASS " : "  FAIL ") + label + (detail ? "\n         -> " + detail : ""));
    },
    finish() {
      const failed = results.filter((r) => !r.pass);
      console.log("\n" + name + ": " + (results.length - failed.length) + "/" + results.length + " passed");
      if (failed.length) process.exit(1);
    },
  };
}

export async function open({ viewport = { width: 1440, height: 1400 }, device } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext(device ? { ...device } : { viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await ready(page);
  return { browser, page, errors };
}

// The engine is a 7MB WASM worker; nothing works until it has booted.
export const ready = (page) => page.waitForFunction(
  () => document.getElementById("engineStatus").textContent === "ready",
  null, { timeout: 90000 });

// The import card folds away once a game is open; reopen it before using it.
export async function openImport(page) {
  if (await page.locator("#impBar").isVisible().catch(() => false)) {
    await page.click("#impToggle");
    await page.waitForTimeout(80);
  }
}

// Wait for an import to stop being in-flight (it streams progress messages).
export const settle = (page, timeout = 90000) => page.waitForFunction(() => {
  const m = document.getElementById("acctMsg");
  return m && !m.classList.contains("hidden") &&
    !/Fetching|Searching|Looking through/.test(m.textContent);
}, null, { timeout });

export const moveCount = (page) => page.locator(".mv:not(.empty)").count();

export async function loadPgn(page, pgn) {
  await openImport(page);
  await page.fill("#pgnInput", pgn);
  await page.click("#loadPgn");
  await page.waitForTimeout(400);
}

export async function review(page, depth = "12") {
  await page.selectOption("#depthSel", depth);
  await page.click("#reviewBtn");
  await page.waitForSelector("#summary:not(.hidden)", { timeout: 300000 });
}
