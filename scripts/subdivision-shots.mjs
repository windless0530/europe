// 五国细分效果截图：意大利/希腊/土耳其/芬兰/俄罗斯 关键年份 + 聚焦放大。
// 用法：先 npm run dev，再 node scripts/subdivision-shots.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);

async function setYear(y) {
  await page.locator('#tl-range').fill(String(y));
  await page.waitForTimeout(500);
}

// ---- 全图关键年份 ----
const shots = [
  [-300, '01-classical', '古典期：大希腊（西西里）+ 拉丁姆 + 撒丁'],
  [950, '02-emirates', '950：克里特酋长国 + 西西里酋长国 + 伏尔加保加利亚 + 东马其顿斯拉夫'],
  [1200, '03-norman-byz', '1200：诺曼西西里 + 拜占庭克里特 + 伏尔加保加利亚 + 卡累利阿'],
  [1500, '04-ottoman', '1500：奥斯曼东色雷斯 + 喀山鞑靼 + 意大利化西西里'],
  [2026, '05-modern', '2026：全部细分单元（萨普米/卡累利阿/鞑靼斯坦/东色雷斯/两岛）'],
];
for (const [y, name, label] of shots) {
  await setYear(y);
  await page.screenshot({ path: `chromium/sub-${name}.png` });
  console.log(`✓ ${y} ${label}`);
}

// ---- 聚焦放大：东地中海（克里特/东色雷斯/东马其顿）@950 ----
await setYear(950);
await page.mouse.move(820, 520); // 爱琴海一带
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
await page.screenshot({ path: 'chromium/sub-06-aegean-950.png' });
console.log('✓ 爱琴海聚焦 @950');

// 复位缩放（刷新页面最稳）
await page.reload();
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);

// ---- 聚焦放大：伏尔加-卡马 @1200 ----
await setYear(1200);
await page.mouse.move(1010, 240); // 伏尔加上游-喀山一带
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
await page.screenshot({ path: 'chromium/sub-07-volga-1200.png' });
console.log('✓ 伏尔加聚焦 @1200');

await browser.close();
console.log('done');
