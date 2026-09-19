// 族群分布（SQL）模式视图模型：
// - 颜色跟「族群」实体走（按 people_region 首次出现顺序固定分配调色板槽位）
// - 任一年份的着色 = 时间切片查询 people_region，同区多族群按 render_priority
//   取主族群（平局按 people_code 字典序）
// - 全部计算在内存中完成，时间轴拖动零网络请求

import type { SourceCode } from '../lib/contract.js';
import type { RegionVm, SourceView } from './load';
import { resolveRegionGeometry } from './region-map';

export interface AtlasTrItem {
  name_en: string | null;
  name_zh: string | null;
  brief_en?: string | null;
  brief_zh?: string | null;
}

export interface AtlasPeople extends AtlasTrItem {
  code: string;
  people_type: string | null;
  start_year: number | null;
  end_year: number | null;
  status_code: string | null;
  languages: Array<{ code: string; name_en: string | null; name_zh: string | null; role: string; sy: number | null; ey: number | null }>;
  religions: Array<{ code: string; name_en: string | null; name_zh: string | null; role: string; sy: number | null; ey: number | null }>;
  classifications: Array<{ taxonomy: string; node: string; name_en: string | null; name_zh: string | null; relation: string }>;
  relations: Array<{ rel: string; direction: 'out' | 'in'; other_code: string; other_name_en: string | null; other_name_zh: string | null; notes: string | null }>;
}

export interface AtlasPeopleRegion {
  people_code: string;
  region_code: string;
  presence: string;
  start_year: number | null;
  end_year: number | null;
  confidence: string;
  render_priority: number;
}

export interface AtlasPeriod extends AtlasTrItem {
  code: string;
  start_year: number | null;
  end_year: number | null;
}

export interface AtlasRegion extends AtlasTrItem {
  code: string;
  region_type: string | null;
  start_year: number | null;
  end_year: number | null;
}

export interface AtlasEvent extends AtlasTrItem {
  code: string;
  start_year: number | null;
  end_year: number | null;
  event_type: string | null;
  region_code: string | null;
  peoples: Array<{ people_code: string; role: string }>;
}

export interface AtlasData {
  generated_at: string;
  regions: AtlasRegion[];
  peoples: AtlasPeople[];
  people_region: AtlasPeopleRegion[];
  religions: Array<{ code: string; parent_code: string | null; name_en: string | null; name_zh: string | null }>;
  events: AtlasEvent[];
  periods: AtlasPeriod[];
  enums: Record<string, Record<string, Record<string, string>>>;
}

/** 分类调色板（dataviz 参考实例 8 槽，固定顺序分配；超过 8 个族群回绕并记录） */
const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const CATEGORICAL_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function categoricalPalette(): string[] {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
}

export interface PresenceRow extends AtlasPeopleRegion {
  people: AtlasPeople;
}

export interface RegionYearState {
  /** 该地区当年所有族群（含低优先级），render_priority 降序 */
  rows: PresenceRow[];
  /** 主族群（着色者） */
  top: PresenceRow;
}

export interface AtlasModel {
  data: AtlasData;
  peopleByCode: Map<string, AtlasPeople>;
  regionByCode: Map<string, AtlasRegion>;
  /** sql region -> geometry region_code 列表 */
  regionGeometry: Map<string, string[]>;
  /** geometry region_code -> 候选 sql region codes（一几何可属多历史区域） */
  geometryToRegions: Map<string, string[]>;
  /** 悬停解析：在该几何的候选 region 中，优先返回当年有活动族群者 */
  regionFor(code: string, year: number): { regionCode: string; state: RegionYearState | null } | null;
  /** people -> 固定颜色槽位 */
  peopleColor: Map<string, string>;
  yearRange: [number, number];
  /** T 年各 SQL 区域的状态（仅含有活动族群的区域） */
  regionsAt(year: number): Map<string, RegionYearState>;
  /** T 年 geometry code -> 填充色（主族群色；无数据区域不在结果中） */
  paintAt(year: number): Map<string, string>;
  /** 时期标签：包含该年的最窄 period */
  periodAt(year: number): AtlasPeriod | null;
  enumLabel(definition: string, code: string | null, lang: 'zh' | 'en'): string;
}

export function activeInYear(row: AtlasPeopleRegion, year: number): boolean {
  const sy = row.start_year ?? Number.NEGATIVE_INFINITY;
  const ey = row.end_year ?? Number.POSITIVE_INFINITY;
  return sy <= year && year <= ey;
}

export function buildAtlasModel(data: AtlasData, features: RegionVm[]): AtlasModel {
  const peopleByCode = new Map(data.peoples.map((p) => [p.code, p]));
  const regionByCode = new Map(data.regions.map((r) => [r.code, r]));
  const { byRegion: regionGeometry, byGeometry: geometryToRegions } = resolveRegionGeometry(features);

  // 颜色槽位：按 people_region 中首次出现顺序固定分配（颜色跟实体走，不随过滤变化）
  const order: string[] = [];
  for (const row of data.people_region) {
    if (!order.includes(row.people_code)) order.push(row.people_code);
  }
  const peopleColor = new Map<string, string>();
  const pal = categoricalPalette();
  order.forEach((code, i) => peopleColor.set(code, pal[i % pal.length]!));

  const yearCandidates: number[] = [];
  for (const p of data.periods) {
    if (p.start_year !== null) yearCandidates.push(p.start_year);
    if (p.end_year !== null) yearCandidates.push(p.end_year);
  }
  for (const r of data.people_region) {
    if (r.start_year !== null) yearCandidates.push(r.start_year);
    if (r.end_year !== null) yearCandidates.push(r.end_year);
  }
  const yearRange: [number, number] = [
    Math.min(...yearCandidates, -500),
    Math.max(...yearCandidates, new Date().getFullYear()),
  ];

  function regionsAt(year: number): Map<string, RegionYearState> {
    const byRegion = new Map<string, PresenceRow[]>();
    for (const row of data.people_region) {
      if (!activeInYear(row, year)) continue;
      const people = peopleByCode.get(row.people_code);
      if (!people) continue;
      const list = byRegion.get(row.region_code) ?? [];
      list.push({ ...row, people });
      byRegion.set(row.region_code, list);
    }
    const out = new Map<string, RegionYearState>();
    for (const [regionCode, rows] of byRegion) {
      rows.sort((a, b) => b.render_priority - a.render_priority || a.people_code.localeCompare(b.people_code));
      out.set(regionCode, { rows, top: rows[0]! });
    }
    return out;
  }

  function paintAt(year: number): Map<string, string> {
    const paint = new Map<string, string>();
    for (const [, state] of regionsAt(year)) {
      const color = peopleColor.get(state.top.people_code);
      if (!color) continue;
      for (const gcode of regionGeometry.get(state.top.region_code) ?? []) paint.set(gcode, color);
    }
    return paint;
  }

  function periodAt(year: number): AtlasPeriod | null {
    let best: AtlasPeriod | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;
    for (const p of data.periods) {
      const sy = p.start_year ?? Number.NEGATIVE_INFINITY;
      const ey = p.end_year ?? Number.POSITIVE_INFINITY;
      if (sy <= year && year <= ey) {
        const span = ey - sy;
        if (span < bestSpan) {
          bestSpan = span;
          best = p;
        }
      }
    }
    return best;
  }

  function enumLabel(definition: string, code: string | null, lang: 'zh' | 'en'): string {
    if (!code) return '—';
    const entry = data.enums[definition]?.[code];
    if (!entry) return code;
    return entry[lang] ?? entry.en ?? entry.zh ?? code;
  }

  function regionFor(code: string, year: number): { regionCode: string; state: RegionYearState | null } | null {
    const candidates = geometryToRegions.get(code);
    if (!candidates || candidates.length === 0) return null;
    const states = regionsAt(year);
    // 当年有活动族群的 region 优先（其中再按主族群 render_priority）
    const active = candidates
      .map((regionCode) => ({ regionCode, state: states.get(regionCode) ?? null }))
      .filter((c) => c.state !== null)
      .sort((a, b) => (b.state!.top.render_priority - a.state!.top.render_priority) || a.regionCode.localeCompare(b.regionCode));
    if (active.length > 0) return active[0]!;
    const passive = candidates.filter((c) => c !== 'europe');
    return { regionCode: passive[0] ?? candidates[0]!, state: null };
  }

  return { data, peopleByCode, regionByCode, regionGeometry, geometryToRegions, regionFor, peopleColor, yearRange, regionsAt, paintAt, periodAt, enumLabel };
}

/** 从 /data/export/atlas.json 拉取（带字节进度） */
export async function fetchAtlas(onBytes?: (loaded: number, total: number) => void): Promise<AtlasData> {
  const res = await fetch('/data/export/atlas.json');
  if (!res.ok) throw new Error(`atlas.json 加载失败：HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onBytes) return (await res.json()) as AtlasData;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onBytes(loaded, total);
    }
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged)) as AtlasData;
}

/** 族群分布模式的几何集合（绘制顺序 = 数组顺序，后者在上）：
 *  AWMC 帝国参考层垫底 -> DARMC 北非行省 -> NUTS L0 国家及英国构成国 L1
 *  （最上层承载着色）。 */
export function atlasGeometryFeatures(sources: Map<SourceCode, SourceView>): RegionVm[] {
  const out: RegionVm[] = [];
  out.push(...(sources.get('awmc')?.features ?? []).filter((vm) => vm.family === 'empire' && vm.snapshot === 117));
  const africaRe = /AFRICA|NUMIDIA|MAURETAN|AEGYPT|CYRENA|LIBYA|TRIPOLITAN|BYZACENA/i;
  out.push(...(sources.get('darmc')?.features ?? []).filter((vm) => vm.family === 'provinces' && africaRe.test(vm.nameEn ?? '')));
  out.push(...(sources.get('nuts')?.features ?? []).filter(
    (vm) => vm.level === 0 || (vm.level === 1 && ['GBR.1_1', 'GBR.3_1', 'GBR.4_1'].includes(vm.sourceId)),
  ));
  return out;
}
