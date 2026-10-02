// 族群分布（SQL）模式视图模型：
// - 颜色跟「族群」实体走（按 people_region 首次出现顺序固定分配调色板槽位）
// - 任一年份的着色 = 时间切片查询 people_region，同区多族群按 render_priority
//   取主族群（平局按 people_code 字典序）
// - 全部计算在内存中完成，时间轴拖动零网络请求

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

/** 分类调色板（16 槽，Okabe-Ito + Tol muted 家族贪心+局部修复精选；
 *  CVD 目标下全对 ΔE≥15 不可行，此组经 OKLab + Machado 二色模拟校验，
 *  正常视觉最差对 7.0、CVD 最差 4.4（深酒红×深绿，仅当二者恰相差 16 槽共现），
 *  槽长 16 由经验碰撞扫描（scripts/palette-collisions.ts）标定：同国同年同色对 0；
 *  次级编码（谱系树 + hover）补足区分；超过 16 个族群回绕并记录） */
const CATEGORICAL_LIGHT = ['#0072B2', '#F0E442', '#D55E00', '#88CCEE', '#332288', '#A0446E', '#44AA99', '#E69F00', '#7A5C00', '#3C4E9C', '#808080', '#DDCC77', '#882255', '#56B4E9', '#AA4499', '#0B6E4F'];
const CATEGORICAL_DARK = ['#3187C5', '#F0E442', '#D55E00', '#332288', '#94D5F5', '#9D3C68', '#3CB389', '#E69F00', '#808080', '#56B4E9', '#3C4E9C', '#7A5C00', '#E190BC', '#DCCC7C', '#608F42', '#BF5DAD'];

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
  /** people -> 调色板槽位序（people_region 首现顺序；未上色者为 Infinity） */
  slotIndex: Map<string, number>;
  yearRange: [number, number];
  /** T 年各 SQL 区域的状态（仅含有活动族群的区域） */
  regionsAt(year: number): Map<string, RegionYearState>;
  /** T 年 geometry code -> 填充色（主族群色；无数据区域不在结果中） */
  paintAt(year: number): Map<string, string>;
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

export function buildAtlasModel(data: AtlasData, features: RegionVm[]): AtlasModel {
  const peopleByCode = new Map(data.peoples.map((p) => [p.code, p]));
  const regionByCode = new Map(data.regions.map((r) => [r.code, r]));
  const { byRegion: regionGeometry, byGeometry: geometryToRegions } = resolveRegionGeometry(features, data.region_geometry ?? []);

  // 颜色槽位：按 people_region 中首次出现顺序固定分配（颜色跟实体走，不随过滤变化）
  const order: string[] = [];
  for (const row of data.people_region) {
    if (!order.includes(row.people_code)) order.push(row.people_code);
  }
  const peopleColor = new Map<string, string>();
  const pal = categoricalPalette();
  order.forEach((code, i) => peopleColor.set(code, pal[i % pal.length]!));
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

  function paintAt(year: number): Map<string, string> {
    // 一几何可属多区域（如 at ∈ {austria, central_europe}）：
    // 跨区域竞争与 regionFor（hover）同规则——主族群 render_priority 高者胜，
    // 平局按 people_code 字典序，避免「后写覆盖」的不确定着色。
    const best = new Map<string, { color: string; pr: number; code: string }>();
    for (const [, state] of regionsAt(year)) {
      const color = peopleColor.get(state.top.people_code);
      if (!color) continue;
      const cand = { color, pr: state.top.render_priority, code: state.top.people_code };
      for (const gcode of regionGeometry.get(state.top.region_code) ?? []) {
        const cur = best.get(gcode);
        if (!cur || cand.pr > cur.pr || (cand.pr === cur.pr && cand.code.localeCompare(cur.code) < 0)) {
          best.set(gcode, cand);
        }
      }
    }
    const paint = new Map<string, string>();
    for (const [gcode, win] of best) paint.set(gcode, win.color);
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

  return { data, peopleByCode, regionByCode, regionGeometry, geometryToRegions, regionFor, peopleColor, slotIndex, yearRange, regionsAt, paintAt, periodAt, peopleTreeAt, enumLabel };
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
 *  AWMC 帝国参考层垫底 -> DARMC 北非行省 -> NUTS/GADM 几何（最上层承载着色）。
 *  AWMC/DARMC 叠加层由 region_geometry 规则推导（awmc_snapshot / name_regex），
 *  NUTS 部分为渲染策略：未细分国家渲染 L0；已按族群断层线细分的国家
 *  （SUBNATIONAL_LEVEL）改渲染次国家级单元，其 L0 不再绘制。 */
const SUBNATIONAL_LEVEL: Record<string, number> = {
  BE: 1, FR: 1, UA: 1, // 大区/GADM 州级（乌克兰 GADM 国家码 UKR 归一为 UA）
  CH: 2, ES: 2, PL: 2, RO: 2, SE: 2, NO: 2, DE: 2, // NUTS L2（德国四分）
};
const GBR_CONSTITUENTS = ['GBR.1_1', 'GBR.3_1', 'GBR.4_1'];

export function atlasGeometryFeatures(sources: Map<SourceCode, SourceView>, rules: RegionGeometryRule[]): RegionVm[] {
  const out: RegionVm[] = [];
  const awmcSnapshots = new Set(
    rules.filter((r) => r.source_code === 'awmc' && r.rule_type === 'awmc_snapshot').flatMap((r) => r.match_values.map(Number)),
  );
  out.push(
    ...(sources.get('awmc')?.features ?? []).filter((vm) => vm.family === 'empire' && vm.snapshot !== null && awmcSnapshots.has(vm.snapshot)),
  );
  const darmcRegexes = rules
    .filter((r) => r.source_code === 'darmc' && r.rule_type === 'name_regex')
    .map((r) => new RegExp(r.match_values[0] ?? '', 'i'));
  out.push(
    ...(sources.get('darmc')?.features ?? []).filter(
      (vm) => vm.family === 'provinces' && darmcRegexes.some((re) => re.test(vm.nameEn ?? '')),
    ),
  );
  out.push(...(sources.get('nuts')?.features ?? []).filter((vm) => {
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
  return out;
}
