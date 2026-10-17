// 着色模拟（node 侧复刻前端 paintAt 竞争规则），供 palette-collisions.ts / pick-people-colors.ts 共用：
// 每个几何取当年主族群——区域内 render_priority 高者胜，跨区域竞争同规则，平局按族群码字典序。
// 只决定「哪个族群上屏」，与颜色无关。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRegionGeometry, countryOf, type RegionGeometryRule } from '../src/frontend/region-map.js';
import { FAMILY } from '../src/frontend/load.js';
import { activeInYear, atlasYearRange } from '../src/frontend/atlas.js';
import { atlasGeometryFeatures } from '../src/frontend/atlas-subset.js';
import { REPO_ROOT } from '../src/lib/contract.js';
import { loadSourceViews } from '../src/build/atlas-geometry.js';

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
const atlas = JSON.parse(readFileSync(join(REPO_ROOT, 'data/peoples/export/atlas.json'), 'utf8')) as Data;

const features = atlasGeometryFeatures(loadSourceViews(), atlas.region_geometry ?? []);
const { byRegion } = resolveRegionGeometry(features, atlas.region_geometry ?? []);

/** geometry code -> NUTS L0 国家码（非 NUTS 几何为 null） */
export const countryOfGeom = new Map<string, string | null>(
  features.map((vm) => [vm.code, vm.family === FAMILY.nuts ? countryOf(vm) : null]),
);

/** people_region 中出现的族群（首现顺序） */
export const order: string[] = [];
for (const row of atlas.people_region) if (!order.includes(row.people_code)) order.push(row.people_code);

// 年份范围（与前端 yearRange 同口径）
export const [yMin, yMax] = atlasYearRange(atlas);

/** T 年 geometry code -> 主族群 */
export function paintPeopleAt(year: number): Map<string, string> {
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
