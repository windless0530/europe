// 乌克兰拆分断言：东部 1650 / 南部 1550 前为「荒野」空白，之后乌克兰主色；
// 2026 年 hover 顿涅茨克面板应同时出现 乌克兰人（主）与 俄罗斯人（少数共居）。
// 用法：先 npm run dev，再 node scripts/ukraine-split-verify.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#boot-overlay.hidden', { timeout: 120000 });
await page.waitForSelector('path.region:visible', { timeout: 60000 });
await page.waitForTimeout(1200);

const KEY = {
  donetsk: 'ukr_6_1', kharkiv: 'ukr_8_1', luhansk: 'ukr_15_1',      // 东
  odesa: 'ukr_17_1', zaporizhzhia: 'ukr_26_1', kherson: 'ukr_9_1',   // 南
  dnipro: 'ukr_5_1', mykolaiv: 'ukr_16_1', kirovohrad: 'ukr_13_1',
  kyiv: 'ukr_12_1', poltava: 'ukr_18_1', crimea: 'ukr_4_1',          // 中/克里米亚
};
const years = [1400, 1500, 1600, 1700, 1800, 2026];
const cache = {};
for (const y of years) {
  await page.locator('#tl-range').fill(String(y));
  await page.waitForTimeout(400);
  cache[y] = await page.evaluate((keys) => {
    const out = {};
    for (const k of keys) out[k] = document.querySelector(`path.region[data-code="nuts:${k}"], path.region[data-members~="${k}"]`)?.style.fill ?? null;
    return out;
  }, Object.values(KEY));
}

let fail = 0;
// 未着色单元的填充 = 底色灰 rgb(236,235,231)，非空串；以此为「空白」判据
const UNPAINTED = 'rgb(236, 235, 231)';
const painted = (c) => c !== null && c !== '' && c !== 'transparent' && c !== UNPAINTED;
const blank = (c) => !painted(c);
const row = (pass, label, detail) => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}  ${detail ?? ''}`); };
const hoverCode = async (code) => {
  const sel = `path.region[data-code="nuts:${code}"], path.region[data-members~="${code}"]`;
  const box = await page.locator(sel).boundingBox();
  // 非凸/临海多边形 bbox 中心可能在外（黑海），网格采样找第一个命中自身的点
  const pt = await page.evaluate(({ sel, box }) => {
    for (const fx of [0.5, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.45, 0.55]) {
      for (const fy of [0.5, 0.4, 0.6, 0.35, 0.65]) {
        const x = box.x + box.width * fx, y = box.y + box.height * fy;
        if (document.elementFromPoint(x, y)?.matches(sel)) return { x, y };
      }
    }
    return null;
  }, { sel, box });
  if (!pt) throw new Error(`hover 采样失败: ${code}`);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.waitForTimeout(500);
};

// 荒野期：东部 1600 空白（1650 前无定居）、南部 1500 空白（1550 前）
for (const k of ['donetsk', 'kharkiv', 'luhansk']) row(blank(cache[1600][KEY[k]]), `1600 ${k} 荒野空白`, cache[1600][KEY[k]]);
for (const k of ['odesa', 'zaporizhzhia', 'kherson', 'dnipro', 'mykolaiv', 'kirovohrad']) row(blank(cache[1500][KEY[k]]), `1500 ${k} 荒野空白`, cache[1500][KEY[k]]);

// 定居后连续着色（东部 1700+，南部 1600+）
for (const [y, keys] of [[1700, ['donetsk', 'kharkiv', 'luhansk']], [1600, ['odesa', 'zaporizhzhia']], [1800, ['donetsk', 'odesa', 'kherson']], [2026, ['donetsk', 'kharkiv', 'luhansk', 'odesa', 'zaporizhzhia', 'kherson', 'dnipro', 'mykolaiv', 'kirovohrad']]]) {
  for (const k of keys) row(painted(cache[y][KEY[k]]), `${y} ${k} 已着色`, cache[y][KEY[k]]);
}

// 中北部不受拆分影响：1400 年即有乌克兰人
for (const k of ['kyiv', 'poltava']) row(painted(cache[1400][KEY[k]]), `1400 ${k} 连续着色（中北部）`, cache[1400][KEY[k]]);

// 同年同国（UA）不同色：2026 顿涅茨克（乌克兰人）vs 克里米亚（俄罗斯人）
const a = cache[2026][KEY.donetsk], b = cache[2026][KEY.crimea];
row(painted(a) && painted(b) && a !== b, '2026 顿涅茨克 vs 克里米亚 异色', `${a} / ${b}`);

// hover 顿涅茨克 @2026：面板应含 乌克兰人（主）+ 俄罗斯人（少数）
await page.locator('#tl-range').fill('2026');
await page.waitForTimeout(400);
await hoverCode('ukr_6_1');
const panel = await page.evaluate(() => [...document.querySelectorAll('.people-block')].map((el) => ({
  name: el.querySelector('strong')?.textContent,
  top: el.classList.contains('top'),
})));
const ukr = panel.find((p) => p.name === '乌克兰人');
const rus = panel.find((p) => p.name === '俄罗斯人');
row(!!ukr && ukr.top, 'hover 顿涅茨克：乌克兰人 = 主族群', JSON.stringify(panel));
row(!!rus && !rus.top, 'hover 顿涅茨克：俄罗斯人 = 共居少数', '');

// hover 敖德萨 @2026 同样双族群
await hoverCode('ukr_17_1');
const panel2 = await page.evaluate(() => [...document.querySelectorAll('.people-block')].map((el) => el.querySelector('strong')?.textContent));
row(panel2.includes('乌克兰人') && panel2.includes('俄罗斯人'), 'hover 敖德萨：乌克兰人+俄罗斯人双族群', JSON.stringify(panel2));

if (errors.length) { console.log('console errors:', JSON.stringify(errors, null, 2)); fail++; }
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} 项失败`);
process.exitCode = fail === 0 ? 0 : 1;
await browser.close();
