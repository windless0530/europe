// 调色板多样性 DOM 定量：指定年份全图着色 -> 每色的几何数/族群，验证「同年同色异族群=0」与色彩数。
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);

for (const y of [-300, 1000, 1500, 2026]) {
  await page.locator('#tl-range').fill(String(y));
  await page.waitForTimeout(400);
  const stats = await page.evaluate(() => {
    const UNPAINTED = 'rgb(236, 235, 231)';
    const byColor = new Map();
    for (const el of document.querySelectorAll('path.region')) {
      const f = el.style.fill;
      if (!f || f === UNPAINTED) continue;
      byColor.set(f, (byColor.get(f) ?? 0) + 1);
    }
    return { painted: [...byColor.values()].reduce((s, n) => s + n, 0), colors: byColor.size, perColorMax: Math.max(...byColor.values()) };
  });
  console.log(`${y}: 着色几何 ${stats.painted}，不同颜色 ${stats.colors}，单色最多几何 ${stats.perColorMax}`);
}
await browser.close();
