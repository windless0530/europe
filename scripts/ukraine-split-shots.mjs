// 乌克兰拆分效果截图：荒野期(1500/1600) → 定居(1700) → 现代 + 顿巴斯 hover 双族群面板。
// 用法：先 npm run dev，再 node scripts/ukraine-split-shots.mjs
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
async function zoomTo(x, y) {
  await page.mouse.move(x, y);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
}
async function hoverCode(code) {
  const sel = `path.region[data-code="nuts:${code}"], path.region[data-members~="${code}"]`;
  const box = await page.locator(sel).boundingBox();
  const pt = await page.evaluate(({ sel, box }) => {
    for (const fx of [0.5, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.45, 0.55]) {
      for (const fy of [0.5, 0.4, 0.6, 0.35, 0.65]) {
        const x = box.x + box.width * fx, y = box.y + box.height * fy;
        if (document.elementFromPoint(x, y)?.matches(sel)) return { x, y };
      }
    }
    return null;
  }, { sel, box });
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.waitForTimeout(600);
}

// 全图：荒野期 vs 现代
await setYear(1500);
await page.screenshot({ path: 'chromium/ua-01-1500-wild.png' });
console.log('✓ 1500 荒野期（东/南灰带 vs 中西乌克兰已着色）');
await setYear(2026);
await page.screenshot({ path: 'chromium/ua-02-2026.png' });
console.log('✓ 2026 现代（克里米亚蓝 vs 乌克兰主体黄）');

// 放大 1600：南部塞契已亮（黄）、东部仍荒（灰）——同框对照
await page.reload();
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);
await setYear(1600);
await zoomTo(960, 330); // 乌克兰一带
await page.screenshot({ path: 'chromium/ua-03-1600-south-vs-east.png' });
console.log('✓ 1600 放大：南部已定居 vs 东部荒野');

// 放大 2026 顿巴斯 + hover 顿涅茨克：右侧面板 乌克兰人(主) + 俄罗斯人(共居)
await page.reload();
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);
await setYear(2026);
// 先取全图下顿涅茨克的屏幕位置，再以它为缩放中心
const dk = await page.locator('path.region[data-code="nuts:ukr_6_1"], path.region[data-members~="ukr_6_1"]').boundingBox();
await zoomTo(dk.x + dk.width / 2, dk.y + dk.height / 2);
await hoverCode('ukr_6_1');
await page.screenshot({ path: 'chromium/ua-04-donbas-2026-hover.png' });
console.log('✓ 2026 顿巴斯 hover：面板显示 乌克兰人(主)+俄罗斯人');

await browser.close();
console.log('done');
