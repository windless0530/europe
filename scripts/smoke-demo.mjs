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

// ---- 740 年中欧+瑞士/科索沃上色断言（覆盖补丁回归；德国已细分，改查 L2 单元） ----
await page.locator('#tl-range').fill('740');
await page.waitForTimeout(400);
const central = await page.evaluate(() => {
  const ctx = getComputedStyle(document.documentElement).getPropertyValue('--context-fill').trim();
  const out = {};
  for (const cc of ['def0', 'de11', 'deg0', 'de21', 'at', 'cz', 'sk', 'hu', 'ch01', 'ch04', 'ch07', 'xk']) {
    const el = document.querySelector(`path.region[data-code="nuts:${cc}"], path.region[data-members~="${cc}"]`);
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

// ---- 次国家级细分断言（补丁 3 回归）：1300 年与当前年，16 个代表单元不得空白 ----
for (const yr of [1300, 2026]) {
  await page.locator('#tl-range').fill(String(yr));
  await page.waitForTimeout(400);
  const sub = await page.evaluate(() => {
    const ctx = getComputedStyle(document.documentElement).getPropertyValue('--context-fill').trim();
    const out = {};
    const checks = {
      castile: 'es41', andalusia: 'es61', catalonia: 'es51', basque: 'es21', galicia: 'es11',
      brittany: 'frh0', flanders: 'be2', wallonia: 'be3', samiland: 'no07', transylvania: 'ro11',
      silesia: 'pl22', masuria: 'pl62', crimea: 'ukr_4_1', eastGalicia: 'ukr_14_1', swissW: 'ch01', ticino: 'ch07',
    };
    for (const [k, cc] of Object.entries(checks)) {
      const el = document.querySelector(`path.region[data-code="nuts:${cc}"], path.region[data-members~="${cc}"]`);
      out[k] = el && el.style.fill && el.style.fill !== ctx ? 'painted' : 'BLANK';
    }
    return out;
  });
  console.log(`subnational@${yr}: ${JSON.stringify(sub)} (expect all painted)`);
  if (Object.values(sub).some((v) => v !== 'painted')) {
    console.error(`FAIL: ${yr} 年次国家级单元存在空白（补丁 3 回归）`);
    process.exitCode = 1;
  }
  if (yr === 1300) await page.screenshot({ path: 'chromium/smoke-7-subnational-1300.png' });
}

// ---- 前罗马时代断言（补丁 4 回归）：前 300 与公元 0 年中欧不得空白 ----
for (const yr of [-300, 0]) {
  await page.locator('#tl-range').fill(String(yr));
  await page.waitForTimeout(400);
  const early = await page.evaluate(() => {
    const ctx = getComputedStyle(document.documentElement).getPropertyValue('--context-fill').trim();
    const out = {};
    for (const cc of ['def0', 'de11', 'deg0', 'de21', 'at', 'cz', 'sk', 'pl21', 'pl22']) {
      const el = document.querySelector(`path.region[data-code="nuts:${cc}"], path.region[data-members~="${cc}"]`);
      out[cc] = el && el.style.fill && el.style.fill !== ctx ? 'painted' : 'BLANK';
    }
    return out;
  });
  console.log(`pre-roman@${yr}: ${JSON.stringify(early)} (expect all painted)`);
  if (Object.values(early).some((v) => v !== 'painted')) {
    console.error(`FAIL: ${yr} 年中欧存在空白（补丁 4 回归）`);
    process.exitCode = 1;
  }
  if (yr === 0) {
    // 公元 0 年：奥地利（罗马/诺里库姆）与德国中东部（古日耳曼）应不同色
    const fills0 = await page.evaluate(() => ({
      at: document.querySelector('path.region[data-code="nuts:at"], path.region[data-members~="at"]')?.style.fill,
      deg0: document.querySelector('path.region[data-code="nuts:deg0"], path.region[data-members~="deg0"]')?.style.fill,
    }));
    console.log(`year-0 colors: at=${fills0.at} deg0=${fills0.deg0} (expect distinct: Rome vs Germanic)`);
    if (!fills0.at || !fills0.deg0 || fills0.at === fills0.deg0) {
      console.error('FAIL: 公元 0 年奥地利/德国应显示不同政权色');
      process.exitCode = 1;
    }
    await page.screenshot({ path: 'chromium/smoke-8-pre-roman-0.png' });
  }
}

// ---- 500 年德国四分断言（补丁 5 回归）：四区各自着色，不得为伦巴第单色 ----
await page.locator('#tl-range').fill('500');
await page.waitForTimeout(400);
const de500 = await page.evaluate(() => {
  const ctx = getComputedStyle(document.documentElement).getPropertyValue('--context-fill').trim();
  const out = {};
  for (const cc of ['def0', 'de11', 'deg0', 'de21']) {
    const el = document.querySelector(`path.region[data-code="nuts:${cc}"], path.region[data-members~="${cc}"]`);
    out[cc] = el && el.style.fill && el.style.fill !== ctx ? el.style.fill : 'BLANK';
  }
  return out;
});
console.log(`germany@500: ${JSON.stringify(de500)} (expect 4 painted, old_saxony=thuringia distinct)`);
if (Object.values(de500).some((v) => v === 'BLANK')) {
  console.error('FAIL: 500 年德国四区存在空白（补丁 5 回归）');
  process.exitCode = 1;
}
if (new Set(Object.values(de500)).size < 3) {
  console.error('FAIL: 500 年德国四区应至少 3 种颜色（萨克森/图林根/阿勒曼尼/东哥特）');
  process.exitCode = 1;
}
await page.screenshot({ path: 'chromium/smoke-9-germany-500.png' });

// 切到几何浏览模式（DARMC + 1450）
// ---- 标注纹理与面板：年份窗口内出现、窗口外消失、hover 面板显示标注文本 ----
{
  const caveatAt = async (yr) => {
    await page.locator('#tl-range').fill(String(yr));
    await page.waitForTimeout(400);
    // 溶解要素的纹理按成员单元展开（键仍为 nuts:<单元>）
    return page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll('path.caveat')].flatMap((p) => {
        const kind = p.classList.contains('caveat-disputed') ? 'disputed' : 'method';
        const members = document.querySelector(`path.region[data-code="${p.dataset.code}"]`)?.dataset.members;
        return members ? members.split(' ').map((m) => [`nuts:${m}`, kind]) : [[p.dataset.code, kind]];
      })),
    );
  };
  const c1100 = await caveatAt(1100);
  const c2026 = await caveatAt(2026);
  const ok =
    c1100['nuts:ro11'] === 'disputed' && // 特兰西瓦尼亚：罗马尼亚人 1223 年前争议层
    c2026['nuts:ukr_4_1'] === 'method' && // 克里米亚：按人口着色说明
    c1100['nuts:lv'] === 'method' && c2026['nuts:lv'] === undefined; // 拉脱维亚：窗口 1000–1700
  console.log(`caveats: 1100 ro11=${c1100['nuts:ro11']} lv=${c1100['nuts:lv']}; 2026 crimea=${c2026['nuts:ukr_4_1']} lv=${c2026['nuts:lv'] ?? 'none'}; total@2026=${Object.keys(c2026).length} (expect disputed/method; method/none)`);
  if (!ok) {
    console.error('FAIL: 标注纹理窗口不符预期');
    process.exitCode = 1;
  }
  await page.locator('path.region[data-code="nuts:ukr_4_1"], path.region[data-members~="ukr_4_1"]').hover({ force: true });
  await page.waitForTimeout(300);
  const box = await page.locator('#detail-panel .caveat-box').count();
  const note = await page.locator('.map-note').isVisible();
  console.log(`caveat panel boxes @2026 crimea: ${box}, map-note visible: ${note} (expect ≥1, true)`);
  if (box < 1 || !note) {
    console.error('FAIL: 面板标注或地图说明缺失');
    process.exitCode = 1;
  }
  await page.screenshot({ path: 'chromium/smoke-8-caveat-crimea-2026.png' });
  await caveatAt(1100);
  await page.locator('path.region[data-code="nuts:ro11"], path.region[data-members~="ro11"]').hover({ force: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'chromium/smoke-9-caveat-transylvania-1100.png' });
}

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
