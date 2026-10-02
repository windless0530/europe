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

// ---- 族群谱系树验证：520 年，东哥特/西哥特应挂在 日耳曼→东日耳曼→哥特 之下 ----
const treeVisible = await page.locator('#people-tree').isVisible();
const treeText = await page.locator('#people-tree').innerText();
const hasGothicNesting =
  treeText.includes('东日耳曼') && treeText.includes('哥特') && treeText.includes('东哥特人') && treeText.includes('西哥特人');
const germanicIdx = treeText.indexOf('日耳曼语族');
const eastIdx = treeText.indexOf('东日耳曼');
const ostroIdx = treeText.indexOf('东哥特人');
const nestingOk = germanicIdx >= 0 && eastIdx > germanicIdx && ostroIdx > eastIdx;
console.log(`people-tree: visible=${treeVisible}, gothic-nesting=${hasGothicNesting && nestingOk}`);
let treeFail = !treeVisible || !hasGothicNesting || !nestingOk;

// 悬停谱系树叶（东哥特人）-> 地图上该族群区域之外应压暗（fill-opacity 0.25）
const leaf = page.locator('.ptree-leaf', { hasText: '东哥特人' }).first();
if (await leaf.count() > 0) {
  requestGateOpen = true; // 树悬停也纳入零网络验证
  await leaf.hover({ force: true });
  await page.waitForTimeout(400);
  requestGateOpen = false;
  await page.screenshot({ path: 'chromium/smoke-4b-tree-focus.png' });
  const dimmed = await page.locator('path.region:visible').evaluateAll((els) => {
    let dim = 0, lit = 0;
    for (const el of els) {
      if (el.style.fillOpacity === '0.25') dim++;
      else if (el.style.fill) lit++;
    }
    return { dim, lit };
  });
  console.log(`tree-focus dimming: dimmed=${dimmed.dim}, lit=${dimmed.lit} (expect both > 0)`);
  if (dimmed.dim === 0 || dimmed.lit === 0) treeFail = true;
  await page.mouse.move(720, 50); // 离开树叶，恢复
  await page.waitForTimeout(300);
}

// 英文模式
await page.click('#lang-toggle');
await page.waitForTimeout(400);
await page.screenshot({ path: 'chromium/smoke-5-atlas-en.png' });
const treeTextEn = await page.locator('#people-tree').innerText();
console.log(`people-tree(en): ${treeTextEn.includes('East Germanic') && treeTextEn.includes('Ostrogoths') ? 'ok' : 'MISSING en labels'}`);
await page.click('#lang-toggle');
await page.waitForTimeout(300);

// ---- 未点亮族群一键显隐：520 年应只剩当年活动的族群 ----
const leavesAll = await page.locator('.ptree-leaf').count();
const inactiveAll = await page.locator('.ptree-leaf:not(.active)').count();
requestGateOpen = true; // 切换也纳入零网络验证
await page.locator('#ptree-show-inactive').uncheck();
await page.waitForTimeout(400);
requestGateOpen = false;
const leavesActiveOnly = await page.locator('.ptree-leaf').count();
const inactiveActiveOnly = await page.locator('.ptree-leaf:not(.active)').count();
console.log(`tree-toggle: leaves ${leavesAll} -> ${leavesActiveOnly}, inactive ${inactiveAll} -> ${inactiveActiveOnly} (expect >0 -> 0)`);
if (!(inactiveAll > 0 && inactiveActiveOnly === 0 && leavesActiveOnly < leavesAll)) {
  console.error('FAIL: 未点亮族群显隐切换未生效');
  treeFail = true;
}
await page.screenshot({ path: 'chromium/smoke-4c-tree-active-only.png' });
await page.locator('#ptree-show-inactive').check(); // 恢复
await page.waitForTimeout(300);

// ---- 740 年中欧+瑞士/科索沃上色断言（覆盖补丁回归） ----
await page.locator('#tl-range').fill('740');
await page.waitForTimeout(400);
const central = await page.evaluate(() => {
  const ctx = getComputedStyle(document.documentElement).getPropertyValue('--context-fill').trim();
  const out = {};
  for (const cc of ['de', 'at', 'cz', 'sk', 'hu', 'ch', 'xk']) {
    const el = document.querySelector(`path.region[data-code="nuts:${cc}"]`);
    out[cc] = el && el.style.fill && el.style.fill !== ctx ? 'painted' : 'BLANK';
  }
  return out;
});
console.log(`740 central europe + ch/xk: ${JSON.stringify(central)} (expect all painted)`);
if (Object.values(central).some((v) => v !== 'painted')) {
  console.error('FAIL: 740 年中欧/瑞士/科索沃存在空白（覆盖补丁回归）');
  process.exitCode = 1;
}
await page.screenshot({ path: 'chromium/smoke-3b-atlas-740.png' });
// 谱系树应出现补丁新增族群（阿瓦尔人/巴伐利亚人，740 年均活动）
const tree740 = await page.locator('#people-tree').innerText();
if (!tree740.includes('阿瓦尔人') || !tree740.includes('巴伐利亚人')) {
  console.error('FAIL: 740 年谱系树缺少新增族群');
  process.exitCode = 1;
}

// 切到几何浏览模式（DARMC + 1450）
await page.click('#mode-toggle');
await page.waitForTimeout(800);
await page.click('#source-seg button:nth-child(2)');
await page.waitForTimeout(2500);
await page.locator('#tl-range').fill('6');
await page.waitForTimeout(500);
await page.screenshot({ path: 'chromium/smoke-6-geo-darmc-1450.png' });

// favicon 可达性（浏览器标签页图标）
const favResp = await page.request.get(new URL('favicon.svg', BASE).href);
console.log(`favicon.svg: HTTP ${favResp.status()} (expect 200)`);
if (favResp.status() !== 200) process.exitCode = 1;

console.log(`atlas@250 visible paths: ${visibleAt250}, atlas@520 visible paths: ${n}`);
console.log(`console errors: ${errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2)}`);
if (requestCount > 0) {
  console.error('FAIL: 交互期间产生了网络请求');
  process.exitCode = 1;
}
if (treeFail) {
  console.error('FAIL: 族群谱系树校验未通过');
  process.exitCode = 1;
}
await browser.close();
