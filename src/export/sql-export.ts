// ============================================================
// SQL -> JSON 导出：europe_atlas 库 -> data/export/atlas.json
// 前端「族群分布模式」的唯一数据来源（全量进内存）。
// 运行：npm run export（需本地 PostgreSQL 已启动并导入 v2 SQL）
// ============================================================

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { REPO_ROOT } from '../lib/contract.js';

const OUT_FILE = path.join(REPO_ROOT, 'data', 'export', 'atlas.json');

async function main(): Promise<void> {
  const pool = new Pool({ database: 'europe_atlas' });
  const q = (sql: string): Promise<Record<string, unknown>[]> => pool.query(sql).then((r) => r.rows as Record<string, unknown>[]);

  const [regions, peoples, peopleRegion, languages, religions, classifications, relations, events, eventPeople, periods, enumLabels, peopleLang, peopleReligion] =
    await Promise.all([
      q(`SELECT r.code, r.region_type, r.start_year AS sy, r.end_year AS ey,
                COALESCE(te.name, tz.name) AS name_en, tz.name AS name_zh,
                COALESCE(te.short_description, tz.short_description) AS brief_en,
                tz.short_description AS brief_zh
         FROM region r
         LEFT JOIN region_translation te ON te.region_id = r.id AND te.lang = 'en'
         LEFT JOIN region_translation tz ON tz.region_id = r.id AND tz.lang = 'zh'`),
      q(`SELECT p.code, p.people_type, p.start_year AS sy, p.end_year AS ey, p.status_code,
                COALESCE(te.name, tz.name) AS name_en, tz.name AS name_zh,
                COALESCE(te.short_description, tz.short_description) AS brief_en,
                tz.short_description AS brief_zh
         FROM people p
         LEFT JOIN people_translation te ON te.people_id = p.id AND te.lang = 'en'
         LEFT JOIN people_translation tz ON tz.people_id = p.id AND tz.lang = 'zh'`),
      q(`SELECT p.code AS people_code, r.code AS region_code, pr.presence_code,
                pr.start_year AS sy, pr.end_year AS ey, pr.confidence_code, pr.render_priority
         FROM people_region pr
         JOIN people p ON p.id = pr.people_id
         JOIN region r ON r.id = pr.region_id
         ORDER BY r.code, pr.render_priority DESC, p.code`),
      q(`SELECT l.code, l.language_type, l.start_year AS sy, l.end_year AS ey, l.status_code,
                COALESCE(te.name, tz.name) AS name_en, tz.name AS name_zh
         FROM language l
         LEFT JOIN language_translation te ON te.language_id = l.id AND te.lang = 'en'
         LEFT JOIN language_translation tz ON tz.language_id = l.id AND tz.lang = 'zh'`),
      q(`SELECT rv.code, par.code AS parent_code,
                COALESCE(te.name, tz.name) AS name_en, tz.name AS name_zh
         FROM religion rv
         LEFT JOIN religion par ON par.id = rv.parent_id
         LEFT JOIN religion_translation te ON te.religion_id = rv.id AND te.lang = 'en'
         LEFT JOIN religion_translation tz ON tz.religion_id = rv.id AND tz.lang = 'zh'`),
      q(`SELECT p.code AS people_code, t.code AS taxonomy, n.code AS node, n.parent_id,
                COALESCE(te.name, tz.name) AS node_name_en, tz.name AS node_name_zh,
                pc.relation_code, pc.confidence_code
         FROM people_classification pc
         JOIN people p ON p.id = pc.people_id
         JOIN taxonomy_node n ON n.id = pc.taxonomy_node_id
         JOIN taxonomy t ON t.id = n.taxonomy_id
         LEFT JOIN taxonomy_node_translation te ON te.taxonomy_node_id = n.id AND te.lang = 'en'
         LEFT JOIN taxonomy_node_translation tz ON tz.taxonomy_node_id = n.id AND tz.lang = 'zh'`),
      q(`SELECT a.code AS a_code, ra.relation_code, b.code AS b_code,
                COALESCE(ta.name, taz.name) AS a_name_en, ta.name AS a_name_zh,
                COALESCE(tb.name, tbz.name) AS b_name_en, tb.name AS b_name_zh,
                ra.start_year AS sy, ra.end_year AS ey, ra.confidence_code, ra.notes
         FROM people_relation ra
         JOIN people a ON a.id = ra.people_a_id
         JOIN people b ON b.id = ra.people_b_id
         LEFT JOIN people_translation ta ON ta.people_id = a.id AND ta.lang = 'en'
         LEFT JOIN people_translation taz ON taz.people_id = a.id AND taz.lang = 'zh'
         LEFT JOIN people_translation tb ON tb.people_id = b.id AND tb.lang = 'en'
         LEFT JOIN people_translation tbz ON tbz.people_id = b.id AND tbz.lang = 'zh'`),
      q(`SELECT e.code, e.start_year AS sy, e.end_year AS ey, e.event_type_code, r.code AS region_code,
                COALESCE(te.name, tz.name) AS name_en, tz.name AS name_zh,
                COALESCE(te.short_description, tz.short_description) AS brief_en,
                tz.short_description AS brief_zh
         FROM event e
         LEFT JOIN region r ON r.id = e.region_id
         LEFT JOIN event_translation te ON te.event_id = e.id AND te.lang = 'en'
         LEFT JOIN event_translation tz ON tz.event_id = e.id AND tz.lang = 'zh'`),
      q(`SELECT e.code AS event_code, p.code AS people_code, ep.role_code
         FROM event_people ep
         JOIN event e ON e.id = ep.event_id
         JOIN people p ON p.id = ep.people_id`),
      q(`SELECT pd.code, pd.start_year AS sy, pd.end_year AS ey,
                COALESCE(te.name, tz.name) AS name_en, tz.name AS name_zh,
                COALESCE(te.short_description, tz.short_description) AS brief_en
         FROM period pd
         LEFT JOIN period_translation te ON te.period_id = pd.id AND te.lang = 'en'
         LEFT JOIN period_translation tz ON tz.period_id = pd.id AND tz.lang = 'zh'
         ORDER BY pd.start_year NULLS FIRST, pd.code`),
      q(`SELECT definition_code, value_code, lang, label
         FROM enum_label`),
      q(`SELECT p.code AS people_code, l.code AS language_code, pl.role_code,
                pl.start_year AS sy, pl.end_year AS ey, pl.confidence_code
         FROM people_language pl
         JOIN people p ON p.id = pl.people_id
         JOIN language l ON l.id = pl.language_id`),
      q(`SELECT p.code AS people_code, rv.code AS religion_code, pr.role_code,
                pr.start_year AS sy, pr.end_year AS ey, pr.confidence_code
         FROM people_religion pr
         JOIN people p ON p.id = pr.people_id
         JOIN religion rv ON rv.id = pr.religion_id`),
    ]);

  await pool.end();

  // 重组：语言/宗教/分类/事件参与者挂到 people / event 上
  const langsByCode = new Map(languages.map((l) => [String(l.code), l]));
  const relgByCode = new Map(religions.map((r) => [String(r.code), r]));

  const peoplesOut = peoples.map((p) => ({
    code: String(p.code),
    people_type: p.people_type,
    start_year: p.sy as number | null,
    end_year: p.ey as number | null,
    status_code: p.status_code,
    name_en: p.name_en ?? null,
    name_zh: p.name_zh ?? null,
    brief_en: (p.brief_en as string | null) ?? null,
    brief_zh: (p.brief_zh as string | null) ?? null,
    languages: peopleLang
      .filter((pl) => pl.people_code === p.code)
      .map((pl) => {
        const l = langsByCode.get(String(pl.language_code));
        return {
          code: String(pl.language_code),
          name_en: (l?.name_en as string) ?? null,
          name_zh: (l?.name_zh as string) ?? null,
          role: String(pl.role_code),
          sy: pl.sy as number | null,
          ey: pl.ey as number | null,
        };
      }),
    religions: peopleReligion
      .filter((pr) => pr.people_code === p.code)
      .map((pr) => {
        const r = relgByCode.get(String(pr.religion_code));
        return {
          code: String(pr.religion_code),
          name_en: (r?.name_en as string) ?? null,
          name_zh: (r?.name_zh as string) ?? null,
          role: String(pr.role_code),
          sy: pr.sy as number | null,
          ey: pr.ey as number | null,
        };
      }),
    classifications: classifications
      .filter((c) => c.people_code === p.code)
      .map((c) => ({
        taxonomy: String(c.taxonomy),
        node: String(c.node),
        name_en: c.node_name_en ?? null,
        name_zh: c.node_name_zh ?? null,
        relation: String(c.relation_code),
      })),
    relations: relations
      .filter((r) => r.a_code === p.code || r.b_code === p.code)
      .map((r) => ({
        rel: String(r.relation_code),
        direction: r.a_code === p.code ? 'out' : 'in',
        other_code: String(r.a_code === p.code ? r.b_code : r.a_code),
        other_name_en: (r.a_code === p.code ? r.b_name_en : r.a_name_en) ?? null,
        other_name_zh: (r.a_code === p.code ? r.b_name_zh : r.a_name_zh) ?? null,
        notes: (r.notes as string) ?? null,
      })),
  }));

  const eventsOut = events.map((e) => ({
    code: String(e.code),
    start_year: e.sy as number | null,
    end_year: e.ey as number | null,
    event_type: e.event_type_code,
    region_code: (e.region_code as string) ?? null,
    name_en: e.name_en ?? null,
    name_zh: e.name_zh ?? null,
    brief_en: (e.brief_en as string) ?? null,
    brief_zh: (e.brief_zh as string) ?? null,
    peoples: eventPeople
      .filter((ep) => ep.event_code === e.code)
      .map((ep) => ({ people_code: String(ep.people_code), role: String(ep.role_code) })),
  }));

  // enum 字典拉平为 {definition: {value: {lang: label}}}
  const enums: Record<string, Record<string, Record<string, string>>> = {};
  for (const row of enumLabels) {
    const d = String(row.definition_code);
    const v = String(row.value_code);
    (enums[d] ??= {})[v] ??= {};
    if (row.lang === 'en' || row.lang === 'zh') enums[d]![v]![String(row.lang)] = String(row.label);
  }

  const out = {
    generated_at: new Date().toISOString(),
    regions: regions.map((r) => ({
      code: String(r.code),
      region_type: r.region_type,
      start_year: r.sy as number | null,
      end_year: r.ey as number | null,
      name_en: r.name_en ?? null,
      name_zh: r.name_zh ?? null,
      brief_en: (r.brief_en as string) ?? null,
      brief_zh: (r.brief_zh as string) ?? null,
    })),
    peoples: peoplesOut,
    people_region: peopleRegion.map((pr) => ({
      people_code: String(pr.people_code),
      region_code: String(pr.region_code),
      presence: String(pr.presence_code),
      start_year: pr.sy as number | null,
      end_year: pr.ey as number | null,
      confidence: String(pr.confidence_code),
      render_priority: Number(pr.render_priority),
    })),
    religions: religions.map((r) => ({
      code: String(r.code),
      parent_code: (r.parent_code as string) ?? null,
      name_en: r.name_en ?? null,
      name_zh: r.name_zh ?? null,
    })),
    events: eventsOut,
    periods: periods.map((p) => ({
      code: String(p.code),
      start_year: p.sy as number | null,
      end_year: p.ey as number | null,
      name_en: p.name_en ?? null,
      name_zh: p.name_zh ?? null,
      brief_en: (p.brief_en as string) ?? null,
    })),
    enums,
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out), 'utf8');
  const bytes = (await import('node:fs')).statSync(OUT_FILE).size;
  console.log(
    `导出完成 -> ${path.relative(REPO_ROOT, OUT_FILE)} (${(bytes / 1024).toFixed(1)} KB)：` +
      `${out.regions.length} regions, ${out.peoples.length} peoples, ${out.people_region.length} people_region, ` +
      `${out.events.length} events, ${out.periods.length} periods`,
  );
}

void main();
