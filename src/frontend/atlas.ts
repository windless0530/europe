// 族群分布（SQL）模式视图模型：
// - 颜色跟「族群」实体走：直接查 people-colors.ts 的 PEOPLE_COLOR（固定色值，
//   不随年份/其他族群/数据版本变化；运行时不做任何分配）
// - 任一年份的着色 = 时间切片查询 people_region，同区多族群按 render_priority
//   取主族群（平局按 people_code 字典序）
// - 全部计算在内存中完成，时间轴拖动零网络请求

import { CAVEAT, CAVEAT_KINDS, CLASSIFICATION } from '../lib/shared.js';
import type { CaveatKind, ClassificationRelation } from '../lib/shared.js';
import type { RegionVm } from './load';
import { resolveRegionGeometry, type RegionGeometryRule } from './region-map';
import { PEOPLE_COLOR } from './people-colors';

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
  classifications: Array<{ taxonomy: string; node: string; name_en: string | null; name_zh: string | null; relation: ClassificationRelation }>;
  relations: Array<{ rel: string; direction: 'out' | 'in'; other_code: string; other_name_en: string | null; other_name_zh: string | null; notes: string | null }>;
  /** 检索键（投影期生成）：全拼小写空格分隔 / 首字母串；无汉字为 null */
  name_py: string | null;
  name_py_abbr: string | null;
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
  caveat_kind: CaveatKind | null;
  caveat_zh: string | null;
  caveat_en: string | null;
  /** 标注显示窗口（缺省即时间片区间；仅窗口内年份显示） */
  caveat_sy: number | null;
  caveat_ey: number | null;
}

/** caveat 枚举唯一真实源在 shared.ts；此处 re-export 维持历史导入方（main/map/panel）不变 */
export { CAVEAT, CAVEAT_KINDS };
export type { CaveatKind };

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
  /** 检索键（投影期生成），语义同 AtlasPeople.name_py */
  name_py: string | null;
  name_py_abbr: string | null;
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

/** PEOPLE_COLOR 缺色族群的兜底填充（中性灰，与无数据底图区分；同时 console.error 提示补表） */
const MISSING_PEOPLE_COLOR = '#8a8a8a';

/** 大陆级兜底 region（regions.json 的 europe）：hover 无活动族群时不落到整个欧洲，优先取更具体的候选 */
const EUROPE_REGION_CODE = 'europe';

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
  /** people -> 固定颜色（PEOPLE_COLOR 按当前明/暗配色取值） */
  peopleColor: Map<string, string>;
  /** people -> people_region 首现序（谱系树同级排序用；无时间片者为 Infinity） */
  firstSeenIndex: Map<string, number>;
  yearRange: [number, number];
  /** T 年各 SQL 区域的状态（仅含有活动族群的区域） */
  regionsAt(year: number): Map<string, RegionYearState>;
  /** T 年 geometry code -> 填充色（主族群色；无数据区域不在结果中） */
  paintAt(year: number): Map<string, string>;
  /** T 年 geometry code -> 标注类型（胜出区域当年任一行有标注即标记；disputed 优先于 method） */
  caveatAt(year: number): Map<string, CaveatKind>;
  /** 谱系树单选族群的覆盖层：该族群当年活动切片覆盖的几何 -> 其固定色（无视主流优先级）；
   *  标注只看该族群自己的行（涂色与纹理同源，被覆盖的几何不继承主流层标注） */
  peopleOverlayAt(peopleCode: string, year: number): { paint: Map<string, string>; caveats: Map<string, CaveatKind> };
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

/** 行在 year 年是否活动（双端包含；字段按结构放宽，供脚本以窄行类型复用） */
export function activeInYear(row: Pick<AtlasPeopleRegion, 'start_year' | 'end_year'>, year: number): boolean {
  const sy = row.start_year ?? Number.NEGATIVE_INFINITY;
  const ey = row.end_year ?? Number.POSITIVE_INFINITY;
  return sy <= year && year <= ey;
}

/** 时间轴最早年份兜底：无论数据端点如何，至少回溯到公元前 500 年 */
export const YEAR_FLOOR = -500;

/** 时间轴年份范围：periods + people_region 端点取包络，下限兜 YEAR_FLOOR、上限兜当前年。
 *  前端时间轴与审计/绘制脚本共用，保证逐年扫描的窗口一致（参数按结构放宽，同 activeInYear）。 */
export function atlasYearRange(data: {
  periods: Array<{ start_year: number | null; end_year: number | null }>;
  people_region: Array<{ start_year: number | null; end_year: number | null }>;
}): [number, number] {
  const yearCandidates: number[] = [];
  for (const p of data.periods) {
    if (p.start_year !== null) yearCandidates.push(p.start_year);
    if (p.end_year !== null) yearCandidates.push(p.end_year);
  }
  for (const r of data.people_region) {
    if (r.start_year !== null) yearCandidates.push(r.start_year);
    if (r.end_year !== null) yearCandidates.push(r.end_year);
  }
  return [
    Math.min(...yearCandidates, YEAR_FLOOR),
    Math.max(...yearCandidates, new Date().getFullYear()),
  ];
}

export function buildAtlasModel(data: AtlasData, features: RegionVm[]): AtlasModel {
  const peopleByCode = new Map(data.peoples.map((p) => [p.code, p]));
  const regionByCode = new Map(data.regions.map((r) => [r.code, r]));
  const { byRegion: regionGeometry, byGeometry: geometryToRegions } = resolveRegionGeometry(features, data.region_geometry ?? []);

  // 颜色：查固定表 PEOPLE_COLOR（颜色只跟族群走，不随年份/其他族群/数据版本变化）
  const order: string[] = [];
  for (const row of data.people_region) {
    if (!order.includes(row.people_code)) order.push(row.people_code);
  }
  const scheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 1 : 0;
  const peopleColor = new Map<string, string>();
  const missingColor: string[] = [];
  for (const code of order) {
    const pair = PEOPLE_COLOR[code];
    if (!pair) missingColor.push(code);
    peopleColor.set(code, pair?.[scheme] ?? MISSING_PEOPLE_COLOR);
  }
  if (missingColor.length > 0) {
    console.error(`PEOPLE_COLOR 缺少族群颜色（以中性灰绘制，请运行 npm run colors 补表）：${missingColor.join(', ')}`);
  }
  const firstSeenIndex = new Map<string, number>(order.map((code, i) => [code, i]));

  const yearRange = atlasYearRange(data);

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
        if (row.caveat_kind === CAVEAT.disputed) {
          kind = CAVEAT.disputed;
          break;
        }
        kind = CAVEAT.method;
      }
      if (kind) out.set(gcode, kind);
    }
    return out;
  }

  function peopleOverlayAt(peopleCode: string, year: number): { paint: Map<string, string>; caveats: Map<string, CaveatKind> } {
    const paint = new Map<string, string>();
    const caveats = new Map<string, CaveatKind>();
    const color = peopleColor.get(peopleCode);
    if (!color) return { paint, caveats };
    const rows: AtlasPeopleRegion[] = [];
    let kind: CaveatKind | null = null; // 该族群当年任一活动行的标注（disputed 优先）
    for (const row of data.people_region) {
      if (row.people_code !== peopleCode || !activeInYear(row, year)) continue;
      rows.push(row);
      if (kind !== CAVEAT.disputed && caveatActive(row, year)) {
        kind = row.caveat_kind === CAVEAT.disputed ? CAVEAT.disputed : CAVEAT.method;
      }
    }
    for (const row of rows) {
      for (const gcode of regionGeometry.get(row.region_code) ?? []) {
        paint.set(gcode, color);
        if (kind !== null) caveats.set(gcode, kind);
      }
    }
    return { paint, caveats };
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
      if (c.relation !== CLASSIFICATION.member_of && c.relation !== CLASSIFICATION.descendant_of) continue;
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
        // 同族群同地区可有多条同时生效的分层时间片，区域只列一次
        if (region && !list.includes(region)) list.push(region);
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
      (firstSeenIndex.get(a.people.code) ?? Infinity) - (firstSeenIndex.get(b.people.code) ?? Infinity) ||
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
    const passive = candidates.filter((c) => c !== EUROPE_REGION_CODE);
    return { regionCode: passive[0] ?? candidates[0]!, state: null };
  }

  return { data, peopleByCode, regionByCode, regionGeometry, geometryToRegions, regionFor, geometryLive, peopleColor, firstSeenIndex, yearRange, regionsAt, paintAt, caveatAt, peopleOverlayAt, periodAt, peopleTreeAt, enumLabel };
}

