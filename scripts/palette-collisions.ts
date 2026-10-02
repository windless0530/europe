// 调色板碰撞审计：复刻前端 paintAt 竞争规则，逐年检查
// 「同年、同色、不同族群」的着色对（14 色回绕的实际后果）。
// 出现碰撞不代表必须改色——若两族群地理上同年不同区，读者仍可区分；
// 此脚本按几何邻近度报告：仅当同色对出现在相邻（同 L0 国家内）几何时升级为 warn。
// 用法：npm run collisions   （先 npm run export）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildView, type RegionVm } from '../src/frontend/load.js';
import { resolveRegionGeometry, countryOf, type RegionGeometryRule } from '../src/frontend/region-map.js';
import { atlasGeometryFeatures, activeInYear } from '../src/frontend/atlas.js';
import type { SourceCode } from '../src/lib/contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

interface Row {
  people_code: string;
  region_code: string;
  start_year: number | null;
  end_year: number | null;
  render_priority: number;
}
interface Data {
  people_region: Row[];
  periods: Array<{ start_year: number | null; end_year: number | null }>;
  region_geometry: RegionGeometryRule[];
}
const atlas = JSON.parse(readFileSync(join(root, 'data/export/atlas.json'), 'utf8')) as Data;

const sourceFeatures = new Map<SourceCode, { features: RegionVm[] }>();
for (const code of ['awmc', 'darmc', 'nuts'] as SourceCode[]) {
  const file = JSON.parse(readFileSync(join(root, `data/processed/${code}/regions.geojson`), 'utf8'));
  sourceFeatures.set(code, { features: buildView(code, file).features });
}
const features = atlasGeometryFeatures(sourceFeatures as unknown as Map<SourceCode, { features: RegionVm[] }>, atlas.region_geometry ?? []);
const { byRegion } = resolveRegionGeometry(features, atlas.region_geometry ?? []);
const countryOfGeom = new Map<string, string | null>(
  features.map((vm) => [vm.code, vm.family === 'nuts' ? countryOf(vm) : null]),
);

// 槽位分配：people_region 数组首现顺序（与前端一致）
const order: string[] = [];
for (const row of atlas.people_region) if (!order.includes(row.people_code)) order.push(row.people_code);
const PALETTE_LEN = 16;
const slotOf = new Map(order.map((code, i) => [code, i % PALETTE_LEN]));

// 年份范围
const cands: number[] = [];
for (const p of atlas.periods) {
  if (p.start_year !== null) cands.push(p.start_year);
  if (p.end_year !== null) cands.push(p.end_year);
}
for (const r of atlas.people_region) {
  if (r.start_year !== null) cands.push(r.start_year);
  if (r.end_year !== null) cands.push(r.end_year);
}
const yMin = Math.min(...cands, -500);
const yMax = Math.max(...cands, new Date().getFullYear());

// paintAt 复刻（跨区域竞争：priority 高者胜，平局字典序）
function paintPeopleAt(year: number): Map<string, string> {
  const best = new Map<string, { pr: number; code: string }>();
  const byRegionYear = new Map<string, Row[]>();
  for (const row of atlas.people_region) {
    if (!activeInYear(row, year)) continue;
    const list = byRegionYear.get(row.region_code) ?? [];
    list.push(row);
    byRegionYear.set(row.region_code, list);
  }
  for (const [, rows] of byRegionYear) {
    rows.sort((a, b) => b.render_priority - a.render_priority || a.people_code.localeCompare(b.people_code));
    const top = rows[0]!;
    const cand = { pr: top.render_priority, code: top.people_code };
    for (const g of byRegion.get(top.region_code) ?? []) {
      const cur = best.get(g);
      if (!cur || cand.pr > cur.pr || (cand.pr === cur.pr && cand.code.localeCompare(cur.code) < 0)) best.set(g, cand);
    }
  }
  const paint = new Map<string, string>();
  for (const [g, win] of best) paint.set(g, win.code);
  return paint;
}

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
    const slot = slotOf.get(p);
    if (slot === undefined) continue;
    const key = String(slot);
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
console.log(`调色板碰撞扫描：${yMin}–${yMax} 步长 ${step}，${PALETTE_LEN} 色回绕，着色族群 ${order.length} 个\n`);
if (adjTotal.length === 0) {
  console.log('OK: 无同年同国同色异族群对（跨区共现由 hover/谱系树消歧）');
} else {
  console.log(`同年同国同色（读者难分辨）：${adjTotal.length} 组`);
  for (const c of adjTotal) {
    console.log(`  ${c.a} × ${c.b}  相邻 ${c.adjacentYears} 年 (${[...c.adjacentCountries].join(',')})  共现 ${c.years} 年 (${c.first}–${c.last})`);
  }
  process.exitCode = 1;
}
if (list.length > adjTotal.length) {
  console.log(`\n跨区共现（信息，可接受）：${list.length - adjTotal.length} 组，前 10：`);
  for (const c of list.filter((x) => x.adjacentYears === 0).slice(0, 10)) {
    console.log(`  ${c.a} × ${c.b}  ${c.years} 年 (${c.first}–${c.last})`);
  }
}
