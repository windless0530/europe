// ============================================================
// AWMC loader · normalize
// data/raw/awmc -> data/processed/awmc
//  - regions.geojson：帝国范围类数据集溶解为单要素 MultiPolygon；
//    ethnonyms 逐要素输出（en_name 即族群名）
//  - places.geojson：urban_areas 城市建成区多边形取代表点
//  - lines.geojson：各年份罗马行省边界 linework（原始即线状）
// 全部源数据均为 WGS84，无投影转换。
// ============================================================

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as turf from '@turf/turf';
import * as shapefile from 'shapefile';
import {
  rawDataDir,
  processedDataDir,
  regionCode,
  slugify,
  writeJson,
  type PlaceFeature,
  type RegionFeature,
  type Ring,
  type SourceCode,
} from '../../lib/contract';
import { LINE_DATASETS, PLACES_DATASETS, REGION_DATASETS } from './config';

const SOURCE: SourceCode = 'awmc';

// ------------------------------------------------------------
// 本地类型（contract 未定义线要素类型，见 README open_issues）
// ------------------------------------------------------------
export interface LineFeatureProps {
  source: SourceCode;
  source_id: string;
  /** 规范化全局唯一代码：`${source}:${slug}`，与 region_code 同构 */
  line_code: string;
  name_en: string | null;
  name_zh: null;
  source_props: Record<string, unknown>;
}

export interface LineFeature {
  type: 'Feature';
  geometry: { type: 'LineString' | 'MultiLineString'; coordinates: unknown };
  properties: LineFeatureProps;
}

interface DatasetStat {
  id: string;
  kind: 'regions' | 'places' | 'lines';
  input_features: number;
  output_features: number;
  dropped: number;
  note?: string;
}

export interface NormalizeStats {
  generated_at: string;
  fixed: { regions: number; places: number; lines: number };
  dropped: { regions: number; places: number; lines: number };
  per_dataset: DatasetStat[];
}

/** 原始要素（geojson 与 shapefile 读取结果的公共形状） */
interface RawFeature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

// ------------------------------------------------------------
// 读取器
// ------------------------------------------------------------

async function readGeojson(file: string): Promise<RawFeature[]> {
  const text = await readFile(file, 'utf8');
  const fc = JSON.parse(text.replace(/^﻿/, '')) as { features?: RawFeature[] };
  return fc.features ?? [];
}

async function readShapefile(base: string): Promise<RawFeature[]> {
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`);
  const out: RawFeature[] = [];
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    out.push({
      geometry: (r.value.geometry as { type: string; coordinates: unknown } | null) ?? null,
      properties: r.value.properties ?? null,
    });
  }
  return out;
}

/** 预读全部输入数据集（file 相对 raw 目录；geojson 含扩展名，shapefile 不含） */
async function preload(files: string[]): Promise<Map<string, RawFeature[]>> {
  const rawDir = rawDataDir('awmc');
  const map = new Map<string, RawFeature[]>();
  for (const file of files) {
    const format = file.endsWith('.geojson') ? 'geojson' : 'shapefile';
    const full = path.join(rawDir, file);
    try {
      map.set(file, format === 'geojson' ? await readGeojson(full) : await readShapefile(full));
    } catch (err) {
      map.set(file, []);
      console.error(`  读取失败 ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return map;
}

// ------------------------------------------------------------
// 几何工具
// ------------------------------------------------------------

/** Polygon/MultiPolygon -> 多边形部件列表（Ring[][]）；非多边形返回 [] */
function polygonParts(geom: RawFeature['geometry']): Ring[][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates as Ring[]];
  if (geom.type === 'MultiPolygon') return geom.coordinates as Ring[][];
  return [];
}

/** region_code 去重：重名时追加 _2/_3 …（计入 fixed） */
class CodeUniquer {
  private seen = new Set<string>();
  fixed = 0;
  unique(slug: string): string {
    let s = slug;
    let n = 2;
    while (this.seen.has(s)) {
      s = `${slug}_${n}`;
      n++;
      this.fixed++;
    }
    this.seen.add(s);
    return s;
  }
}

// ------------------------------------------------------------
// regions
// ------------------------------------------------------------

function buildRegions(feats: Map<string, RawFeature[]>, stats: NormalizeStats): RegionFeature[] {
  const regions: RegionFeature[] = [];
  const uniquer = new CodeUniquer();

  for (const ds of REGION_DATASETS) {
    const stat: DatasetStat = { id: ds.id, kind: 'regions', input_features: 0, output_features: 0, dropped: 0 };
    const input = feats.get(ds.file);
    if (!input) {
      stat.note = '读取失败（见上方错误）';
      stats.per_dataset.push(stat);
      continue;
    }
    stat.input_features = input.length;

    if (ds.mode === 'dissolve') {
      // "帝国范围"类：整份数据集的多边形碎片合并为一个 MultiPolygon 要素
      const parts: Ring[][] = [];
      for (const f of input) {
        const p = polygonParts(f.geometry);
        if (p.length === 0) {
          stat.dropped++;
          continue;
        }
        parts.push(...p);
      }
      if (parts.length === 0) {
        stat.note = '全部要素几何为空或非多边形';
      } else {
        regions.push({
          type: 'Feature',
          geometry: { type: 'MultiPolygon', coordinates: parts },
          properties: {
            source: SOURCE,
            source_id: ds.id,
            region_code: regionCode(SOURCE, uniquer.unique(ds.id)),
            name_en: ds.name_en,
            name_zh: null,
            region_type: ds.region_type,
            level: null,
            start_year: null,
            end_year: null,
            parent_code: null,
            source_props: {
              awmc_dataset: ds.id,
              awmc_source_file: ds.file,
              parts,
              snapshot_year: ds.snapshot_year,
            },
          },
        });
        stat.output_features = 1;
      }
    } else {
      // per_feature（ethnonyms）：每个原始要素一个区域
      input.forEach((f, i) => {
        const parts = polygonParts(f.geometry);
        if (parts.length === 0) {
          stat.dropped++;
          return;
        }
        const props = f.properties ?? {};
        const enName = typeof props.en_name === 'string' && props.en_name.trim() ? props.en_name.trim() : null;
        const sourceId = enName ?? `${ds.id}#${i + 1}`;
        const slugBase = enName ? slugify(enName) : `${ds.id}_unnamed_${i + 1}`;
        const geom =
          parts.length === 1
            ? { type: 'Polygon' as const, coordinates: parts[0] }
            : { type: 'MultiPolygon' as const, coordinates: parts };
        regions.push({
          type: 'Feature',
          geometry: geom,
          properties: {
            source: SOURCE,
            source_id: sourceId,
            region_code: regionCode(SOURCE, uniquer.unique(slugBase)),
            name_en: enName,
            name_zh: null,
            region_type: ds.region_type,
            level: null,
            start_year: null,
            end_year: null,
            parent_code: null,
            source_props: { ...props, awmc_dataset: ds.id, snapshot_year: ds.snapshot_year },
          },
        });
        stat.output_features++;
      });
    }
    stats.per_dataset.push(stat);
  }

  stats.fixed.regions += uniquer.fixed;
  return regions;
}

// ------------------------------------------------------------
// places
// ------------------------------------------------------------

function buildPlaces(feats: Map<string, RawFeature[]>, stats: NormalizeStats): PlaceFeature[] {
  const places: PlaceFeature[] = [];
  const uniquer = new CodeUniquer();

  for (const ds of PLACES_DATASETS) {
    const stat: DatasetStat = { id: ds.id, kind: 'places', input_features: 0, output_features: 0, dropped: 0 };
    const input = feats.get(ds.file);
    if (!input) {
      stat.note = '读取失败（见上方错误）';
      stats.per_dataset.push(stat);
      continue;
    }
    stat.input_features = input.length;
    input.forEach((f, i) => {
      const parts = polygonParts(f.geometry);
      if (parts.length === 0) {
        stat.dropped++;
        return;
      }
      // 原始为城市建成区多边形，取"面内代表点"作为地点（决策见 README）
      const geom =
        parts.length === 1
          ? { type: 'Polygon' as const, coordinates: parts[0] }
          : { type: 'MultiPolygon' as const, coordinates: parts };
      const onSurface = turf.pointOnFeature({ type: 'Feature', geometry: geom, properties: {} });
      const props = f.properties ?? {};
      const title = typeof props.title === 'string' && props.title.trim() ? props.title.trim() : null;
      const pleiades = typeof props.pleiadesid === 'string' && props.pleiadesid.trim() ? props.pleiadesid.trim() : null;
      const sourceId = pleiades ? (pleiades.split('/').filter(Boolean).pop() as string) : (title ?? `${ds.id}#${i + 1}`);
      places.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: onSurface.geometry.coordinates },
        properties: {
          source: SOURCE,
          source_id: sourceId,
          place_code: regionCode(SOURCE, uniquer.unique(title ? slugify(title) : `${ds.id}_unnamed_${i + 1}`)),
          name_en: title,
          name_zh: null,
          place_type: ds.place_type,
          start_year: null,
          end_year: null,
          source_props: { ...props, awmc_dataset: ds.id },
        },
      });
      stat.output_features++;
    });
    stats.per_dataset.push(stat);
  }

  stats.fixed.places += uniquer.fixed;
  return places;
}

// ------------------------------------------------------------
// lines
// ------------------------------------------------------------

function buildLines(feats: Map<string, RawFeature[]>, stats: NormalizeStats): LineFeature[] {
  const lines: LineFeature[] = [];

  for (const ds of LINE_DATASETS) {
    const stat: DatasetStat = { id: ds.id, kind: 'lines', input_features: 0, output_features: 0, dropped: 0 };
    const input = feats.get(ds.file);
    if (!input) {
      stat.note = '读取失败（见上方错误）';
      stats.per_dataset.push(stat);
      continue;
    }
    stat.input_features = input.length;
    input.forEach((f, i) => {
      const g = f.geometry;
      if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) {
        stat.dropped++;
        return;
      }
      const props = f.properties ?? {};
      const objectId = props.OBJECTID !== undefined && props.OBJECTID !== null ? String(props.OBJECTID) : String(i + 1);
      lines.push({
        type: 'Feature',
        geometry: { type: g.type, coordinates: g.coordinates },
        properties: {
          source: SOURCE,
          source_id: `${ds.id}#${objectId}`,
          line_code: regionCode(SOURCE, `${ds.id}_${String(i + 1).padStart(3, '0')}`),
          name_en: ds.name_en,
          name_zh: null,
          source_props: { ...props, awmc_dataset: ds.id, snapshot_year: ds.snapshot_year },
        },
      });
      stat.output_features++;
    });
    stats.per_dataset.push(stat);
  }

  return lines;
}

// ------------------------------------------------------------
// 入口
// ------------------------------------------------------------

export async function runNormalize(): Promise<void> {
  const outDir = processedDataDir('awmc');
  await mkdir(outDir, { recursive: true });

  const stats: NormalizeStats = {
    generated_at: new Date().toISOString(),
    fixed: { regions: 0, places: 0, lines: 0 },
    dropped: { regions: 0, places: 0, lines: 0 },
    per_dataset: [],
  };

  console.log('读取原始数据…');
  const feats = await preload([
    ...REGION_DATASETS.map((d) => d.file),
    ...PLACES_DATASETS.map((d) => d.file),
    ...LINE_DATASETS.map((d) => d.file),
  ]);

  const regions = buildRegions(feats, stats);
  const places = buildPlaces(feats, stats);
  const lines = buildLines(feats, stats);

  for (const d of stats.per_dataset) stats.dropped[d.kind] += d.dropped;

  await writeJson(path.join(outDir, 'regions.geojson'), { type: 'FeatureCollection', features: regions });
  await writeJson(path.join(outDir, 'places.geojson'), { type: 'FeatureCollection', features: places });
  await writeJson(path.join(outDir, 'lines.geojson'), { type: 'FeatureCollection', features: lines });
  await writeFile(path.join(outDir, '_stats.json'), JSON.stringify(stats, null, 2), 'utf8');

  console.log(`\nnormalize 完成：regions=${regions.length} places=${places.length} lines=${lines.length}`);
  console.log(`  fixed=${JSON.stringify(stats.fixed)} dropped=${JSON.stringify(stats.dropped)}`);
  for (const d of stats.per_dataset) {
    console.log(`  - ${d.kind}/${d.id}: in=${d.input_features} out=${d.output_features} dropped=${d.dropped}${d.note ? ' [' + d.note + ']' : ''}`);
  }
  console.log(`  产物目录: ${path.relative(process.cwd(), outDir)}`);
}
