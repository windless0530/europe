// ============================================================
// NUTS loader · normalize
// raw (GISCO NUTS 2024 GeoJSON + GADM 4.1 zip) ->
// processed/nuts/regions.geojson（契约 schema，见 src/lib/contract.ts）
//
// 关键映射：
//   NUTS: NUTS_ID->source_id, LEVL_CODE->level,
//         NAME_LATN->name_en（拉丁转写/国语名，非英文译名），
//         vintage 2024 -> source_props.vintage，start/end 留 null，
//         parent_code = NUTS 编码前缀（NUTS_ID 长 level+2 字符，父级取前 level+1 字符）
//   GADM: GID_1/GID_0 -> source_id, level=1/0,
//         COUNTRY/NAME_1 -> name_en（GADM JSON 剥掉空格，做保守恢复；
//         已知缺陷查 NAME_OVERRIDES 表），
//         source_props.origin='gadm'，parent_code 指向国家级要素
// 过滤：
//   - 欧洲参考 bbox [-31,27,45,73] 内无任何顶点的要素丢弃
//     （法国海外大区 FRY*、斯瓦尔巴 NO0B2、俄罗斯亚洲部分州）
//   - GADM 脱敏要素（"?"）与无属性要素（"NA"）丢弃
// ============================================================

import { existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import path from 'node:path';
import {
  type RegionFeature,
  type RegionsFile,
  type PolygonalGeometry,
  rawDataDir,
  processedDataDir,
  writeJson,
  slugify,
  regionCode,
  enforceRingWinding,
  REPO_ROOT,
} from '../../lib/contract';
import {
  NUTS_LEVELS,
  NUTS_YEAR,
  GADM_VERSION,
  GADM_COUNTRIES,
  EUROPE_BBOX,
  NAME_OVERRIDES,
  restoreGadmSpaces,
  nutsFileName,
  gadmFileName,
} from './config';

export interface NormalizeStats {
  generated_at: string;
  nuts: { kept: number; dropped_outside_europe: string[] };
  gadm: {
    kept: number;
    dropped_masked: string[];
    dropped_no_attrs: string[];
    dropped_outside_europe: string[];
    names_fixed: string[];
  };
  dropped_geometry_bad: string[];
  level_counts: Record<string, number>;
  origin_counts: Record<string, number>;
  regions_geojson_bytes: number;
  /** 环向修复的外/洞环数量 */
  winding_fixed: number;
}

/** 几何树中是否存在落在 bbox 内的顶点（对跨反经线几何也安全的相交判定） */
function anyVertexInBbox(geometry: unknown, bbox: readonly number[]): boolean {
  const [minX, minY, maxX, maxY] = bbox;
  let found = false;
  const root = (geometry as { coordinates?: unknown })?.coordinates ?? geometry;
  (function walk(node: unknown): void {
    if (found || !Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [lon, lat] = node as number[];
      if (lon >= minX && lon <= maxX && lat >= minY && lat <= maxY) found = true;
      return;
    }
    for (const child of node) walk(child);
  })(root);
  return found;
}

function isPolygonal(geom: unknown): geom is PolygonalGeometry {
  const g = geom as { type?: string } | null;
  return !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
}

function readGadmZip(iso3: string, level: number): { features: Array<{ geometry: unknown; properties: Record<string, unknown> }> } {
  const file = path.join(rawDataDir('nuts'), 'gadm', gadmFileName(iso3, level));
  if (!existsSync(file)) throw new Error(`GADM 原始文件缺失：${file}（先运行 download）`);
  const zip = new AdmZip(file);
  const entry = zip.getEntries().find((e) => e.entryName.endsWith('.json'));
  if (!entry) throw new Error(`zip 内未找到 .json：${file}`);
  return JSON.parse(zip.readAsText(entry));
}

function readNuts(level: number): { features: Array<{ geometry: unknown; properties: Record<string, unknown> }> } {
  const file = path.join(rawDataDir('nuts'), nutsFileName(level));
  if (!existsSync(file)) throw new Error(`NUTS 原始文件缺失：${file}（先运行 download）`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function countKey(obj: Record<string, number>, key: number | string): void {
  const k = String(key);
  obj[k] = (obj[k] ?? 0) + 1;
}

export async function runNormalize(): Promise<NormalizeStats> {
  const stats: NormalizeStats = {
    generated_at: new Date().toISOString(),
    nuts: { kept: 0, dropped_outside_europe: [] },
    gadm: { kept: 0, dropped_masked: [], dropped_no_attrs: [], dropped_outside_europe: [], names_fixed: [] },
    dropped_geometry_bad: [],
    level_counts: {},
    origin_counts: {},
    regions_geojson_bytes: 0,
    winding_fixed: 0,
  };

  const features: RegionFeature[] = [];

  // ---------------- NUTS ----------------
  const codeByNutsId = new Map<string, string>();
  for (const level of NUTS_LEVELS) {
    // LEVL_CODE 与文件名层级一致；仍以属性为准写入 level
    const fc = readNuts(level);
    for (const f of fc.features) {
      const p = f.properties ?? {};
      const nutsId = typeof p.NUTS_ID === 'string' ? p.NUTS_ID : '';
      if (!nutsId) {
        stats.dropped_geometry_bad.push(`LEVL ${level} #无 NUTS_ID`);
        continue;
      }
      if (!isPolygonal(f.geometry)) {
        stats.dropped_geometry_bad.push(`${nutsId} 几何非多边形`);
        continue;
      }
      if (!anyVertexInBbox(f.geometry, EUROPE_BBOX)) {
        stats.nuts.dropped_outside_europe.push(`${nutsId} ${p.NAME_LATN ?? ''}`.trim());
        continue;
      }
      const code = regionCode('nuts', slugify(nutsId));
      codeByNutsId.set(nutsId, code);
      const parentCode = level > 0 ? codeByNutsId.get(nutsId.slice(0, level + 1)) ?? null : null;
      features.push({
        type: 'Feature',
        id: code,
        geometry: f.geometry,
        properties: {
          source: 'nuts',
          source_id: nutsId,
          region_code: code,
          // NAME_LATN：拉丁转写/国语名（如 "Crna Gora"、"İstanbul"），不是英文译名
          name_en: (typeof p.NAME_LATN === 'string' && p.NAME_LATN) || (typeof p.NUTS_NAME === 'string' && p.NUTS_NAME) || null,
          name_zh: null,
          region_type: null,
          level: typeof p.LEVL_CODE === 'number' ? p.LEVL_CODE : level,
          start_year: null,
          end_year: null,
          parent_code: parentCode,
          source_props: { ...p, origin: 'nuts', vintage: NUTS_YEAR },
        },
      });
      stats.nuts.kept++;
    }
  }

  // ---------------- GADM ----------------
  for (const spec of GADM_COUNTRIES) {
    const countryCode = spec.parentOverride ?? regionCode('nuts', slugify(spec.iso3));

    if (spec.levels.includes(0)) {
      const fc = readGadmZip(spec.iso3, 0);
      const f = fc.features[0];
      if (!f || !isPolygonal(f.geometry)) {
        stats.dropped_geometry_bad.push(`GADM ${spec.iso3} L0 几何缺失`);
      } else if (!anyVertexInBbox(f.geometry, EUROPE_BBOX)) {
        stats.gadm.dropped_outside_europe.push(`${spec.iso3} L0（国家级整体在 bbox 外）`);
      } else {
        const gid0 = typeof f.properties.GID_0 === 'string' && f.properties.GID_0 !== 'NA' ? f.properties.GID_0 : spec.iso3;
        const code = regionCode('nuts', slugify(gid0));
        const name = NAME_OVERRIDES[gid0] ?? restoreGadmSpaces(f.properties.COUNTRY);
        if (name && name !== f.properties.COUNTRY) stats.gadm.names_fixed.push(`${gid0}: "${f.properties.COUNTRY}" -> "${name}"`);
        features.push({
          type: 'Feature',
          id: code,
          geometry: f.geometry,
          properties: {
            source: 'nuts',
            source_id: gid0,
            region_code: code,
            name_en: name,
            name_zh: null,
            region_type: null,
            level: 0,
            start_year: null,
            end_year: null,
            parent_code: null,
            source_props: { ...f.properties, origin: 'gadm', gadm_version: GADM_VERSION },
          },
        });
        stats.gadm.kept++;
      }
    }

    if (spec.levels.includes(1)) {
      const fc = readGadmZip(spec.iso3, 1);
      for (const f of fc.features) {
        const p = f.properties ?? {};
        const gid1 = typeof p.GID_1 === 'string' ? p.GID_1 : '';
        // GADM 4.1 对乌克兰部分要素脱敏（GID_1/NAME_1 = "?"）
        if (gid1 === '?' || p.NAME_1 === '?') {
          stats.gadm.dropped_masked.push(`${spec.iso3} L1 要素（GADM 脱敏"?"）`);
          continue;
        }
        // GBR_1 里有一个全属性为 "NA" 的无法识别要素
        if (!gid1 || gid1 === 'NA') {
          stats.gadm.dropped_no_attrs.push(`${spec.iso3} L1 要素（属性全为 "NA"，不可识别）`);
          continue;
        }
        if (!isPolygonal(f.geometry)) {
          stats.dropped_geometry_bad.push(`${gid1} 几何非多边形`);
          continue;
        }
        if (!anyVertexInBbox(f.geometry, EUROPE_BBOX)) {
          stats.gadm.dropped_outside_europe.push(`${gid1} ${p.NAME_1 ?? ''}`.trim());
          continue;
        }
        const code = regionCode('nuts', slugify(gid1));
        const name = NAME_OVERRIDES[gid1] ?? restoreGadmSpaces(p.NAME_1);
        if (name && p.NAME_1 !== 'NA' && name !== p.NAME_1) {
          stats.gadm.names_fixed.push(`${gid1}: "${p.NAME_1}" -> "${name}"`);
        }
        features.push({
          type: 'Feature',
          id: code,
          geometry: f.geometry,
          properties: {
            source: 'nuts',
            source_id: gid1,
            region_code: code,
            name_en: name,
            name_zh: null,
            region_type: null,
            level: 1,
            start_year: null,
            end_year: null,
            parent_code: countryCode,
            source_props: { ...p, origin: 'gadm', gadm_version: GADM_VERSION },
          },
        });
        stats.gadm.kept++;
      }
    }
  }

  // 确定性排序：按 level、source_id
  features.sort((a, b) =>
    a.properties.level !== b.properties.level
      ? (a.properties.level ?? 99) - (b.properties.level ?? 99)
      : a.properties.source_id.localeCompare(b.properties.source_id),
  );
  for (const f of features) {
    countKey(stats.level_counts, f.properties.level ?? 'null');
    const origin = (f.properties.source_props as Record<string, unknown>).origin;
    countKey(stats.origin_counts, typeof origin === 'string' ? origin : 'unknown');
  }

  // 环向一致性：个别 ESRI 系要素存在与惯例相反的外环（d3-geo 会渲染成
  // 整球补集），写出前统一强制 外环CW/洞CCW
  let windingFixed = 0;
  for (const f of features) windingFixed += enforceRingWinding(f.geometry);
  stats.winding_fixed = windingFixed;

  const outDir = processedDataDir('nuts');
  const regionsFile = path.join(outDir, 'regions.geojson');
  const fc: RegionsFile = { type: 'FeatureCollection', features };
  await writeJson(regionsFile, fc);
  stats.regions_geojson_bytes = (await stat(regionsFile)).size;

  // 供 manifest 记录 fixed/dropped（validate 阶段读取合并）
  await writeJson(path.join(outDir, 'normalize_stats.json'), stats);

  console.log(`normalize 完成：${features.length} 个要素 -> ${path.relative(REPO_ROOT, regionsFile)}`);
  console.log(`  NUTS 保留 ${stats.nuts.kept}，bbox 外丢弃 ${stats.nuts.dropped_outside_europe.length}`);
  console.log(`  GADM 保留 ${stats.gadm.kept}，丢弃：脱敏 ${stats.gadm.dropped_masked.length} / 无属性 ${stats.gadm.dropped_no_attrs.length} / bbox 外 ${stats.gadm.dropped_outside_europe.length}`);
  console.log(`  层级分布: ${JSON.stringify(stats.level_counts)}  来源: ${JSON.stringify(stats.origin_counts)}`);
  console.log(`  体积: ${(stats.regions_geojson_bytes / 1048576).toFixed(1)} MB`);
  return stats;
}
