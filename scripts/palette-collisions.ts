// 族群颜色审计（npm run collisions）：
// 1. 门禁：people_region 中每个族群都必须在 src/frontend/people-colors.ts 的 PEOPLE_COLOR
//    有固定颜色——缺色即失败（补色：npm run colors，只为缺失族群推荐颜色）。
// 2. 提示：复刻前端 paintAt 逐年扫描「同年、同色、不同族群」的着色对。颜色与族群强绑定、
//    既有条目冻结，撞色不再通过改动既有族群颜色来消除（同年同国同色仅警告，不拦截）；
//    该结果用于新族群选色时的参照，弱对由谱系树 + hover 消歧。
// 3. 提示：PEOPLE_COLOR 中数据已不再引用的条目（保留不删：同码复用即复用原色）。
// 用法：npm run collisions

import { PEOPLE_COLOR } from '../src/frontend/people-colors.js';
import { countryOfGeom, order, paintPeopleAt, yMin, yMax } from './paint-sim.js';

const missing = order.filter((code) => !PEOPLE_COLOR[code]);
const unused = Object.keys(PEOPLE_COLOR).filter((code) => !order.includes(code));

interface Coll {
  a: string;
  b: string;
  years: number; // 任意地区共现年数
  adjacentYears: number; // 同年同国（读者难分辨）年数
  first: number;
  last: number;
  adjacentCountries: Set<string>;
}
const colls = new Map<string, Coll>();
const step = 1;
for (let y = yMin; y <= yMax; y += step) {
  const paint = paintPeopleAt(y);
  const byColor = new Map<string, Array<{ g: string; p: string }>>();
  for (const [g, p] of paint) {
    const pair = PEOPLE_COLOR[p];
    if (!pair) continue;
    const key = pair[0];
    const list = byColor.get(key) ?? [];
    list.push({ g, p });
    byColor.set(key, list);
  }
  for (const [, items] of byColor) {
    const peoples = [...new Set(items.map((i) => i.p))];
    if (peoples.length < 2) continue;
    for (let i = 0; i < peoples.length; i++) {
      for (let j = i + 1; j < peoples.length; j++) {
        const [a, b] = [peoples[i]!, peoples[j]!].sort();
        const key = `${a}|${b}`;
        const c = colls.get(key) ?? { a, b, years: 0, adjacentYears: 0, first: y, last: y, adjacentCountries: new Set<string>() };
        c.years++;
        c.last = y;
        // 同国相邻碰撞：同 L0 内同年出现两种同色族群
        const cA = new Set(items.filter((x) => x.p === a).map((x) => countryOfGeom.get(x.g)));
        let hit = false;
        for (const it of items.filter((x) => x.p === b)) {
          if (cA.has(countryOfGeom.get(it.g))) {
            c.adjacentCountries.add(countryOfGeom.get(it.g) ?? '?');
            hit = true;
          }
        }
        if (hit) c.adjacentYears++;
        colls.set(key, c);
      }
    }
  }
}

const list = [...colls.values()].sort((x, y) => y.adjacentYears - x.adjacentYears || y.years - x.years);
const adjTotal = list.filter((c) => c.adjacentYears > 0);
console.log(`族群颜色审计：${yMin}–${yMax} 步长 ${step}，固定颜色表 PEOPLE_COLOR ${Object.keys(PEOPLE_COLOR).length} 条，着色族群 ${order.length} 个\n`);
if (missing.length > 0) {
  console.log(`FAIL: ${missing.length} 个族群缺少固定颜色（运行 npm run colors 获取推荐色，按键序插入 PEOPLE_COLOR）：`);
  console.log(`  ${missing.join(', ')}\n`);
  process.exitCode = 1;
} else {
  console.log('OK: 全部着色族群都有固定颜色');
}
if (list.length === 0) {
  console.log('OK: 无同年同色异族群对');
} else if (adjTotal.length === 0) {
  console.log('OK: 无同年同国同色异族群对；同年跨区同色对见下（信息，hover/谱系树可消歧）');
} else {
  console.log(`警告（不拦截，既有颜色冻结不自动改）：同年同国同色 ${adjTotal.length} 组`);
  for (const c of adjTotal) {
    console.log(`  ${c.a} × ${c.b}  相邻 ${c.adjacentYears} 年 (${[...c.adjacentCountries].join(',')})  共现 ${c.years} 年 (${c.first}–${c.last})`);
  }
}
if (list.length > adjTotal.length) {
  console.log(`\n跨区共现（信息，可接受）：${list.length - adjTotal.length} 组，前 10：`);
  for (const c of list.filter((x) => x.adjacentYears === 0).slice(0, 10)) {
    console.log(`  ${c.a} × ${c.b}  ${c.years} 年 (${c.first}–${c.last})`);
  }
}
if (unused.length > 0) {
  console.log(`\n数据未引用的颜色条目（信息，保留以便同码复用原色）：${unused.join(', ')}`);
}
