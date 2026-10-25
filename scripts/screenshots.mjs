// Captures every Settings page and the companion window from a running
// `npm run dev:ui` server, for before/after visual comparisons.
// Usage: node scripts/screenshots.mjs <output-directory> [width] [height] [--full]
// --full captures whole pages (fixed sidebar/save bar then appear mid-page).
// EVA_UI_URL points at another dev server (default http://127.0.0.1:5173).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const fullPage = args.includes("--full");
const [outdir, width = "1280", height = "860"] = args.filter(
  (arg) => arg !== "--full",
);
if (!outdir) throw new Error("Pass an output directory.");
const base = process.env.EVA_UI_URL ?? "http://127.0.0.1:5173";
mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.EVA_TEST_BROWSER,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
});
await page.goto(`${base}/?window=settings`);
await page.waitForTimeout(2500);
const pages = page.locator(".sidebar nav button");
const count = await pages.count();
for (let i = 0; i < count; i++) {
  const button = pages.nth(i);
  const label = (await button.innerText()).trim().replace(/[^a-z0-9]+/gi, "-");
  await button.click();
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(outdir, `${String(i).padStart(2, "0")}-${label}.png`),
    fullPage,
  });
}
await page.goto(`${base}/?window=companion`);
await page.setViewportSize({ width: 520, height: 820 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(outdir, "99-companion.png") });
await browser.close();
console.log(`Saved ${count + 1} screenshots to ${outdir}`);
