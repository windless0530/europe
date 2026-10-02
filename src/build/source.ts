// ============================================================
// 源数据（data/source/*.json）的类型、装载与校验。
//
// 源文件是本项目图谱数据的唯一真实源（文件优先，无数据库）：
//   peoples.json   族群（含顶层 relations / claims）
//   regions.json   地区 + geometry_rules（数组顺序 = 求值候选优先序）
//   events.json    事件
//   taxonomy.json  族群谱系树
//   reference.json 语言 / 宗教 / 时期 / 枚举字典 / 文献来源
//
// 省写约定（validator 与 projector 一致遵守）：
//   confidence 缺省 "high"；slice.priority 缺省 0；
//   classification 字符串项 = { node, relation: "member_of", confidence: "high" }；
//   years: [start, end]，两端皆空则整体省略。
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface I18n {
  zh: string | null;
  en: string | null;
}
export type Years = [number | null, number | null];

export interface LangRef {
  language: string;
  role: string;
  confidence?: string;
  years?: Years;
  notes?: string;
}
export interface ReligionRef {
  religion: string;
  role: string;
  confidence?: string;
  years?: Years;
  notes?: string;
}
export interface ClassificationEntry {
  node: string;
  relation?: string;
  confidence?: string;
  years?: Years;
  notes?: string;
}
export interface Slice {
  region: string;
  presence: string;
  years?: Years;
  priority?: number;
  confidence?: string;
  notes?: string;
}
export interface People {
  code: string;
  type: string;
  status?: string;
  lifespan?: Years;
  name: I18n;
  brief?: I18n;
  notes?: string;
  languages?: LangRef[];
  religions?: ReligionRef[];
  classification?: Record<string, Array<string | ClassificationEntry>>;
  slices?: Slice[];
}
export interface RelationSourceRef {
  source: string;
  evidence?: string;
  quote?: string;
  notes?: string;
}
export interface Relation {
  a: string;
  type: string;
  b: string;
  confidence?: string;
  years?: Years;
  notes?: string;
  sources?: RelationSourceRef[];
}
export interface Claim {
  subject: string;
  predicate: string;
  object: string;
  confidence?: string;
  notes?: string;
}
export interface Region {
  code: string;
  type: string;
  parent?: string;
  years?: Years;
  name: I18n;
  brief?: I18n;
  notes?: string;
}
export type RuleType = 'l0_country' | 'source_id' | 'name_regex' | 'awmc_snapshot';
export interface GeometryRule {
  region: string;
  source: 'awmc' | 'darmc' | 'nuts';
  type: RuleType;
  values: string[];
  note?: string;
}
export interface EventItem {
  code: string;
  type?: string;
  region?: string;
  years?: Years;
  name: I18n;
  brief?: I18n;
  notes?: string;
  participants?: Array<{ people: string; role: string; notes?: string }>;
}
export interface TaxonomyNode {
  code: string;
  parent?: string;
  sort: number;
  name: I18n;
  notes?: string;
}
export interface Taxonomy {
  code: string;
  sort: number;
  notes?: string;
  nodes: TaxonomyNode[];
}
export interface Language {
  code: string;
  type?: string;
  status?: string;
  years?: Years;
  name: I18n;
  notes?: string;
}
export interface Religion {
  code: string;
  parent?: string;
  name: I18n;
  notes?: string;
}
export interface Period {
  code: string;
  years?: Years;
  name: I18n;
  brief?: I18n;
  notes?: string;
}
export interface EnumValue {
  code: string;
  label: I18n;
  desc?: I18n;
}
export interface SourceRef {
  code: string;
  type: string;
  title: string;
  author?: string;
  publisher?: string;
  year?: number;
  url?: string;
  isbn?: string;
  notes?: string;
}

export interface Bundle {
  peoples: People[];
  relations: Relation[];
  claims: Claim[];
  regions: Region[];
  rules: GeometryRule[];
  events: EventItem[];
  taxonomies: Taxonomy[];
  languages: Language[];
  religions: Religion[];
  periods: Period[];
  enums: Record<string, EnumValue[]>;
  sources: SourceRef[];
}

/** 读取 5 个源文件（repoRoot = 仓库根目录） */
export function loadSource(repoRoot: string): Bundle {
  const read = (f: string) => JSON.parse(readFileSync(join(repoRoot, 'data', 'source', f), 'utf8'));
  const p = read('peoples.json') as { peoples: People[]; relations: Relation[]; claims: Claim[] };
  const r = read('regions.json') as { regions: Region[]; geometry_rules: GeometryRule[] };
  const ref = read('reference.json') as {
    languages: Language[];
    religions: Religion[];
    periods: Period[];
    enums: Record<string, EnumValue[]>;
    sources: SourceRef[];
  };
  return {
    peoples: p.peoples,
    relations: p.relations,
    claims: p.claims,
    regions: r.regions,
    rules: r.geometry_rules,
    events: (read('events.json') as { events: EventItem[] }).events,
    taxonomies: (read('taxonomy.json') as { taxonomies: Taxonomy[] }).taxonomies,
    languages: ref.languages,
    religions: ref.religions,
    periods: ref.periods,
    enums: ref.enums,
    sources: ref.sources,
  };
}

// ------------------------------------------------------------
// 校验：把原 PostgreSQL 约束（外键/唯一/检查/枚举）复刻为装载门禁。
// 返回错误列表；空数组 = 通过。project 运行前强制调用。
// ------------------------------------------------------------
export function validate(b: Bundle): string[] {
  const errs: string[] = [];
  const E = (msg: string) => errs.push(msg);
  const enumHas = (def: string, code: string) =>
    (b.enums[def] ?? (() => E(`枚举定义缺失: ${def}`) as never as EnumValue[])()).some((v) => v.code === code);
  const checkEnum = (def: string, code: string | undefined, at: string) => {
    if (code !== undefined && !enumHas(def, code)) E(`${at}: "${code}" 不在枚举 ${def}`);
  };
  const checkI18n = (x: I18n | undefined, at: string, field: string) => {
    if (!x || !x.zh || !x.en) E(`${at}: ${field} 需要 zh 与 en`);
  };
  const checkYears = (y: Years | undefined, at: string) => {
    if (y && y[0] !== null && y[1] !== null && y[0]! > y[1]!) E(`${at}: years 起止倒置 [${y}]`);
  };

  // ---- 唯一性 ----
  const uniq = (xs: string[], what: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (seen.has(x)) E(`${what} code 重复: ${x}`);
      seen.add(x);
    }
  };
  uniq(b.peoples.map((p) => p.code), 'people');
  uniq(b.regions.map((r) => r.code), 'region');
  uniq(b.events.map((e) => e.code), 'event');
  uniq(b.periods.map((p) => p.code), 'period');
  uniq(b.languages.map((l) => l.code), 'language');
  uniq(b.religions.map((r) => r.code), 'religion');
  uniq(b.sources.map((s) => s.code), 'source');
  uniq(b.taxonomies.map((t) => t.code), 'taxonomy');
  for (const t of b.taxonomies) uniq(t.nodes.map((n) => n.code), `taxonomy ${t.code} node`);
  for (const [def, vals] of Object.entries(b.enums)) uniq(vals.map((v) => v.code), `enum ${def}`);

  const peopleCodes = new Set(b.peoples.map((p) => p.code));
  const regionCodes = new Set(b.regions.map((r) => r.code));
  const languageCodes = new Set(b.languages.map((l) => l.code));
  const religionCodes = new Set(b.religions.map((r) => r.code));
  const sourceCodes = new Set(b.sources.map((s) => s.code));
  const nodeIndex = new Map<string, Map<string, TaxonomyNode>>(
    b.taxonomies.map((t) => [t.code, new Map(t.nodes.map((n) => [n.code, n]))]),
  );

  // ---- 谱系：父节点存在、同树、无环 ----
  for (const t of b.taxonomies) {
    for (const n of t.nodes) {
      if (n.parent !== undefined && !t.nodes.some((x) => x.code === n.parent))
        E(`taxonomy ${t.code}.${n.code}: parent "${n.parent}" 不存在`);
      const seen = new Set<string>([n.code]);
      let cur: TaxonomyNode | undefined = n;
      while (cur?.parent !== undefined) {
        if (seen.has(cur.parent)) {
          E(`taxonomy ${t.code}.${n.code}: parent 链成环`);
          break;
        }
        seen.add(cur.parent);
        cur = t.nodes.find((x) => x.code === cur!.parent);
      }
    }
  }

  // ---- 族群 ----
  for (const p of b.peoples) {
    const at = `people ${p.code}`;
    checkI18n(p.name, at, 'name');
    checkEnum('people_type', p.type, at);
    checkEnum('status', p.status, at);
    checkYears(p.lifespan, at);
    const seenSlice = new Set<string>();
    for (const sl of p.slices ?? []) {
      const sat = `${at} slice ${sl.region}`;
      if (!regionCodes.has(sl.region)) E(`${sat}: region 不存在`);
      checkEnum('presence_type', sl.presence, sat);
      checkEnum('confidence_level', sl.confidence ?? 'high', sat);
      checkYears(sl.years, sat);
      const key = `${sl.region}|${sl.presence}|${sl.years?.[0] ?? ''}`;
      if (seenSlice.has(key)) E(`${sat}: 同 region+presence+start 重复`);
      seenSlice.add(key);
    }
    for (const lr of p.languages ?? []) {
      if (!languageCodes.has(lr.language)) E(`${at} language: ${lr.language} 不存在`);
      checkEnum('language_role', lr.role, at);
      checkEnum('confidence_level', lr.confidence ?? 'high', at);
      checkYears(lr.years, at);
    }
    for (const rr of p.religions ?? []) {
      if (!religionCodes.has(rr.religion)) E(`${at} religion: ${rr.religion} 不存在`);
      checkEnum('religion_role', rr.role, at);
      checkEnum('confidence_level', rr.confidence ?? 'high', at);
      checkYears(rr.years, at);
    }
    for (const [tax, entries] of Object.entries(p.classification ?? {})) {
      const nodes = nodeIndex.get(tax);
      if (!nodes) {
        E(`${at} classification: taxonomy "${tax}" 不存在`);
        continue;
      }
      for (const e of entries) {
        const node = typeof e === 'string' ? e : e.node;
        if (!nodes.has(node)) E(`${at} classification: 节点 ${tax}.${node} 不存在`);
        if (typeof e !== 'string') {
          checkEnum('classification_relation', e.relation ?? 'member_of', at);
          checkEnum('confidence_level', e.confidence ?? 'high', at);
          checkYears(e.years, at);
        }
      }
    }
  }

  // ---- 关系 / 断言 ----
  for (const r of b.relations) {
    const at = `relation ${r.a}-${r.b}`;
    if (r.a === r.b) E(`${at}: a 与 b 相同`);
    for (const x of [r.a, r.b]) if (!peopleCodes.has(x)) E(`${at}: people "${x}" 不存在`);
    checkEnum('relation_type', r.type, at);
    checkEnum('confidence_level', r.confidence ?? 'high', at);
    checkYears(r.years, at);
    for (const s of r.sources ?? []) if (!sourceCodes.has(s.source)) E(`${at} source: ${s.source} 不存在`);
  }
  for (const c of b.claims) {
    for (const x of [c.subject, c.object]) if (!peopleCodes.has(x)) E(`claim ${c.predicate}: people "${x}" 不存在`);
  }

  // ---- 地区 / 几何规则 ----
  for (const r of b.regions) {
    checkI18n(r.name, `region ${r.code}`, 'name');
    checkEnum('region_type', r.type, `region ${r.code}`);
    if (r.parent !== undefined && !regionCodes.has(r.parent)) E(`region ${r.code}: parent 不存在`);
    checkYears(r.years, `region ${r.code}`);
  }
  const RULE_TYPES = new Set(['l0_country', 'source_id', 'name_regex', 'awmc_snapshot']);
  const ruleKeys = new Set<string>();
  for (const g of b.rules) {
    const at = `rule ${g.region}/${g.source}/${g.type}`;
    if (!regionCodes.has(g.region)) E(`${at}: region 不存在`);
    if (!['awmc', 'darmc', 'nuts'].includes(g.source)) E(`${at}: source 非法`);
    if (!RULE_TYPES.has(g.type)) E(`${at}: type 非法`);
    if (g.values.length === 0) E(`${at}: values 为空`);
    const key = `${g.region}|${g.source}|${g.type}|${g.values.join(',')}`;
    if (ruleKeys.has(key)) E(`${at}: 规则重复`);
    ruleKeys.add(key);
  }

  // ---- 事件 ----
  for (const e of b.events) {
    const at = `event ${e.code}`;
    checkI18n(e.name, at, 'name');
    checkEnum('event_type', e.type, at);
    checkYears(e.years, at);
    if (e.region !== undefined && !regionCodes.has(e.region)) E(`${at}: region 不存在`);
    for (const p of e.participants ?? []) {
      if (!peopleCodes.has(p.people)) E(`${at}: people "${p.people}" 不存在`);
      checkEnum('event_role', p.role, at);
    }
  }

  // ---- 语言 / 宗教 / 时期 / 枚举 ----
  for (const l of b.languages) {
    checkI18n(l.name, `language ${l.code}`, 'name');
    checkEnum('language_type', l.type, `language ${l.code}`);
    checkEnum('status', l.status, `language ${l.code}`);
    checkYears(l.years, `language ${l.code}`);
  }
  for (const r of b.religions) {
    checkI18n(r.name, `religion ${r.code}`, 'name');
    if (r.parent !== undefined && !religionCodes.has(r.parent)) E(`religion ${r.code}: parent 不存在`);
  }
  for (const p of b.periods) {
    checkI18n(p.name, `period ${p.code}`, 'name');
    checkYears(p.years, `period ${p.code}`);
  }
  for (const [def, vals] of Object.entries(b.enums))
    for (const v of vals) checkI18n(v.label, `enum ${def}.${v.code}`, 'label');

  return errs;
}
