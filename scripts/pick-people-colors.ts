// 新族群选色（npm run colors）：只为 src/frontend/people-colors.ts 的 PEOPLE_COLOR 中缺失的族群推荐颜色。
//
// 硬约束：既有族群颜色冻结——本脚本只读 PEOPLE_COLOR，从不改动/重排既有条目，
// 也不调整调色板；颜色一经写入表中即永久跟随该族群。
// 选色规则（确定性，同一份数据重跑结果相同）：
//   1. 候选 = scripts/pick-palette.mjs 色环网格池（正常视觉互距 ≥7）∪ 表中已用颜色；dark 变体由 darken 推导
//   2. 共现对象 = 与该族群同年上屏的其他族群（复刻前端 paintAt，见 paint-sim.ts）；
//      对象的颜色取其固定色（本轮先选的新族群也计入，后选者避让先选者）
//   3. 目标（字典序比较，越大越好）：同年同国共现对象的最小得分 → 同年同屏共现对象的最小得分
//      （两项均以 CAP 封顶，超过即视为足够可分）→ 被既有族群占用次数少者 → 候选池序靠前者
//      得分 = min(正常视觉 ΔE, CVD ΔE × 1.5)（Machado 模拟），亮/暗两套取小
// 输出待插入 PEOPLE_COLOR 的行（按键序插入），人工审阅后写入。
// 用法：npm run colors                    为缺色族群推荐
//       npm run colors -- --as-new a,b     预演：把已有颜色的 a,b 当作新族群重新推荐（不改表，仅供比对）

import { PEOPLE_COLOR } from '../src/frontend/people-colors.js';
import { countryOfGeom, order, paintPeopleAt, yMin, yMax } from './paint-sim.js';
import { buildPool, darken, pairScores } from './pick-palette.mjs';

const POOL_HUES = 26;
const POOL_FILTER = 7;
const CAP = 12;

const asNewIdx = process.argv.indexOf('--as-new');
const asNew = new Set(asNewIdx >= 0 ? (process.argv[asNewIdx + 1] ?? '').split(',').filter(Boolean) : []);
for (const code of asNew) if (!order.includes(code)) throw new Error(`--as-new: 数据中没有族群 ${code}`);

const fixed = new Map<string, readonly [string, string]>();
for (const [code, pair] of Object.entries(PEOPLE_COLOR)) if (!asNew.has(code)) fixed.set(code, pair);
const targets = order.filter((code) => !fixed.has(code));
if (targets.length === 0) {
  console.log(`OK: 全部 ${order.length} 个着色族群都已有固定颜色，无需选色`);
  process.exit(0);
}

// 共现统计：target -> partner -> { screen 年数, country 年数 }
const cooc = new Map<string, Map<string, { screen: number; country: number }>>(targets.map((t) => [t, new Map()]));
for (let y = yMin; y <= yMax; y++) {
  const paint = paintPeopleAt(y);
  const countriesOf = new Map<string, Set<string | null | undefined>>();
  for (const [g, p] of paint) {
    const set = countriesOf.get(p) ?? new Set();
    set.add(countryOfGeom.get(g));
    countriesOf.set(p, set);
  }
  for (const t of targets) {
    const mine = countriesOf.get(t);
    if (!mine) continue;
    const partners = cooc.get(t)!;
    for (const [p, theirs] of countriesOf) {
      if (p === t) continue;
      const e = partners.get(p) ?? { screen: 0, country: 0 };
      e.screen++;
      if ([...theirs].some((c) => c && mine.has(c))) e.country++;
      partners.set(p, e);
    }
  }
}

// 候选：池序在前，表中已用但不在池内的颜色在后（保持确定性）
const candidates: Array<readonly [string, string]> = buildPool(POOL_HUES, POOL_FILTER).map((l: string) => [l, darken(l)] as const);
for (const pair of fixed.values()) if (!candidates.some((c) => c[0] === pair[0])) candidates.push(pair);

const scoreCache = new Map<string, number>();
const score = (a: string, b: string): number => {
  const k = a < b ? `${a}|${b}` : `${b}|${a}`;
  let v = scoreCache.get(k);
  if (v === undefined) {
    const p = pairScores(a, b);
    v = Math.min(p.normal, Math.min(p.protan, p.deutan) * 1.5);
    scoreCache.set(k, v);
  }
  return v;
};
const pairScore = (x: readonly [string, string], y: readonly [string, string]): number =>
  Math.min(score(x[0], y[0]), score(x[1], y[1]));

const lexGreater = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
};

const chosen = new Map<string, readonly [string, string]>();
const report: string[] = [];
for (const t of targets) {
  const colorOf = (p: string) => fixed.get(p) ?? chosen.get(p);
  const uses = new Map<string, number>();
  for (const pair of [...fixed.values(), ...chosen.values()]) uses.set(pair[0], (uses.get(pair[0]) ?? 0) + 1);

  let best: { pair: readonly [string, string]; key: number[]; weakest: string } | null = null;
  for (const [idx, cand] of candidates.entries()) {
    let countryMin = CAP, screenMin = CAP, weakest = '', weakestScore = Infinity;
    for (const [p, e] of cooc.get(t)!) {
      const other = colorOf(p);
      if (!other) continue;
      const s = pairScore(cand, other);
      screenMin = Math.min(screenMin, s);
      if (e.country > 0) countryMin = Math.min(countryMin, s);
      if (s < weakestScore) { weakestScore = s; weakest = `${p} ΔE ${s.toFixed(1)}（同屏 ${e.screen} 年${e.country > 0 ? `，同国 ${e.country} 年` : ''}）`; }
    }
    const key = [countryMin, screenMin, -(uses.get(cand[0]) ?? 0), -idx];
    if (!best || lexGreater(key, best.key)) {
      best = { pair: cand, key, weakest: weakest || '无同屏共现族群' };
    }
  }
  const pick = best!;
  chosen.set(t, pick.pair);
  report.push(`  ${t}: ['${pick.pair[0]}', '${pick.pair[1]}'], // 最弱共现：${pick.weakest}`);
}

console.log(`${asNew.size > 0 ? '预演（--as-new，不改表）' : '缺色族群'} ${targets.length} 个；候选 ${candidates.length} 色；既有颜色冻结 ${fixed.size} 条\n`);
console.log('按键序插入 src/frontend/people-colors.ts 的 PEOPLE_COLOR：');
for (const line of report) console.log(line);
