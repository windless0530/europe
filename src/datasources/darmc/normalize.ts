// ============================================================
// normalize：data/raw/darmc/*.geojson -> data/processed/darmc/
//   places.geojson  点（城市/定居点、中世纪城镇、主教区）
//   regions.geojson 面（罗马行省、中世纪王国）
//
// 字段映射与决策详见本目录 README.md。要点：
// - 快照型图层：snapshot_year 写入 source_props，start/end 留 null；
//   范围型快照（Provinces ca. 303-324）用 start/end 表达真实存在范围；
// - TIMEPERIOD（A/C/H/R/L 字母组合）无官方解码文档，不换算年份（置 null，
//   原样保留在 source_props），见 README open_issues；
// - name_en 用原始名（拉丁名原样），空白串视为 null；name_zh 一律 null；
// - source_props 原样保留原始属性键值，另附 layer / layer_title /
//   snapshot_year 三个溯源键（契约允许的附加键）；
// - 几何不修改：服务端已输出 4326；输出文件不带 crs 成员。
// ============================================================

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { simplify } from '@turf/turf';
import {
  PLACE_LAYERS,
  REGION_LAYERS,
  type LayerSpec,
} from './catalog';
import {
  rawDataDir,
  processedDataDir,
  slugify,
  writeJson,
  regionCode,
  enforceRingWinding,
  type PlaceFeature,
  type RegionFeature,
  type PlacesFile,
  type RegionsFile,
  type PointGeometry,
  type PolygonalGeometry,
} from '../../lib/contract';

interface RawFeature {
  type: 'Feature';
  id?: number | string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

interface RawFC {
  type: 'FeatureCollection';
  features: RawFeature[];
}

export interface LayerStat {
  key: string;
  raw: number;
  out: number;
  dropped: { reason: string; n: number }[];
  /** 仅 regions：简化前后顶点数 */
  verticesBefore?: number;
  verticesAfter?: number;
  /** 仅 regions：环向修复的外/洞环数量 */
  windingFixed?: number;
}

// ---------- 小工具 ----------

/** 字符串清洗：去掉首尾空白、折叠内部换行/连续空白；空白串 -> null */
function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function getOid(props: Record<string, unknown>): number | null {
  return toNum(props.OBJECTID) ?? toNum(props.ObjectId);
}

/** 原样保留原始属性 + 溯源附加键 */
function sourceProps(layer: LayerSpec, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  out.layer = layer.key;
  out.layer_title = layer.title;
  if (layer.snapshotYear !== null) out.snapshot_year = layer.snapshotYear;
  return out;
}

function featureCode(layerKey: string, name: string | null, oid: number): string {
  return `${layerKey}_${slugify(name ?? 'unnamed')}_${oid}`;
}

function readRaw(key: string): Promise<RawFC> {
  const file = path.join(rawDataDir('darmc'), `${key}.geojson`);
  return readFile(file, 'utf8').then((t) => JSON.parse(t) as RawFC);
}

// ---------- places ----------

/** cities 图层 CLASS -> place_type（取值全集见 README） */
const CITY_CLASS_TYPE: Record<string, string> = {
  City: 'city',
  Settlement: 'settlement',
  'Urban area': 'urban_area',
};

function placeName(layer: LayerSpec, props: Record<string, unknown>): string | null {
  switch (layer.family) {
    case 'cities':
    case 'bishoprics':
      return cleanStr(props.NAME) ?? cleanStr(props.ALTERN) ?? cleanStr(props.Altern);
    case 'towns':
      return cleanStr(props.CITYNAME);
    default:
      return null;
  }
}

function placeType(layer: LayerSpec, props: Record<string, unknown>): string | null {
  switch (layer.family) {
    case 'cities':
      return CITY_CLASS_TYPE[cleanStr(props.CLASS) ?? ''] ?? null;
    case 'towns':
      return 'town';
    case 'bishoprics':
      return 'bishopric';
    default:
      return null;
  }
}

async function normalizePlaces(): Promise<LayerStat[]> {
  const stats: LayerStat[] = [];
  const features: PlaceFeature[] = [];

  for (const layer of PLACE_LAYERS) {
    const fc = await readRaw(layer.key);
    const dropped = new Map<string, number>();
    let out = 0;

    for (const f of fc.features) {
      const props = f.properties ?? {};
      const oid = getOid(props);
      const g = f.geometry;

      if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) {
        dropped.set('geometry 非 Point/缺失', (dropped.get('geometry 非 Point/缺失') ?? 0) + 1);
        continue;
      }
      const [lon, lat] = g.coordinates as number[];
      if (![lon, lat].every((n) => typeof n === 'number' && Number.isFinite(n)) || (lon === 0 && lat === 0)) {
        dropped.set('坐标非法或为 [0,0]', (dropped.get('坐标非法或 [0,0]') ?? 0) + 1);
        continue;
      }
      if (oid === null) {
        dropped.set('缺少 OBJECTID', (dropped.get('缺少 OBJECTID') ?? 0) + 1);
        continue;
      }

      const name = placeName(layer, props);
      const code = featureCode(layer.key, name, oid);
      features.push({
        type: 'Feature',
        id: `darmc:${code}`,
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          source: 'darmc',
          source_id: toNum(props.DARMCID) !== null ? `${layer.key}:${toNum(props.DARMCID)}` : `${layer.key}:${oid}`,
          place_code: `darmc:${code}`,
          name_en: name,
          name_zh: null,
          place_type: placeType(layer, props),
          start_year: null,
          end_year: null,
          source_props: sourceProps(layer, props),
        },
      });
      out++;
    }

    stats.push({
      key: layer.key,
      raw: fc.features.length,
      out,
      dropped: [...dropped.entries()].map(([reason, n]) => ({ reason, n })),
    });
  }

  const out: PlacesFile = { type: 'FeatureCollection', features };
  await writeJson(path.join(processedDataDir('darmc'), 'places.geojson'), out);
  return stats;
}

// ---------- regions ----------

function regionName(layer: LayerSpec, props: Record<string, unknown>): string | null {
  switch (layer.family) {
    case 'provinces':
      // PROV_NAME 内嵌换行（如 "CRETA ET \nCYRENE"），清洗后作 name_en，原样留在 source_props
      return cleanStr(props.PROV_NAME) ?? cleanStr(props.SUBDIVISIO);
    case 'kingdoms':
      return cleanStr(props.KINGDOMNAME) ?? cleanStr(props.REGIONNAME);
    default:
      return null;
  }
}

/** 契约建议对齐 SQL region_type 字典；行省/王国均为 political_entity */
function regionType(layer: LayerSpec): string | null {
  if (layer.family === 'provinces' || layer.family === 'kingdoms') return 'political_entity';
  return null;
}

function countVertices(node: unknown): number {
  if (!Array.isArray(node)) return 0;
  if (node.length > 0 && typeof node[0] === 'number') return 1;
  let n = 0;
  for (const child of node) n += countVertices(child);
  return n;
}

/**
 * 几何简化（契约允许："几何过精时用 turf 简化并记录"）。
 * 服务端多边形顶点极密（kingdoms814 原始 86 万顶点/30MB），而这些边界
 * 本身是历史图集转绘的近似线，简化容差远低于其制图精度：
 * - provinces：0.001°（约 111m）——顶点不多，保守处理；
 * - kingdoms：0.002°（约 222m）——海岸线极密且边界本就是粗略近似，
 *   用较大容差把 processed 总量压回契约 ~30MB 预算内。
 */
const SIMPLIFY_TOLERANCE: Record<string, number> = {
  provinces: 0.001,
  kingdoms: 0.002,
};

async function normalizeRegions(): Promise<LayerStat[]> {
  const stats: LayerStat[] = [];
  const features: RegionFeature[] = [];

  for (const layer of REGION_LAYERS) {
    const fc = await readRaw(layer.key);
    const dropped = new Map<string, number>();
    let out = 0;
    let verticesBefore = 0;
    let verticesAfter = 0;
    let windingFixed = 0;

    for (const f of fc.features) {
      const props = f.properties ?? {};
      const oid = getOid(props);
      const g = f.geometry;

      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) {
        dropped.set(`geometry 非 Polygon/MultiPolygon（${g?.type ?? 'null'}）`, (dropped.get(`geometry 非 Polygon/MultiPolygon（${g?.type ?? 'null'}）`) ?? 0) + 1);
        continue;
      }
      if (oid === null) {
        dropped.set('缺少 OBJECTID', (dropped.get('缺少 OBJECTID') ?? 0) + 1);
        continue;
      }

      verticesBefore += countVertices(g.coordinates);
      const simplified = simplify(g as PolygonalGeometry, {
        tolerance: SIMPLIFY_TOLERANCE[layer.family] ?? 0.001,
      }) as PolygonalGeometry;
      windingFixed += enforceRingWinding(simplified);
      verticesAfter += countVertices(simplified.coordinates);

      const name = regionName(layer, props);
      const code = featureCode(layer.key, name, oid);
      features.push({
        type: 'Feature',
        id: `darmc:${code}`,
        geometry: simplified,
        properties: {
          source: 'darmc',
          source_id: `${layer.key}:${oid}`,
          region_code: regionCode('darmc', code),
          name_en: name,
          name_zh: null,
          region_type: regionType(layer),
          level: null,
          start_year: layer.startYear,
          end_year: layer.endYear,
          parent_code: null,
          source_props: sourceProps(layer, props),
        },
      });
      out++;
    }

    stats.push({
      key: layer.key,
      raw: fc.features.length,
      out,
      dropped: [...dropped.entries()].map(([reason, n]) => ({ reason, n })),
      verticesBefore,
      verticesAfter,
      windingFixed,
    });
  }

  const out: RegionsFile = { type: 'FeatureCollection', features };
  await writeJson(path.join(processedDataDir('darmc'), 'regions.geojson'), out);
  return stats;
}

// ---------- 入口 ----------

export interface NormalizeResult {
  places: LayerStat[];
  regions: LayerStat[];
}

export async function normalize(): Promise<NormalizeResult> {
  const places = await normalizePlaces();
  const regions = await normalizeRegions();

  const print = (title: string, stats: LayerStat[]) => {
    console.log(`\n${title}`);
    for (const s of stats) {
      const dropInfo = s.dropped.length > 0 ? `，丢弃 ${s.raw - s.out}（${s.dropped.map((d) => `${d.reason}: ${d.n}`).join('; ')}）` : '';
      const vtxInfo =
        s.verticesBefore !== undefined ? `，顶点 ${s.verticesBefore} -> ${s.verticesAfter}` : '';
      console.log(`  ${s.key}: ${s.raw} -> ${s.out}${dropInfo}${vtxInfo}`);
    }
  };
  print('normalize places：', places);
  print('normalize regions：', regions);

  console.log(`\n写出: ${path.join(processedDataDir('darmc'), 'places.geojson')}`);
  console.log(`写出: ${path.join(processedDataDir('darmc'), 'regions.geojson')}`);
  return { places, regions };
}
