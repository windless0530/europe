// 五国细分单元着色断言：逐年检查每个新单元存在且有填充色，且关键转折年份颜色正确切换。
// 用法：先 npm run dev，再 node scripts/subdivision-verify.mjs
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

// 先探测：data-code 是 slugify(source_id)，确认新单元实际码
const probe = await page.evaluate(() => {
  return [...document.querySelectorAll('path.region')].map((el) => el.dataset.code).filter((c) =>
    /26_1|68_1|6_1$|fi1d|tr21|itg|el43|el51|el30|itc1/.test(c),
  );
});
console.log('探测到的单元码:', JSON.stringify(probe));

const KEY = {
  itc1: 'itc1', itg1: 'itg1', itg2: 'itg2',
  el43: 'el43', el51: 'el51', el30: 'el30',
  tr21: 'tr21', fi1d7: 'fi1d7', fi1dc: 'fi1dc',
  rus26: 'rus_26_1', rus68: 'rus_68_1', rus6: 'rus_6_1',
};
const years = [-300, 700, 850, 900, 950, 1090, 1100, 1200, 1250, 1400, 2026];
const cache = {};
for (const y of years) {
  await page.locator('#tl-range').fill(String(y));
  await page.waitForTimeout(450);
  cache[y] = await page.evaluate((keys) => {
    const out = {};
    for (const k of keys) out[k] = document.querySelector(`path.region[data-code="nuts:${k}"], path.region[data-members~="${k}"]`)?.style.fill ?? null;
    return out;
  }, Object.values(KEY));
}

let fail = 0;
const painted = (c) => c !== null && c !== '' && c !== 'transparent';
const row = (pass, label, detail) => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}  ${detail ?? ''}`); };

// 存在性 + 着色（挑代表性年份）
const presence = [
  [-300, 'itg2', '撒丁（撒丁人）'],
  [-300, 'itg1', '西西里（大希腊）'],
  [-300, 'itc1', '意大利大陆 L2'],
  [700, 'el51', '东马其顿-色雷斯'],
  [700, 'tr21', '东色雷斯（希腊裔）'],
  [850, 'el43', '克里特（酋长国）'],
  [900, 'itg1', '西西里（酋长国）'],
  [1200, 'rus68', '鞑靼斯坦（伏尔加保加利亚）'],
  [1250, 'rus6', '巴什科尔托斯坦'],
  [1400, 'tr21', '东色雷斯（奥斯曼）'],
  [2026, 'fi1d7', '芬兰拉普兰（萨普米）'],
  [2026, 'fi1dc', '北卡累利阿'],
  [2026, 'rus26', '卡累利阿共和国'],
  [2026, 'el30', '希腊主体 L2'],
];
for (const [y, k, label] of presence) row(painted(cache[y][KEY[k]]), `${y} ${label}`, cache[y][KEY[k]]);

// 转折年份颜色切换
const switches = [
  [-300, 'itg1', 900, 'itg1', '西西里 希腊→阿拉伯'],
  [900, 'itg1', 1100, 'itg1', '西西里 阿拉伯→意大利'],
  [850, 'el43', 1090, 'el43', '克里特 阿拉伯→希腊'],
  [700, 'el51', 1100, 'el51', '东马其顿 斯拉夫主导→希腊恢复（应变色）'],
  [700, 'tr21', 1400, 'tr21', '东色雷斯 希腊→土耳其'],
];
for (const [y1, k1, y2, k2, label] of switches) {
  const a = cache[y1][KEY[k1]], b = cache[y2][KEY[k2]];
  row(painted(a) && painted(b) && a !== b, label, `${a} → ${b}`);
}

// 接力不共现（同年不同屏，同色合法）：伏尔加 1240 前后均为保加尔/鞑靼双色持有
row(painted(cache[1200].rus_68_1) && painted(cache[1250].rus_68_1), '伏尔加 保加尔(1200)→鞑靼(1250) 接力连续', `${cache[1200].rus_68_1} / ${cache[1250].rus_68_1}`);

// 同年同国不同色（读者可分辨）
for (const [y, ka, kb, label] of [
  [950, 'el43', 'el30', '950 克里特(阿拉伯) vs 希腊主体'],
  [900, 'itg1', 'itc1', '900 西西里(阿拉伯) vs 大陆(法兰克)'],
  [1250, 'rus68', 'fi1dc', '1250 鞑靼斯坦 vs 北卡累利阿'],
]) {
  const a = cache[y][KEY[ka]], b = cache[y][KEY[kb]];
  row(painted(a) && painted(b) && a !== b, label, `${a} / ${b}`);
}

if (errors.length) { console.log('console errors:', JSON.stringify(errors, null, 2)); fail++; }
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} 项失败`);
process.exitCode = fail === 0 ? 0 : 1;
await browser.close();
