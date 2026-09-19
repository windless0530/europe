// Demo 冒烟驱动：headless Edge 打开 localhost:5173。
// 验证：启动进度层 -> 族群分布模式（SQL）渲染 -> 时间轴/hover 零网络请求
//       -> 几何浏览模式仍可用 -> 中英切换。截图到 chromium/。
// 用法：先 npm run dev，再 node scripts/smoke-demo.mjs

import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173/';
const errors = [];
let requestCount = 0;
let requestGateOpen = false;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', () => {
  if (requestGateOpen) requestCount++;
});

await page.goto(BASE, { waitUntil: 'load' });

// 等启动进度层完成、地图出现
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'chromium/smoke-1-atlas-450.png' });

// ---- 零网络验证：加载完成后，时间轴 + hover + 缩放期间不允许任何请求 ----
requestGateOpen = true;
await page.locator('#tl-range').fill('250'); // 西哥特人仍在巴尔干
await page.waitForTimeout(400);
const visibleAt250 = await page.locator('path.region:visible').count();
await page.screenshot({ path: 'chromium/smoke-2-atlas-250.png' });
await page.locator('#tl-range').fill('520'); // 东哥特意大利 + 汪达尔北非
await page.waitForTimeout(400);
await page.screenshot({ path: 'chromium/smoke-3-atlas-520.png' });
const paths = page.locator('path.region:visible');
const n = await paths.count();
if (n > 0) {
  await paths.nth(Math.floor(n / 2)).hover({ force: true });
  await page.waitForTimeout(400);
}
await page.mouse.wheel(0, -200);
await page.waitForTimeout(300);
requestGateOpen = false;
console.log(`zero-network check: ${requestCount} requests during timeline/hover/zoom (expect 0)`);

// hover 面板截图
await paths.nth(Math.floor(n / 2)).hover({ force: true });
await page.waitForTimeout(400);
await page.screenshot({ path: 'chromium/smoke-4-atlas-hover.png' });

// 英文模式
await page.click('#lang-toggle');
await page.waitForTimeout(400);
await page.screenshot({ path: 'chromium/smoke-5-atlas-en.png' });
await page.click('#lang-toggle');
await page.waitForTimeout(300);

// 切到几何浏览模式（DARMC + 1450）
await page.click('#mode-toggle');
await page.waitForTimeout(800);
await page.click('#source-seg button:nth-child(2)');
await page.waitForTimeout(2500);
await page.locator('#tl-range').fill('6');
await page.waitForTimeout(500);
await page.screenshot({ path: 'chromium/smoke-6-geo-darmc-1450.png' });

console.log(`atlas@250 visible paths: ${visibleAt250}, atlas@520 visible paths: ${n}`);
console.log(`console errors: ${errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2)}`);
if (requestCount > 0) {
  console.error('FAIL: 交互期间产生了网络请求');
  process.exitCode = 1;
}
await browser.close();
