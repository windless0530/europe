// 调色板调优器：按「实际同年同屏」的槽对，对调色板排序做爬山优化。
//
// 为什么需要对（而非全对）优化：调色板 ≥60 色时全对 ΔE 地板受色度学上限约束；
// 但 assignPaletteSlots 已保证同年同屏主族群必不同槽，读者实际需要分辨的
// 只有「共现槽对」的颜色差。此脚本：
//   1. 用与前端同一 assignPaletteSlots 得到实际槽位分配（同年全局避让）；
//   2. 统计每个槽对的共现年数（复刻 paintAt 竞争，逐年取各几何主族群去重）；
//   3. 目标 = Σ min(pairScore, CAP)，CAP=12（超过后不再加分，专注拉高弱对）；
//      pairScore = min(ΔE_normal, ΔE_cvd × 1.5)（Machado 模拟；CVD 权重略高以压制塌缩对）；
//   4. 相邻交换爬山至局部最优（增量评估：只重算涉及交换槽的槽对）。
// 输出最终 CATEGORICAL_LIGHT / CATEGORICAL_DARK，粘贴进 src/frontend/atlas.ts。
// 数据变更后可重跑再粘贴。用法：npx tsx scripts/palette-tune.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildView, type RegionVm } from '../src/frontend/load.js';
import { resolveRegionGeometry, type RegionGeometryRule } from '../src/frontend/region-map.js';
import { atlasGeometryFeatures, activeInYear, assignPaletteSlots } from '../src/frontend/atlas.js';
import type { SourceCode } from '../src/lib/contract.js';
import { buildPool, darken, pairScore, pairScores } from './pick-palette.mjs';

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

const order: string[] = [];
for (const row of atlas.people_region) if (!order.includes(row.people_code)) order.push(row.people_code);

const cands: number[] = [];
for (const p of atlas.periods) { if (p.start_year !== null) cands.push(p.start_year); if (p.end_year !== null) cands.push(p.end_year); }
for (const r of atlas.people_region) { if (r.start_year !== null) cands.push(r.start_year); if (r.end_year !== null) cands.push(r.end_year); }
const yMin = Math.min(...cands, -500);
const yMax = Math.max(...cands, new Date().getFullYear());

// 逐年「主族群集合」（复刻 paintAt：跨区竞争 → 每几何一个主族群，再全图去重）
function topPeoplesAt(year: number): Set<string> {
  const byRegionYear = new Map<string, Row[]>();
  for (const row of atlas.people_region) {
    if (!activeInYear(row, year)) continue;
    const list = byRegionYear.get(row.region_code) ?? [];
    list.push(row);
    byRegionYear.set(row.region_code, list);
  }
  const tops = new Set<string>();
  for (const [, rows] of byRegionYear) {
    rows.sort((a, b) => b.render_priority - a.render_priority || a.people_code.localeCompare(b.people_code));
    for (const g of byRegion.get(rows[0]!.region_code) ?? []) {
      void g; // 主族群对区域内全部几何生效，几何维度可折叠
      tops.add(rows[0]!.people_code);
      break;
    }
  }
  return tops;
}

// 槽位分配 + 共现年统计；返回 (slotPair -> years)。若同槽共现（饱和回绕）则计数。
function analyze(paletteLen: number): { slotOf: Map<string, number>; pairYears: Map<string, number>; saturated: number; slotsUsed: number } {
  const slotOf = assignPaletteSlots(atlas, features, order, paletteLen);
  const pairYears = new Map<string, number>();
  let saturated = 0;
  for (let y = yMin; y <= yMax; y++) {
    const tops = topPeoplesAt(y);
    const slots = [...tops].map((p) => slotOf.get(p)).filter((s): s is number => s !== undefined);
    const uniq = [...new Set(slots)].sort((a, b) => a - b);
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const k = `${uniq[i]}|${uniq[j]}`;
        pairYears.set(k, (pairYears.get(k) ?? 0) + 1);
      }
    }
    // 同槽同屏（不同主族群落在同一槽 = 饱和回绕的实害）
    const bySlot = new Map<number, number>();
    for (const s of slots) bySlot.set(s, (bySlot.get(s) ?? 0) + 1);
    for (const [, n] of bySlot) if (n > 1) saturated += n - 1;
  }
  return { slotOf, pairYears, saturated, slotsUsed: new Set(slotOf.values()).size };
}

// ---------- 1. 池与调色板规模：互距过滤池 + 自适应槽位数（零饱和回绕） ----------
const POOL_FILTER = 7;
const pool = buildPool(26, POOL_FILTER);
let paletteLen = 64;
if (pool.length < paletteLen) throw new Error(`池仅 ${pool.length} 色 < 64 槽，需放宽准入或加网格`);
let ana = analyze(paletteLen);
while (ana.saturated > 0 && paletteLen < pool.length) {
  paletteLen += 2;
  ana = analyze(paletteLen);
}
console.log(`池：正常视觉互距≥${POOL_FILTER} 过滤后 ${pool.length} 色；调色板 ${paletteLen} 槽；实际占用 ${ana.slotsUsed} 槽，饱和同槽共现 ${ana.saturated} 处`);
if (ana.saturated > 0) console.warn('警告：仍有饱和同槽共现，考虑降低过滤地板或加大色相数');

// ---------- 2. 爬山：槽间交换 + 池外候选替换（摆脱换序局部最优） ----------
const palette = pool.slice(0, paletteLen);
const partnerSlots = new Map<number, number[]>();
for (const k of ana.pairYears.keys()) {
  const [a, b] = k.split('|').map(Number) as [number, number];
  partnerSlots.set(a, [...(partnerSlots.get(a) ?? []), b]);
  partnerSlots.set(b, [...(partnerSlots.get(b) ?? []), a]);
}
const CAP = 12;
// CVD 权重：调优用 1.5（比 pick-palette 的 1.33 更重视塌缩对）
const scoreCache = new Map<string, number>();
const pscore = (hexA: string, hexB: string): number => {
  const k = hexA < hexB ? `${hexA}|${hexB}` : `${hexB}|${hexA}`;
  let v = scoreCache.get(k);
  if (v === undefined) {
    const p = pairScores(hexA, hexB);
    v = Math.min(p.normal, Math.min(p.protan, p.deutan) * 1.5);
    scoreCache.set(k, v);
  }
  return v;
};
const pairCostOf = (colorA: string, colorB: string, years: number): number => {
  const s = pscore(colorA, colorB);
  // 主项：CAP 封顶的加权和（越大越好，爬山最大化此目标）；
  // 惩罚项：score<4 的塌缩对按年数扣 6 倍差分（消灭最差对优先于抬高好对）
  return (Math.min(s, CAP) - 6 * Math.max(0, 4 - s)) * Math.log1p(years);
};
const slotCost = (s: number, color: string): number => {
  let sum = 0;
  for (const p of partnerSlots.get(s) ?? []) {
    const years = ana.pairYears.get(s < p ? `${s}|${p}` : `${p}|${s}`);
    if (years !== undefined) sum += pairCostOf(color, palette[p]!, years);
  }
  return sum;
};
let obj = 0;
for (let s = 0; s < paletteLen; s++) obj += slotCost(s, palette[s]!); // 每对计两次，无碍比较
let moves = 0;
const climb = (): void => {
  for (;;) {
    let improved = false;
    // 移动 A：槽 i 颜色 ← 池中未用候选 c（替换）
    for (let i = 0; i < paletteLen; i++) {
      const before = slotCost(i, palette[i]!);
      let bestC: string | null = null, bestAfter = before;
      for (const c of pool) {
        if (palette.includes(c)) continue;
        const after = slotCost(i, c);
        if (after > bestAfter + 1e-9) { bestAfter = after; bestC = c; }
      }
      if (bestC !== null) { obj += bestAfter - before; palette[i] = bestC; moves++; improved = true; }
    }
    // 移动 B：槽间交换
    for (let i = 0; i < paletteLen; i++) {
      for (let j = i + 1; j < paletteLen; j++) {
        const before = slotCost(i, palette[i]!) + slotCost(j, palette[j]!);
        const tmp = palette[i]!;
        palette[i] = palette[j]!;
        palette[j] = tmp;
        const after = slotCost(i, palette[i]!) + slotCost(j, palette[j]!);
        if (after > before + 1e-9) { obj += after - before; moves++; improved = true; } else {
          palette[j] = palette[i]!;
          palette[i] = tmp;
        }
      }
    }
    if (!improved) break;
  }
};
climb();
// 随机重启：打乱后重爬，取目标更优者（贪心初序可能落在坏局部最优）
let bestPalette = [...palette];
let bestObj = obj;
for (let r = 0; r < 3; r++) {
  for (let i = palette.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [palette[i], palette[j]] = [palette[j]!, palette[i]!];
  }
  obj = 0;
  for (let s = 0; s < paletteLen; s++) obj += slotCost(s, palette[s]!);
  climb();
  if (obj > bestObj) { bestObj = obj; bestPalette = [...palette]; }
}
for (let i = 0; i < paletteLen; i++) palette[i] = bestPalette[i]!;
obj = bestObj;

// ---------- 3. 报告 ----------
const pairs = [...ana.pairYears.entries()]
  .map(([k, years]) => {
    const [a, b] = k.split('|').map(Number) as [number, number];
    const p = pairScores(palette[a]!, palette[b]!);
    return { a, b, years, normal: p.normal, cvd: Math.min(p.protan, p.deutan), score: Math.min(p.normal, Math.min(p.protan, p.deutan) * 1.33) };
  })
  .sort((x, y) => x.score - y.score);
console.log(`共现槽对 ${pairs.length} 组；爬山移动 ${moves} 次`);
console.log('最差 10 组（ΔE normal/cvd，共现年数，槽对）：');
for (const p of pairs.slice(0, 10)) console.log(`  槽${p.a}×槽${p.b}  ${p.normal.toFixed(1)}/${p.cvd.toFixed(1)}  ${p.years}年  ${palette[p.a]} × ${palette[p.b]}`);
const weak = pairs.filter((p) => p.score < 6).length;
console.log(`得分<6 的共现对：${weak} 组（目标 0；6–8 为次级编码可接受带）`);

const dark = palette.map(darken);
const emit = (name: string, arr: string[]) => {
  console.log(`\nconst ${name} = [`);
  for (let i = 0; i < arr.length; i += 6) console.log('  ' + arr.slice(i, i + 6).map((c) => `'${c}',`).join(' '));
  console.log('];');
};
emit('CATEGORICAL_LIGHT', palette);
emit('CATEGORICAL_DARK', dark);

// 写死的族群→槽位映射：保证数据重排/增补时既有族群颜色不变（同一族群颜色跨时间、跨版本一致是硬约束；
// 同屏异族避让是尽力而为）。新族群由前端 assignPaletteSlots 以此映射为种子运行时补位。
const entries = [...ana.slotOf.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log('\nexport const PEOPLE_SLOT: Record<string, number> = {');
for (let i = 0; i < entries.length; i += 4) {
  console.log('  ' + entries.slice(i, i + 4).map(([c, s]) => `'${c}': ${s},`).join(' '));
}
console.log('};');
