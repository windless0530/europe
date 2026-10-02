// 调色板全图截图：代表性年份各一张（SHOT_PREFIX 区分 before/after 对比组）。
// 用法：先 npm run dev，再 SHOT_PREFIX=pal-after node scripts/palette-shots.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);

const prefix = process.env.SHOT_PREFIX ?? 'pal';
for (const y of [-300, 1000, 1500, 2026]) {
  await page.locator('#tl-range').fill(String(y));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `chromium/${prefix}-${y}.png` });
  console.log(`✓ ${prefix}-${y}.png`);
}

await browser.close();
