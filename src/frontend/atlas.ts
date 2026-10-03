// 族群分布（SQL）模式视图模型：
// - 颜色跟「族群」实体走（槽位写死在 PEOPLE_SLOT，跨时间/跨数据版本不变；
//   新族群运行时按同年共现避让补位，见 assignPaletteSlots）
// - 任一年份的着色 = 时间切片查询 people_region，同区多族群按 render_priority
//   取主族群（平局按 people_code 字典序）
// - 全部计算在内存中完成，时间轴拖动零网络请求

import { featureCollection, rewind, union } from '@turf/turf';
import type { SourceCode } from '../lib/contract.js';
import type { RegionVm, SourceView } from './load';
import { resolveRegionGeometry, countryOf, type RegionGeometryRule } from './region-map';

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
  /** 面向用户的标注：disputed（争议）/ method（特殊处理说明）；无则 null */
  caveat_kind: string | null;
  caveat_zh: string | null;
  caveat_en: string | null;
  /** 标注显示窗口（缺省即时间片区间；仅窗口内年份显示） */
  caveat_sy: number | null;
  caveat_ey: number | null;
}

export type CaveatKind = 'disputed' | 'method';

/** 该行在 year 年是否显示标注（行本身须当年活动） */
export function caveatActive(row: AtlasPeopleRegion, year: number): boolean {
  if (!row.caveat_kind || !activeInYear(row, year)) return false;
  return (row.caveat_sy ?? Number.NEGATIVE_INFINITY) <= year && year <= (row.caveat_ey ?? Number.POSITIVE_INFINITY);
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

export interface AtlasTaxonomyNode {
  code: string;
  parent: string | null;
  sort: number;
  name_en: string | null;
  name_zh: string | null;
}

export interface AtlasTaxonomy {
  code: string;
  nodes: AtlasTaxonomyNode[];
}

export interface AtlasData {
  generated_at: string;
  regions: AtlasRegion[];
  peoples: AtlasPeople[];
  people_region: AtlasPeopleRegion[];
  /** region -> 几何映射规则（region_geometry_rule 表，驱动 resolveRegionGeometry 与叠加层选取） */
  region_geometry: RegionGeometryRule[];
  religions: Array<{ code: string; parent_code: string | null; name_en: string | null; name_zh: string | null }>;
  events: AtlasEvent[];
  periods: AtlasPeriod[];
  taxonomies: AtlasTaxonomy[];
  enums: Record<string, Record<string, Record<string, string>>>;
}

/** 分类调色板（64 槽，亮/暗两套）+ 族群→槽位写死映射 PEOPLE_SLOT。
 *  - 硬约束（同一族群颜色跨时间、跨数据版本一致）：88 族群的槽位写死在
 *    PEOPLE_SLOT，数据重排/增补不漂移；由 scripts/palette-tune.ts 生成输出后
 *    粘贴于此，数据变更后重跑再粘贴。无槽位的新族群由 assignPaletteSlots
 *    以此为种子运行时贪心补位（对「同年同屏共现」避让）。
 *  - 尽力而为（同年同屏异族颜色尽量避免冲突，非硬性）：调色板颜色按
 *    「实际共现槽对」爬山优化（OKLab ΔE + Machado CVD 模拟；同年 45 团的
 *    色度学上限使全对 CVD≥6 不可行，弱对靠谱系树 + hover 次级编码消歧）。
 *  - 构造管线：scripts/pick-palette.mjs（26 色相 × 5 明度 × 3 色度网格，
 *    正常视觉互距 ≥7 过滤成 67 色池）→ scripts/palette-tune.ts（避让分配 +
 *    共现对调优 + 写死映射输出）。
 */
const CATEGORICAL_LIGHT = [
  '#5e548c', '#004f7a', '#5d0099', '#006e5f', '#9d703b', '#00be9d',
  '#a0adff', '#89474e', '#326ff4', '#7c84ff', '#00dc70', '#5d2e57',
  '#8b0000', '#b39700', '#ff8cb3', '#7ca66f', '#4842d0', '#7b053f',
  '#00e0bc', '#cd72c1', '#ac43c8', '#daa2d1', '#593d00', '#002baf',
  '#f85093', '#ff7df1', '#6a2c26', '#7a0071', '#c0c100', '#a70076',
  '#9bc68e', '#f7a600', '#00ccfb', '#47b407', '#2e58b1', '#006d99',
  '#678800', '#00957e', '#666ed1', '#33328f', '#91699d', '#676300',
  '#b50038', '#8c1da7', '#7f58ea', '#7b98d0', '#b66efe', '#009a31',
  '#ff7668', '#e9a48a', '#00b0c8', '#d83800', '#ca8379', '#ca3194',
  '#a33600', '#6bcac8', '#009bff', '#005c00', '#2f86a0', '#005144',
  '#d68eff', '#c24d5f', '#007b07', '#dd7c2a',
];
const CATEGORICAL_DARK = [
  '#6f669b', '#246088', '#6c2ba6', '#2e7f70', '#ad8353', '#49d0b0',
  '#abb8ff', '#995a60', '#4a85ff', '#8f99ff', '#3edf7c', '#6d4066',
  '#9b291f', '#c4aa3d', '#ff98bb', '#91b885', '#575adc', '#8b274f',
  '#33dbb9', '#dd88d1', '#bc5dd6', '#deaad6', '#684e1f', '#1544bb',
  '#ff6da6', '#ff8bf4', '#7a3f38', '#8a2880', '#c4c636', '#b73186',
  '#a3cb97', '#f7ad35', '#3dd0fb', '#64c640', '#436bbe', '#2f7fa8',
  '#7a9a33', '#3ca690', '#7882de', '#42469c', '#a27cad', '#777429',
  '#c5334c', '#9c3db5', '#8f70f6', '#8fabdf', '#c686ff', '#3bab4d',
  '#ff8e80', '#ecac94', '#46c2d8', '#e75632', '#da978e', '#da50a5',
  '#b24e28', '#7acfcd', '#40afff', '#266c22', '#4c98b0', '#246154',
  '#e09eff', '#d26473', '#308c2f', '#ed924d',
];
const PALETTE_LEN = CATEGORICAL_LIGHT.length;

/** 族群→槽位写死映射（scripts/palette-tune.ts 输出；同一族群颜色跨版本一致的硬约束） */
export const PEOPLE_SLOT: Record<string, number> = {
  'albanians': 0, 'alemanni': 24, 'angles': 3, 'arabs_crete': 0, 'arabs_levant': 52, 'arabs_north_africa': 56,
  'arameans': 57,
  'arabs_sicily': 43, 'armenians': 3, 'avars': 6, 'azerbaijanis': 6,
  'balts': 19, 'basques': 9, 'bavarians': 5, 'belarusians': 10, 'berbers': 62,
  'bosniaks': 4, 'bretons': 11, 'britons': 10, 'bulgarians': 12,
  'burgundians': 12, 'carthaginians': 49, 'catalans': 14, 'crusaders': 55, 'celtiberians': 5, 'celts': 3,
  'crimean_tatars': 8, 'croats': 18, 'czechs': 19, 'dacians': 11,
  'danes': 21, 'dutch': 25, 'egyptians': 58, 'english': 22, 'estonian': 23,
  'finns': 24, 'franks': 4, 'french': 26, 'gaels': 31,
  'gauls': 4, 'georgians': 28, 'gepids': 18, 'germanic_tribes': 6,
  'germans': 5, 'goths': 8, 'greeks': 16, 'hungarians': 29,
  'huns': 5, 'iberians': 0, 'illyrians': 2, 'irish': 30,
  'italians': 15, 'jews': 50, 'jutes': 0, 'karelians': 32, 'kurds': 59, 'latins': 13,
  'latvians': 33, 'lithuanians': 34, 'lombards': 15, 'lusitanians': 12,
  'macedonians': 35, 'magyars': 13, 'masurians': 0, 'montenegrins': 20, 'moors': 1,
  'norse': 22, 'persians': 60, 'phoenicians': 63, 'norwegians': 38, 'ostrogoths': 2, 'picts': 23,
  'poles': 36, 'portuguese': 37, 'prussians': 37, 'romanians': 39,
  'romans': 1, 'rus': 10, 'russians': 17, 'sami': 40, 'sardinians': 41, 'sarmatians': 51,
  'saxons': 17, 'scots': 42, 'serbs': 7, 'slavs': 20,
  'slovaks': 44, 'slovenes': 45, 'spaniards': 2, 'suebi': 7,
  'swedes': 46, 'tatars': 43, 'thracians': 0, 'thuringians': 25,
  'turks': 13, 'ukrainians': 27, 'vandals': 14, 'visigoths': 0,
  'volga_bulgars': 47, 'welsh': 48,
};

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
  /** 悬停解析：在该几何的候选 region 中，优先返回当年有活动族群者；地区存续期外的候选不参与 */
  regionFor(code: string, year: number): { regionCode: string; state: RegionYearState | null } | null;
  /** 几何当年是否绘制：映射到的地区全部在存续期（region.years）外则隐藏
   *  （如罗马帝国快照在 476 年后不再以「罗马帝国」名义占位）；未映射几何照常作中性底图 */
  geometryLive(code: string, year: number): boolean;
  /** people -> 固定颜色槽位 */
  peopleColor: Map<string, string>;
  /** people -> 调色板槽位序（people_region 首现顺序；未上色者为 Infinity） */
  slotIndex: Map<string, number>;
  yearRange: [number, number];
  /** T 年各 SQL 区域的状态（仅含有活动族群的区域） */
  regionsAt(year: number): Map<string, RegionYearState>;
  /** T 年 geometry code -> 填充色（主族群色；无数据区域不在结果中） */
  paintAt(year: number): Map<string, string>;
  /** T 年 geometry code -> 标注类型（胜出区域当年任一行有标注即标记；disputed 优先于 method） */
  caveatAt(year: number): Map<string, CaveatKind>;
  /** 时期标签：包含该年的最窄 period */
  periodAt(year: number): AtlasPeriod | null;
  /** 族群谱系树：全部族群按分类层级组织，标注当年活动状态 */
  peopleTreeAt(year: number): TreeGroup[];
  enumLabel(definition: string, code: string | null, lang: 'zh' | 'en'): string;
}

/** 谱系树叶节点 = 一个族群（含当年活动状态与活动区域） */
export interface TreeLeaf {
  people: AtlasPeople;
  color: string | null;
  active: boolean;
  regions: AtlasRegion[];
}

/** 谱系树枝 = 分类节点（语系/语族/语支等）；node 为 null 表示直接挂组级 */
export interface TreeBranch {
  node: AtlasTaxonomyNode | null;
  leaves: TreeLeaf[];
  children: TreeBranch[];
  activeCount: number;
  totalCount: number;
}

/** 谱系树组 = 一个 taxonomy（语言谱系/现代族群/…）或未分类 */
export interface TreeGroup {
  key: string;
  root: TreeBranch;
  open: boolean;
}

/** taxonomy 优先级：语言谱系在前（历史族群的从属关系主要来自语言分类） */
const TAX_PRIORITY: Record<string, number> = { language: 0, historical_people: 1, modern_ethnicity: 2 };

interface TaxIdx {
  byCode: Map<string, AtlasTaxonomyNode>;
  children: Map<string | null, AtlasTaxonomyNode[]>;
  depth: Map<string, number>;
}

export function activeInYear(row: AtlasPeopleRegion, year: number): boolean {
  const sy = row.start_year ?? Number.NEGATIVE_INFINITY;
  const ey = row.end_year ?? Number.POSITIVE_INFINITY;
  return sy <= year && year <= ey;
}

/**
 * 调色板槽位分配（前端 buildAtlasModel 与门禁 scripts/palette-collisions.ts 共用）。
 * 硬约束：同一族群颜色跨时间、跨数据版本一致——既有族群的槽位写死在 PEOPLE_SLOT
 * （由 scripts/palette-tune.ts 生成，数据重排/增补不漂移），此处仅作种子。
 * 尽力而为：未写死的新族群按 people_region 首现顺序贪心避让——取「同年同屏共现」
 * （该年任一地区的主着色族群，跨国亦冲突）族群尚未占用的最低槽位；全被占用时取
 * 共现年数合计最小的槽（平局取低槽）。「同屏」口径与 paintAt 一致。
 */
export function assignPaletteSlots(
  data: Pick<AtlasData, 'people_region' | 'periods' | 'region_geometry'>,
  features: RegionVm[],
  order: string[],
  paletteLen: number = PALETTE_LEN,
  seed?: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
): Map<string, number> {
  const { byRegion } = resolveRegionGeometry(features, data.region_geometry ?? []);

  const cands: number[] = [];
  for (const p of data.periods) {
    if (p.start_year !== null) cands.push(p.start_year);
    if (p.end_year !== null) cands.push(p.end_year);
  }
  for (const r of data.people_region) {
    if (r.start_year !== null) cands.push(r.start_year);
    if (r.end_year !== null) cands.push(r.end_year);
  }
  const yMin = Math.min(...cands, -500);
  const yMax = Math.max(...cands, new Date().getFullYear());

  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  // 同年同屏共现年数（用作冲突边与饱和时的权重）
  const pairYears = new Map<string, number>();
  for (let y = yMin; y <= yMax; y++) {
    const byRegionYear = new Map<string, AtlasPeopleRegion[]>();
    for (const row of data.people_region) {
      if (!activeInYear(row, y)) continue;
      const list = byRegionYear.get(row.region_code) ?? [];
      list.push(row);
      byRegionYear.set(row.region_code, list);
    }
    const tops = new Set<string>();
    for (const [regionCode, rows] of byRegionYear) {
      if ((byRegion.get(regionCode) ?? []).length === 0) continue; // 无几何映射的 region 不上屏
      rows.sort((a, b) => b.render_priority - a.render_priority || a.people_code.localeCompare(b.people_code));
      tops.add(rows[0]!.people_code);
    }
    const arr = [...tops].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const k = pairKey(arr[i]!, arr[j]!);
        pairYears.set(k, (pairYears.get(k) ?? 0) + 1);
      }
    }
  }

  const conflicts = new Map<string, Set<string>>();
  for (const k of pairYears.keys()) {
    const [a, b] = k.split('|') as [string, string];
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const set = conflicts.get(x) ?? new Set<string>();
      set.add(y);
      conflicts.set(x, set);
    }
  }

  const slot = new Map<string, number>();
  // 写死的槽位先行落座（截到合法区间）；新族群在其基础上避让
  const seedPairs: Array<[string, number]> = seed instanceof Map ? [...seed] : Object.entries(seed ?? {});
  for (const [code, s] of seedPairs) {
    if (Number.isInteger(s) && s >= 0) slot.set(code, s % paletteLen);
  }
  for (const code of order) {
    if (slot.has(code)) continue;
    // 已分配的共现族群占用的槽 -> 共现年数合计
    const taken = new Map<number, number>();
    for (const other of conflicts.get(code) ?? []) {
      const s = slot.get(other);
      if (s === undefined) continue;
      taken.set(s, (taken.get(s) ?? 0) + (pairYears.get(pairKey(code, other)) ?? 0));
    }
    let s = 0;
    while (s < paletteLen && taken.has(s)) s++;
    if (s >= paletteLen) {
      // 饱和：取共现年数合计最小的槽（平局取低槽），把伤害压到 hover 可消歧的程度
      s = [...taken.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0]![0];
    }
    slot.set(code, s);
  }
  return slot;
}

export function buildAtlasModel(data: AtlasData, features: RegionVm[]): AtlasModel {
  const peopleByCode = new Map(data.peoples.map((p) => [p.code, p]));
  const regionByCode = new Map(data.regions.map((r) => [r.code, r]));
  const { byRegion: regionGeometry, byGeometry: geometryToRegions } = resolveRegionGeometry(features, data.region_geometry ?? []);

  // 颜色槽位：写死映射为种子 + 新族群运行时避让（颜色跟实体走，不随过滤/年份变化）
  const order: string[] = [];
  for (const row of data.people_region) {
    if (!order.includes(row.people_code)) order.push(row.people_code);
  }
  const pal = categoricalPalette();
  const slot = assignPaletteSlots(data, features, order, PALETTE_LEN, PEOPLE_SLOT);
  const peopleColor = new Map<string, string>();
  for (const code of order) peopleColor.set(code, pal[slot.get(code) ?? 0]!);
  const slotIndex = new Map<string, number>(order.map((code, i) => [code, i]));

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

  /** 每个几何当年的胜出区域状态（paintAt / caveatAt 共用） */
  function winnersAt(year: number): Map<string, { color: string; pr: number; code: string; state: RegionYearState }> {
    // 一几何可属多区域（如 at ∈ {austria, central_europe}）：
    // 跨区域竞争与 regionFor（hover）同规则——主族群 render_priority 高者胜，
    // 平局按 people_code 字典序，避免「后写覆盖」的不确定着色。
    const best = new Map<string, { color: string; pr: number; code: string; state: RegionYearState }>();
    for (const [, state] of regionsAt(year)) {
      const color = peopleColor.get(state.top.people_code);
      if (!color) continue;
      const cand = { color, pr: state.top.render_priority, code: state.top.people_code, state };
      for (const gcode of regionGeometry.get(state.top.region_code) ?? []) {
        const cur = best.get(gcode);
        if (!cur || cand.pr > cur.pr || (cand.pr === cur.pr && cand.code.localeCompare(cur.code) < 0)) {
          best.set(gcode, cand);
        }
      }
    }
    return best;
  }

  function paintAt(year: number): Map<string, string> {
    const paint = new Map<string, string>();
    for (const [gcode, win] of winnersAt(year)) paint.set(gcode, win.color);
    return paint;
  }

  function caveatAt(year: number): Map<string, CaveatKind> {
    const out = new Map<string, CaveatKind>();
    for (const [gcode, win] of winnersAt(year)) {
      let kind: CaveatKind | null = null;
      for (const row of win.state.rows) {
        if (!caveatActive(row, year)) continue;
        if (row.caveat_kind === 'disputed') {
          kind = 'disputed';
          break;
        }
        kind = 'method';
      }
      if (kind) out.set(gcode, kind);
    }
    return out;
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

  // ---------------- 谱系树 ----------------
  // taxonomy 索引：code -> node、parent -> children、code -> 深度
  const taxIdx = new Map<string, TaxIdx>();
  for (const tax of data.taxonomies ?? []) {
    const byCode = new Map(tax.nodes.map((n) => [n.code, n]));
    const children = new Map<string | null, AtlasTaxonomyNode[]>();
    for (const n of tax.nodes) {
      const list = children.get(n.parent) ?? [];
      list.push(n);
      children.set(n.parent, list);
    }
    const depth = new Map<string, number>();
    for (const n of tax.nodes) {
      let d = 0;
      let cur = n;
      const seen = new Set<string>([n.code]);
      while (cur.parent !== null && !seen.has(cur.parent)) {
        seen.add(cur.parent);
        d++;
        const parent = byCode.get(cur.parent);
        if (!parent) break;
        cur = parent;
      }
      depth.set(n.code, d);
    }
    taxIdx.set(tax.code, { byCode, children, depth });
  }

  /** 族群的挂载点：在优先 taxonomy 内取最深分类节点 */
  function attachOf(people: AtlasPeople): { taxonomy: string; node: AtlasTaxonomyNode } | null {
    const byTax = new Map<string, AtlasTaxonomyNode[]>();
    for (const c of people.classifications) {
      if (c.relation !== 'member_of' && c.relation !== 'descendant_of') continue;
      const idx = taxIdx.get(c.taxonomy);
      const node = idx?.byCode.get(c.node);
      if (!idx || !node) continue;
      const list = byTax.get(c.taxonomy) ?? [];
      if (!list.includes(node)) list.push(node);
      byTax.set(c.taxonomy, list);
    }
    if (byTax.size === 0) return null;
    const taxCode = [...byTax.keys()].sort(
      (a, b) => (TAX_PRIORITY[a] ?? 90) - (TAX_PRIORITY[b] ?? 90) || a.localeCompare(b),
    )[0]!;
    const nodes = byTax.get(taxCode)!;
    const idx = taxIdx.get(taxCode)!;
    nodes.sort(
      (a, b) => idx.depth.get(b.code)! - idx.depth.get(a.code)! || a.sort - b.sort || a.code.localeCompare(b.code),
    );
    return { taxonomy: taxCode, node: nodes[0]! };
  }

  function peopleTreeAt(year: number): TreeGroup[] {
    // 当年活动：people -> 活动区域列表
    const activeRegions = new Map<string, AtlasRegion[]>();
    for (const [regionCode, state] of regionsAt(year)) {
      const region = regionByCode.get(regionCode) ?? null;
      for (const row of state.rows) {
        const list = activeRegions.get(row.people_code) ?? [];
        if (region) list.push(region);
        activeRegions.set(row.people_code, list);
      }
    }
    const makeLeaf = (code: string): TreeLeaf => ({
      people: peopleByCode.get(code)!,
      color: peopleColor.get(code) ?? null,
      active: activeRegions.has(code),
      regions: activeRegions.get(code) ?? [],
    });
    const bySlot = (a: TreeLeaf, b: TreeLeaf): number =>
      (slotIndex.get(a.people.code) ?? Infinity) - (slotIndex.get(b.people.code) ?? Infinity) ||
      a.people.code.localeCompare(b.people.code);

    // taxonomy -> node code -> 挂载的 peoples
    const attach = new Map<string, Map<string, string[]>>();
    const unclassified: string[] = [];
    for (const p of data.peoples) {
      const at = attachOf(p);
      if (!at) {
        unclassified.push(p.code);
        continue;
      }
      const tax = attach.get(at.taxonomy) ?? new Map<string, string[]>();
      const list = tax.get(at.node.code) ?? [];
      list.push(p.code);
      tax.set(at.node.code, list);
      attach.set(at.taxonomy, tax);
    }

    // 递归建枝：只保留含挂载族群的分支；
    // 单叶同码的节点（modern_ethnicity 各叶与族群同名同码）上提到父级，避免「法国人→法国人」
    function buildBranch(taxCode: string, node: AtlasTaxonomyNode | null): TreeBranch {
      const idx = taxIdx.get(taxCode)!;
      const mounted = attach.get(taxCode)!;
      const childNodes = (idx.children.get(node?.code ?? null) ?? [])
        .slice()
        .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
      const lifted: TreeLeaf[] = [];
      const children: TreeBranch[] = [];
      for (const cn of childNodes) {
        const mountedHere = mounted.get(cn.code) ?? [];
        const collapsible =
          mountedHere.length === 1 &&
          (idx.children.get(cn.code)?.length ?? 0) === 0 &&
          mountedHere[0] === cn.code;
        if (collapsible) {
          lifted.push(makeLeaf(mountedHere[0]!));
          continue;
        }
        const branch = buildBranch(taxCode, cn);
        if (branch.totalCount > 0) children.push(branch);
      }
      const own = node === null ? [] : (mounted.get(node.code) ?? []);
      const leaves = [...own.map(makeLeaf), ...lifted].sort(bySlot);
      const activeCount = leaves.filter((l) => l.active).length + children.reduce((s, c) => s + c.activeCount, 0);
      const totalCount = leaves.length + children.reduce((s, c) => s + c.totalCount, 0);
      return { node, leaves, children, activeCount, totalCount };
    }

    const groups: TreeGroup[] = [];
    const taxCodes = [...attach.keys()].sort(
      (a, b) => (TAX_PRIORITY[a] ?? 90) - (TAX_PRIORITY[b] ?? 90) || a.localeCompare(b),
    );
    for (const taxCode of taxCodes) {
      const root = buildBranch(taxCode, null);
      if (root.totalCount === 0) continue;
      groups.push({ key: taxCode, root, open: root.activeCount > 0 });
    }
    if (unclassified.length > 0) {
      const leaves = unclassified.map(makeLeaf).sort(bySlot);
      groups.push({
        key: 'unclassified',
        root: {
          node: null,
          leaves,
          children: [],
          activeCount: leaves.filter((l) => l.active).length,
          totalCount: leaves.length,
        },
        open: leaves.some((l) => l.active),
      });
    }
    return groups;
  }

  // 地区「存续」= 年份落在 region.years 内，或当年仍有活动时间片（region.years 与切片不一致时以切片为准，避免已着色几何被隐藏）
  let liveCache: { year: number; active: Set<string> } | null = null;
  const regionLive = (regionCode: string, year: number): boolean => {
    const r = regionByCode.get(regionCode);
    if (!r || ((r.start_year ?? Number.NEGATIVE_INFINITY) <= year && year <= (r.end_year ?? Number.POSITIVE_INFINITY))) return true;
    if (liveCache?.year !== year) {
      const active = new Set<string>();
      for (const row of data.people_region) if (activeInYear(row, year)) active.add(row.region_code);
      liveCache = { year, active };
    }
    return liveCache.active.has(regionCode);
  };

  function geometryLive(code: string, year: number): boolean {
    const candidates = geometryToRegions.get(code);
    return !candidates || candidates.length === 0 || candidates.some((rc) => regionLive(rc, year));
  }

  function regionFor(code: string, year: number): { regionCode: string; state: RegionYearState | null } | null {
    const candidates = geometryToRegions.get(code)?.filter((rc) => regionLive(rc, year));
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

  return { data, peopleByCode, regionByCode, regionGeometry, geometryToRegions, regionFor, geometryLive, peopleColor, slotIndex, yearRange, regionsAt, paintAt, caveatAt, periodAt, peopleTreeAt, enumLabel };
}

/** 从 /data/peoples/export/atlas.json 拉取（带字节进度） */
export async function fetchAtlas(onBytes?: (loaded: number, total: number) => void): Promise<AtlasData> {
  const res = await fetch('/data/peoples/export/atlas.json');
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
 *  AWMC 帝国参考层垫底（当前无映射）-> DARMC 北非/黎凡特行省 -> NUTS/GADM 几何（最上层承载着色）。
 *  AWMC/DARMC 叠加层由 region_geometry 规则推导（awmc_snapshot / name_regex / DARMC source_id），
 *  NUTS 部分为渲染策略：未细分国家渲染 L0；已按族群断层线细分的国家
 *  （SUBNATIONAL_LEVEL）改渲染次国家级单元，其 L0 不再绘制。 */
const SUBNATIONAL_LEVEL: Record<string, number> = {
  BE: 1, UA: 1, // 大区/GADM 州级（乌克兰 GADM 国家码 UKR 归一为 UA）
  AT: 1, HU: 1, // NUTS L1（奥地利西/东南+东；匈牙利外多瑙/中部+大平原）
  FR: 2, // NUTS L2（旧大区×22：按北法/阿基坦/朗格多克/勃艮第/普罗旺斯/阿尔萨斯—洛林/布列塔尼归组）
  CH: 2, ES: 2, PL: 2, RO: 2, SE: 2, NO: 2, DE: 2, // NUTS L2（德国四分）
  IT: 2, EL: 2, // NUTS L2（意大利大陆×19+西西里+撒丁；希腊×13，两岛/东马其顿-色雷斯另设）
  TR: 2, // NUTS L2（土耳其×26：东色雷斯 TR21 + 安纳托利亚按历史地区归组）
};
const GBR_CONSTITUENTS = ['GBR.1_1', 'GBR.3_1', 'GBR.4_1'];
/** 部分细分叠加单元（source_id 白名单）：所属国家不整体细分（L0 照常绘制），
 *  仅这些次级单元叠加在 L0 之上，承载更细的族群切片——
 *  芬兰拉普兰（萨普米）/北卡累利阿、俄罗斯卡累利阿/鞑靼斯坦/巴什科尔托斯坦。
 *  绘制在主集合之后 = 视觉盖在 L0 上。 */
const OVERLAY_UNITS = new Set(['FI1D7', 'FI1DC', 'RUS.26_1', 'RUS.6_1', 'RUS.68_1']);

export function atlasGeometryFeatures(sources: Map<SourceCode, SourceView>, rules: RegionGeometryRule[]): RegionVm[] {
  const out: RegionVm[] = [];
  const awmcSnapshots = new Set(
    rules.filter((r) => r.source_code === 'awmc' && r.rule_type === 'awmc_snapshot').flatMap((r) => r.match_values.map(Number)),
  );
  out.push(
    ...(sources.get('awmc')?.features ?? []).filter((vm) => vm.family === 'empire' && vm.snapshot !== null && awmcSnapshots.has(vm.snapshot)),
  );
  // DARMC 行省：name_regex 按拉丁名、source_id 按要素 id 精确挑选（同名行省在 117/303/500 各快照层重复出现，
  // 需单层取几何时用 source_id，避免跨快照多边形互相叠盖）
  const darmcRegexes = rules
    .filter((r) => r.source_code === 'darmc' && r.rule_type === 'name_regex')
    .map((r) => new RegExp(r.match_values[0] ?? '', 'i'));
  const darmcIds = new Set(rules.filter((r) => r.source_code === 'darmc' && r.rule_type === 'source_id').flatMap((r) => r.match_values));
  out.push(
    ...(sources.get('darmc')?.features ?? []).filter(
      (vm) => vm.family === 'provinces' && (darmcIds.has(vm.sourceId) || darmcRegexes.some((re) => re.test(vm.nameEn ?? ''))),
    ),
  );
  out.push(...(sources.get('nuts')?.features ?? []).filter((vm) => {
    if (OVERLAY_UNITS.has(vm.sourceId)) return false; // 叠加单元最后单独 push，保证盖在 L0 上
    const raw = countryOf(vm);
    const cc = raw === 'UKR' ? 'UA' : raw;
    if (vm.level === 0) return vm.sourceId !== 'GBR' && (cc === null || !(cc in SUBNATIONAL_LEVEL)); // 细分国家不绘 L0；英国由构成国覆盖
    if (vm.level === 1 && GBR_CONSTITUENTS.includes(vm.sourceId)) return true; // 英国构成国叠加
    if (cc !== null) {
      const want = SUBNATIONAL_LEVEL[cc];
      if (want !== undefined && vm.level === want) return true; // 细分国家的次国家级单元
    }
    return false;
  }));
  out.push(...(sources.get('nuts')?.features ?? []).filter((vm) => OVERLAY_UNITS.has(vm.sourceId)));
  return dissolveSameRegion(out, rules);
}

/** 同国、候选地区集合完全相同的 NUTS/GADM 单元在族群分布模式下着色/hover 恒同，
 *  溶解为一个要素（去掉无信息的内部边界，如德国 38 个 L2 单元 → 4 区）；
 *  合并要素置于首成员位置（保持绘制层序），memberIds 供规则与测试按原始 id 寻址。 */
function dissolveSameRegion(features: RegionVm[], rules: RegionGeometryRule[]): RegionVm[] {
  const { byGeometry } = resolveRegionGeometry(features, rules);
  const groups = new Map<string, RegionVm[]>();
  for (const vm of features) {
    const regions = byGeometry.get(vm.code);
    if (vm.family !== 'nuts' || !regions) continue;
    const key = `${countryOf(vm)}|${[...regions].sort().join('+')}`;
    const list = groups.get(key) ?? [];
    list.push(vm);
    groups.set(key, list);
  }
  const merged = new Map<string, RegionVm | null>(); // 成员 code -> 合并要素（首成员）/ null（非首成员，丢弃）
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const unioned = union(featureCollection(members.map((m) => m.feature as never)));
    if (!unioned) continue;
    // turf 输出 RFC 7946 逆时针外环；d3-geo 球面约定为顺时针，否则按补集（全球减该面）绘制
    const u = rewind(unioned, { reverse: true }) as typeof unioned;
    const first = members[0]!;
    const vm: RegionVm = {
      ...first,
      code: `nuts:merge:${key.toLowerCase()}`,
      nameEn: null,
      nameZh: null,
      feature: { ...first.feature, geometry: u.geometry } as RegionVm['feature'],
      memberIds: members.map((m) => m.sourceId),
    };
    merged.set(first.code, vm);
    for (const m of members.slice(1)) merged.set(m.code, null);
  }
  const out: RegionVm[] = [];
  for (const vm of features) {
    const m = merged.get(vm.code);
    if (m === undefined) out.push(vm);
    else if (m !== null) out.push(m);
  }
  return out;
}
