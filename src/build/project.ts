// ============================================================
// 投影器：data/peoples/source/*.json -> data/peoples/export/atlas.json
//
// 前端「族群分布模式」的唯一数据来源（全量进内存）。输出形状
// 与键序、排序、省写展开规则均固定 —— 与 PostgreSQL 时代的
// 导出产物保持字节等价（除 generated_at；已知例外：relations 的
// other_name_zh 修正了旧导出误取英文名的 bug），前端与审计脚本
// （audit/collisions）零改动。
//
// 排序规则（显式重排，手改源文件插入位置不影响产物）：
//   regions/peoples/religions 按 code；people_region 按
//   (region_code, priority DESC, people_code)；events/periods 按
//   (start_year 空在前, code)；taxonomy 按 (sort, code)；枚举按
//   code。唯一例外：region_geometry 保持源文件数组顺序
//   （顺序 = 求值候选优先序）。
//
// 运行：npm run project（先跑内置 validator，错误即中止）
// ============================================================

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSource, validate, type Bundle, type I18n, type Taxonomy } from './source.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = join(ROOT, 'data', 'peoples', 'export', 'atlas.json');

/** code-unit 比较（与 PG C 排序一致，勿用 localeCompare） */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** [start,end] -> {sy, ey}，缺省 undefined 归一为 null */
const sy = (y?: [number | null, number | null]) => (y ? y[0] : null);
const ey = (y?: [number | null, number | null]) => (y ? y[1] : null);
/** SQL COALESCE(en, zh) */
const nameEn = (x: I18n | undefined): string | null => x?.en ?? x?.zh ?? null;
const nameZh = (x: I18n | undefined): string | null => x?.zh ?? null;
const briefEn = (x: I18n | undefined): string | null => x?.en ?? x?.zh ?? null;
const briefZh = (x: I18n | undefined): string | null => x?.zh ?? null;

function project(b: Bundle): Record<string, unknown> {
  const langByCode = new Map(b.languages.map((l) => [l.code, l]));
  const relgByCode = new Map(b.religions.map((r) => [r.code, r]));
  // 全部关系按 (a, b) 排序后过滤到各 people（复刻 SQL ORDER BY a.code, b.code）
  const relationsSorted = [...b.relations].sort((x, y2) => cmp(x.a, y2.a) || cmp(x.b, y2.b));

  const peoplesOut = [...b.peoples]
    .sort((x, y2) => cmp(x.code, y2.code))
    .map((p) => ({
      code: p.code,
      people_type: p.type,
      start_year: sy(p.lifespan),
      end_year: ey(p.lifespan),
      status_code: p.status ?? null,
      name_en: nameEn(p.name),
      name_zh: nameZh(p.name),
      brief_en: briefEn(p.brief),
      brief_zh: briefZh(p.brief),
      languages: (p.languages ?? [])
        .map((lr) => ({ lr, l: langByCode.get(lr.language) }))
        .sort((x, y2) => cmp(x.lr.language, y2.lr.language))
        .map(({ lr, l }) => ({
          code: lr.language,
          name_en: nameEn(l?.name),
          name_zh: nameZh(l?.name),
          role: lr.role,
          sy: sy(lr.years),
          ey: ey(lr.years),
        })),
      religions: (p.religions ?? [])
        .map((rr) => ({ rr, r: relgByCode.get(rr.religion) }))
        .sort((x, y2) => cmp(x.rr.religion, y2.rr.religion))
        .map(({ rr, r }) => ({
          code: rr.religion,
          name_en: nameEn(r?.name),
          name_zh: nameZh(r?.name),
          role: rr.role,
          sy: sy(rr.years),
          ey: ey(rr.years),
        })),
      classifications: Object.entries(p.classification ?? {})
        .flatMap(([tax, entries]) =>
          entries.map((e) => ({
            tax,
            node: typeof e === 'string' ? e : e.node,
            relation: typeof e === 'string' ? 'member_of' : (e.relation ?? 'member_of'),
          })),
        )
        .sort((x, y2) => cmp(x.tax, y2.tax) || cmp(x.node, y2.node))
        .map(({ tax, node, relation }) => {
          const n = b.taxonomies.find((t) => t.code === tax)!.nodes.find((x) => x.code === node)!;
          return {
            taxonomy: tax,
            node,
            name_en: nameEn(n.name),
            name_zh: nameZh(n.name),
            relation,
          };
        }),
      relations: relationsSorted
        .filter((r) => r.a === p.code || r.b === p.code)
        .map((r) => {
          const other = b.peoples.find((x) => x.code === (r.a === p.code ? r.b : r.a))!;
          return {
            rel: r.type,
            direction: r.a === p.code ? 'out' : 'in',
            other_code: other.code,
            other_name_en: nameEn(other.name),
            other_name_zh: nameZh(other.name),
            notes: r.notes ?? null,
          };
        }),
    }));

  const people_region = b.peoples
    .flatMap((p) =>
      (p.slices ?? []).map((sl) => ({
        people_code: p.code,
        region_code: sl.region,
        presence: sl.presence,
        start_year: sy(sl.years),
        end_year: ey(sl.years),
        confidence: sl.confidence ?? 'high',
        render_priority: sl.priority ?? 0,
        caveat_kind: sl.caveat?.kind ?? null,
        caveat_zh: sl.caveat?.text.zh ?? null,
        caveat_en: sl.caveat?.text.en ?? null,
        caveat_sy: sl.caveat ? sy(sl.caveat.years ?? sl.years) : null,
        caveat_ey: sl.caveat ? ey(sl.caveat.years ?? sl.years) : null,
      })),
    )
    .sort(
      (x, y2) =>
        cmp(x.region_code, y2.region_code) ||
        y2.render_priority - x.render_priority ||
        cmp(x.people_code, y2.people_code),
    );

  const taxonomiesOut = [...b.taxonomies]
    .sort((x: Taxonomy, y2: Taxonomy) => x.sort - y2.sort || cmp(x.code, y2.code))
    .map((t) => ({
      code: t.code,
      nodes: [...t.nodes]
        .sort((x, y2) => x.sort - y2.sort || cmp(x.code, y2.code))
        .map((n) => ({
          code: n.code,
          parent: n.parent ?? null,
          sort: n.sort,
          name_en: nameEn(n.name),
          name_zh: nameZh(n.name),
        })),
    }));

  const eventsOut = [...b.events]
    .sort(
      (x, y2) => (sy(x.years) ?? -Infinity) - (sy(y2.years) ?? -Infinity) || cmp(x.code, y2.code),
    )
    .map((e) => ({
      code: e.code,
      start_year: sy(e.years),
      end_year: ey(e.years),
      event_type: e.type ?? null,
      region_code: e.region ?? null,
      name_en: nameEn(e.name),
      name_zh: nameZh(e.name),
      brief_en: briefEn(e.brief),
      brief_zh: briefZh(e.brief),
      peoples: [...(e.participants ?? [])]
        .sort((x, y2) => cmp(x.people, y2.people))
        .map((p) => ({ people_code: p.people, role: p.role })),
    }));

  const enums: Record<string, Record<string, Record<string, string>>> = {};
  for (const def of Object.keys(b.enums).sort(cmp)) {
    enums[def] = {};
    for (const v of [...b.enums[def]!].sort((x, y2) => cmp(x.code, y2.code))) {
      enums[def]![v.code] = { en: v.label.en ?? '', zh: v.label.zh ?? '' };
    }
  }

  return {
    generated_at: new Date().toISOString(),
    regions: [...b.regions]
      .sort((x, y2) => cmp(x.code, y2.code))
      .map((r) => ({
        code: r.code,
        region_type: r.type,
        start_year: sy(r.years),
        end_year: ey(r.years),
        name_en: nameEn(r.name),
        name_zh: nameZh(r.name),
        brief_en: briefEn(r.brief),
        brief_zh: briefZh(r.brief),
      })),
    peoples: peoplesOut,
    people_region,
    region_geometry: b.rules.map((g) => ({
      region_code: g.region,
      source_code: g.source,
      rule_type: g.type,
      match_values: g.values,
      note: g.note ?? null,
    })),
    religions: [...b.religions]
      .sort((x, y2) => cmp(x.code, y2.code))
      .map((r) => ({
        code: r.code,
        parent_code: r.parent ?? null,
        name_en: nameEn(r.name),
        name_zh: nameZh(r.name),
      })),
    events: eventsOut,
    taxonomies: taxonomiesOut,
    periods: [...b.periods]
      .sort((x, y2) => (sy(x.years) ?? -Infinity) - (sy(y2.years) ?? -Infinity) || cmp(x.code, y2.code))
      .map((p) => ({
        code: p.code,
        start_year: sy(p.years),
        end_year: ey(p.years),
        name_en: nameEn(p.name),
        name_zh: nameZh(p.name),
        brief_en: briefEn(p.brief),
      })),
    enums,
  };
}

function main(): void {
  const b = loadSource(ROOT);
  const errs = validate(b);
  if (errs.length > 0) {
    console.error(`校验失败（${errs.length} 处）：`);
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }

  const out = project(b);
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const kb = (statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(
    `投影完成 -> data/peoples/export/atlas.json (${kb} KB)：` +
      `${(out.regions as unknown[]).length} regions, ` +
      `${(out.peoples as unknown[]).length} peoples, ` +
      `${(out.people_region as unknown[]).length} people_region, ` +
      `${(out.region_geometry as unknown[]).length} region_geometry, ` +
      `${(out.events as unknown[]).length} events, ` +
      `${(out.periods as unknown[]).length} periods, ` +
      `${(out.taxonomies as unknown[]).length} taxonomies`,
  );
}

main();
