// 覆盖审计：以时间轴最小步长（1 年）为粒度，逐年检查每个映射几何的着色状态，
// 找出「上一个时间片有族群、下一个时间片空白」的断档（空窗）。
//   核心 = nuts 现代国家几何（欧洲核心区）+ 北非/黎凡特 DARMC 303 年行省几何，必须零空窗
//   豁免 = 快照叠加层（AWMC 帝国快照：帝国消亡即隐没；当前无映射，段落仅在重新启用时出现）
// 另校验 data/peoples/export/atlas-geometry.geojson（前端启动加载的族群分布几何子集）未过期：
// 须与由三源全量几何 + 当前 region_geometry / 渲染策略重新生成的内容逐字节一致。
// 用法：npm run audit   （先 npm run project 保证 atlas.json 与几何子集最新）
// 有核心空窗或几何子集过期时退出码 1，可作回归门禁。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRegionGeometry, type RegionGeometryRule } from '../src/frontend/region-map.js';
import { FAMILY } from '../src/frontend/load.js';
import { atlasGeometryFeatures, atlasYearRange, activeInYear } from '../src/frontend/atlas.js';
import { REPO_ROOT } from '../src/lib/contract.js';
import { ATLAS_GEOMETRY_REL, loadSourceViews, renderAtlasGeometry } from '../src/build/atlas-geometry.js';

interface AtlasPeopleRegion {
  region_code: string;
  start_year: number | null;
  end_year: number | null;
}
interface AtlasData {
  people_region: AtlasPeopleRegion[];
  periods: Array<{ start_year: number | null; end_year: number | null }>;
  region_geometry: RegionGeometryRule[];
}

const atlas = JSON.parse(readFileSync(join(REPO_ROOT, 'data/peoples/export/atlas.json'), 'utf8')) as AtlasData;
const [yearMin, yearMax] = atlasYearRange(atlas);

// 几何：三源规范化产物，经 atlasGeometryFeatures 取「实际渲染集合」
// （与前端同一套规则：细分国家只渲染次国家级单元），再过 region 映射。
const allFeatures = atlasGeometryFeatures(loadSourceViews(), atlas.region_geometry ?? []);
const vmByCode = new Map(allFeatures.map((vm) => [vm.code, vm]));
const { byGeometry } = resolveRegionGeometry(allFeatures, atlas.region_geometry ?? []);

// 逐年活跃 region 集合
const years: number[] = [];
for (let y = yearMin; y <= yearMax; y++) years.push(y);
const activeRegionsByYear = years.map((year) => {
  const set = new Set<string>();
  for (const row of atlas.people_region) if (activeInYear(row, year)) set.add(row.region_code);
  return set;
});

interface Gap {
  from: number;
  to: number;
}
interface GeomReport {
  code: string;
  label: string;
  core: boolean;
  firstCover: number | null;
  gaps: Gap[];
}

const reports: GeomReport[] = [];
const coveredGeom = new Set<string>(); // 任一年份曾被着色的几何
for (const [geomCode, regionCodes] of byGeometry) {
  const vm = vmByCode.get(geomCode);
  if (!vm) continue;
  const colored = activeRegionsByYear.map((set) => regionCodes.some((r) => set.has(r)));
  let firstCover: number | null = null;
  const gaps: Gap[] = [];
  let run: number | null = null;
  for (let i = 0; i < years.length; i++) {
    if (colored[i]) {
      if (run !== null) {
        gaps.push({ from: years[run]!, to: years[i - 1]! });
        run = null;
      }
      if (firstCover === null) firstCover = years[i]!;
    } else if (firstCover !== null) {
      if (run === null) run = i;
    }
  }
  if (run !== null) gaps.push({ from: years[run]!, to: years[years.length - 1]! });
  if (firstCover !== null) coveredGeom.add(geomCode);
  if (firstCover === null) continue; // 从未覆盖：不计入空窗（汇总于下方「从未覆盖」段）
  reports.push({
    code: geomCode,
    label: vm.nameZh ?? vm.nameEn ?? geomCode,
    core: vm.family === FAMILY.nuts || vm.family === FAMILY.provinces,
    firstCover,
    gaps,
  });
}

const fmt = (g: Gap): string => `${g.from < 0 ? `前${-g.from}` : g.from}–${g.to < 0 ? `前${-g.to}` : g.to === yearMax ? '今' : g.to}`;
const core = reports.filter((r) => r.core).sort((a, b) => a.code.localeCompare(b.code));
const exempt = reports.filter((r) => !r.core).sort((a, b) => a.code.localeCompare(b.code));

console.log(`覆盖审计：${yearMin < 0 ? `前${-yearMin}` : yearMin} – ${yearMax}，步长 1 年；映射几何 ${reports.length} 个\n`);
console.log('== 核心几何（现代国家 + 北非/黎凡特行省，必须零空窗） ==');
for (const r of core) {
  const gapStr = r.gaps.length === 0 ? '✓ 无空窗' : r.gaps.map(fmt).join(', ');
  console.log(`  ${r.code.padEnd(14)} ${r.label.padEnd(6)} 首覆盖 ${r.firstCover}  ${gapStr}`);
}
const coreGaps = core.filter((r) => r.gaps.length > 0);
console.log(`\n核心空窗几何数：${coreGaps.length}`);
if (exempt.length > 0) {
  console.log('\n== 豁免（快照叠加层，仅报告） ==');
  for (const r of exempt) console.log(`  ${r.code.slice(0, 48).padEnd(48)} 首覆盖 ${r.firstCover}  ${r.gaps.map(fmt).join(', ')}`);
}

// 从未覆盖的 L0 国家（未被任何 region 映射，或映射了但任何年份都无切片）：
// 只报告不拦截——微观国家与范围外（土耳其/塞浦路斯等）属设计性留白。
const neverCovered = allFeatures
  .filter((vm) => vm.family === FAMILY.nuts && vm.level === 0 && !coveredGeom.has(vm.code))
  .sort((a, b) => a.code.localeCompare(b.code));
if (neverCovered.length > 0) {
  console.log('\n== 从未覆盖的 L0 国家（信息，不拦截） ==');
  for (const vm of neverCovered) console.log(`  ${vm.code.padEnd(14)} ${vm.nameZh ?? vm.nameEn ?? ''}`);
  console.log(`  共 ${neverCovered.length} 个`);
}

// 几何子集过期校验（前端族群分布只读子集；子集与全量求值结果一致的前提是子集为最新）
const geoPath = join(REPO_ROOT, ATLAS_GEOMETRY_REL);
const geoFresh = existsSync(geoPath) && readFileSync(geoPath, 'utf8') === renderAtlasGeometry(REPO_ROOT, atlas.region_geometry ?? []).text;
console.log(`\n几何子集 ${ATLAS_GEOMETRY_REL}：${geoFresh ? '✓ 最新' : '✗ 缺失或过期'}`);

if (coreGaps.length > 0) console.error('\nFAIL: 核心几何存在空窗（见上）');
if (!geoFresh) console.error('FAIL: 几何子集缺失或过期——运行 npm run project 重新生成');
if (coreGaps.length > 0 || !geoFresh) process.exit(1);
console.log('\nOK: 核心几何零空窗，几何子集最新');
