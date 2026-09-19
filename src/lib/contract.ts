// ============================================================
// 数据契约（三个 data loader 共同遵守）
// 详细规范见 docs/data-contract.md。
//
// 注意：本文件在 loader 开发期间视为“冻结”——
// 修改它需要三个 datasource 同步适配，因此任何 datasource
// agent 不得修改本文件；确有契约缺口时在各自 README 的
// open_issues 里记录，由主会话统一裁决。
// ============================================================

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type SourceCode = 'awmc' | 'darmc' | 'nuts';

export const SOURCES: SourceCode[] = ['awmc', 'darmc', 'nuts'];

// ------------------------------------------------------------
// 最小 GeoJSON 结构类型（不依赖外部 @types）
// ------------------------------------------------------------

/** 线环：[[lon, lat], ...] */
export type Ring = number[][];

export interface SimplePolygon {
  type: 'Polygon';
  coordinates: Ring[];
}

export interface SimpleMultiPolygon {
  type: 'MultiPolygon';
  coordinates: Ring[][];
}

export type PolygonalGeometry = SimplePolygon | SimpleMultiPolygon;

export interface PointGeometry {
  type: 'Point';
  coordinates: number[];
}

// ------------------------------------------------------------
// 区域（多边形）要素
// ------------------------------------------------------------
export interface RegionFeatureProps {
  /** 数据来源，等于 loader 名 */
  source: SourceCode;
  /** 原数据集中的稳定 id（无原生 id 时用原始名称/编码，需在 README 说明生成规则） */
  source_id: string;
  /** 规范化全局唯一代码：`${source}:${slug}` */
  region_code: string;
  /** 英文名；原数据无名称时为 null */
  name_en: string | null;
  /** 中文名；本阶段一律留 null，翻译在后续统一阶段处理 */
  name_zh: string | null;
  /**
   * 尽量对齐 SQL 中 region_type 字典
   * (continent / historical_region / political_entity /
   *  modern_country / cultural_region)；对不上时为 null，
   * 并在 README 里建议字典扩展。
   */
  region_type: string | null;
  /** 行政/统计层级（如 NUTS 0-3），无层级概念时为 null */
  level: number | null;
  /**
   * 原始时间语义不明时为 null。
   * 约定：快照型数据（如“117 年的罗马行省”）把快照年份放
   * source_props（如 snapshot_year），start/end 留 null；
   * 版本型数据（如 NUTS 2021）把 vintage 放 source_props。
   */
  start_year: number | null;
  end_year: number | null;
  /** 上级区域的 region_code，无则 null */
  parent_code: string | null;
  /** 原始属性原样保留（键名保持原样，不做翻译/改名） */
  source_props: Record<string, unknown>;
}

export interface RegionFeature {
  type: 'Feature';
  id?: string | number;
  geometry: PolygonalGeometry;
  properties: RegionFeatureProps;
}

export interface RegionsFile {
  type: 'FeatureCollection';
  features: RegionFeature[];
}

// ------------------------------------------------------------
// 地点（点）要素：城市 / 定居点 / 事件地等
// ------------------------------------------------------------
export interface PlaceFeatureProps {
  source: SourceCode;
  source_id: string;
  place_code: string;
  name_en: string | null;
  name_zh: string | null;
  /** 自由编码（city / settlement / bishopric / monastery ...），取值在 README 列全 */
  place_type: string | null;
  start_year: number | null;
  end_year: number | null;
  source_props: Record<string, unknown>;
}

export interface PlaceFeature {
  type: 'Feature';
  id?: string | number;
  geometry: PointGeometry;
  properties: PlaceFeatureProps;
}

export interface PlacesFile {
  type: 'FeatureCollection';
  features: PlaceFeature[];
}

// ------------------------------------------------------------
// 校验与清单
// ------------------------------------------------------------
export interface ValidationIssue {
  level: 'error' | 'warn' | 'info';
  message: string;
  /** 相关要素的 region_code / place_code / 序号 */
  feature?: string;
}

export interface ValidationReport {
  source: SourceCode;
  /** 相对仓库根的文件路径 */
  file: string;
  total: number;
  /** 无 error 的要素数 */
  passed: number;
  /** normalize 阶段自动修复的数量（validate 本身只报告，默认 0） */
  fixed: number;
  /** normalize 阶段丢弃的数量（validate 本身只报告，默认 0） */
  dropped: number;
  geometry_types: Record<string, number>;
  /** [minLon, minLat, maxLon, maxLat] */
  bounds: [number, number, number, number] | null;
  issues: ValidationIssue[];
}

export interface ManifestFileEntry {
  /** 相对仓库根路径 */
  path: string;
  kind: 'regions' | 'places' | 'lines' | 'other';
  features: number;
  geometry_types: string[];
  bytes: number;
}

export interface Manifest {
  source: SourceCode;
  title: string;
  /** 数据主页 / 入口 */
  url: string;
  /** 实际使用的下载 URL 列表 */
  download_urls: string[];
  license: string;
  license_url: string | null;
  /** ISO 8601 */
  retrieved_at: string;
  files: ManifestFileEntry[];
  validation: ValidationReport[];
  temporal_coverage: { start_year: number | null; end_year: number | null; note: string } | null;
  /** 空间覆盖说明：覆盖哪些区域、明显缺什么 */
  coverage_note: string;
  /** 关键决策记录（为什么选这个数据集/这样映射） */
  decisions: string[];
  open_issues: string[];
}

// ------------------------------------------------------------
// 工具函数
// ------------------------------------------------------------

/** 平面鞋带面积（经纬度坐标按平面近似；仅用于判断绕向符号） */
export function ringSignedArea(ring: number[][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return s / 2;
}

/**
 * 强制环向一致：外环 CW（shoelace < 0），洞 CCW（> 0）。
 * 本仓库三个数据源（ESRI/ArcGIS 系 GeoJSON）的外环惯例均为 CW；
 * 同一 MultiPolygon 内若个别 part 环向相反，d3-geo 会把它当补集
 * 渲染成"整个投影球减去该 part"（表现为巨幅色块覆盖全图），
 * 因此在 normalize 阶段统一修正。返回修复的环数量。
 */
export function enforceRingWinding(geom: PolygonalGeometry): number {
  const polys: Ring[][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let fixed = 0;
  for (const rings of polys) {
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r]!;
      const area = ringSignedArea(ring);
      if (Math.abs(area) < 1e-15) continue;
      const wantPositive = r > 0; // 外环 CW（负），洞 CCW（正）
      if (area > 0 !== wantPositive) {
        ring.reverse();
        fixed++;
      }
    }
  }
  return fixed;
}

/** 生成 url-safe slug：仅小写字母/数字/下划线 */
export function slugify(input: string): string {
  const s = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return s.length > 0 ? s : 'unnamed';
}

export function regionCode(source: SourceCode, slug: string): string {
  return `${source}:${slug}`;
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data), 'utf8');
}

export function emptyReport(source: SourceCode, file: string): ValidationReport {
  return {
    source,
    file,
    total: 0,
    passed: 0,
    fixed: 0,
    dropped: 0,
    geometry_types: {},
    bounds: null,
    issues: [],
  };
}

// ------------------------------------------------------------
// 通用校验器
// ------------------------------------------------------------

/**
 * 递归访问 GeoJSON 坐标树里的每个位置点 [lon, lat]。
 * 既支持传入坐标数组（嵌套 rings），也支持传入 geometry 对象
 * （{type, coordinates}）——后者向下钻取 coordinates 成员。
 */
function walkPositions(node: unknown, visit: (pos: number[]) => void): void {
  if (!Array.isArray(node)) {
    if (node && typeof node === 'object' && 'coordinates' in node) {
      walkPositions((node as { coordinates: unknown }).coordinates, visit);
    }
    return;
  }
  if (
    node.length >= 2 &&
    typeof node[0] === 'number' &&
    typeof node[1] === 'number' &&
    node.every((n) => typeof n === 'number')
  ) {
    visit(node as number[]);
    return;
  }
  for (const child of node) walkPositions(child, visit);
}

function checkCoords(
  geometry: unknown,
  report: ValidationReport,
  label: string,
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number },
): boolean {
  let ok = true;
  walkPositions(geometry, (pos) => {
    const [lon, lat] = pos;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      report.issues.push({ level: 'error', feature: label, message: `非数值坐标: ${JSON.stringify(pos)}` });
      ok = false;
      return;
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      report.issues.push({
        level: 'error',
        feature: label,
        message: `坐标越界（经纬度交换或投影未转 4326？）: [${lon}, ${lat}]`,
      });
      ok = false;
      return;
    }
    if (lon < bounds.minLon) bounds.minLon = lon;
    if (lat < bounds.minLat) bounds.minLat = lat;
    if (lon > bounds.maxLon) bounds.maxLon = lon;
    if (lat > bounds.maxLat) bounds.maxLat = lat;
  });
  return ok;
}

function finalize(report: ValidationReport, bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }, sawAny: boolean): ValidationReport {
  report.bounds = sawAny ? [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat] : null;
  return report;
}

/**
 * 校验规范化后的 regions FeatureCollection：
 * - 几何必须是 Polygon / MultiPolygon 且非空
 * - 必填字段（source / source_id / region_code）非空
 * - region_code 全局唯一
 * - 坐标为有限数且在经纬度范围内（顺带统计 bbox）
 * 只报告、不修改数据；fixed/dropped 由 normalize 阶段自行填入 manifest。
 */
export function validateRegions(fc: { features: Array<{ geometry: unknown; properties: unknown }> }, source: SourceCode, file: string): ValidationReport {
  const report = emptyReport(source, file);
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  const seen = new Set<string>();
  let sawAny = false;

  report.total = fc.features.length;
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i];
    const props = (f.properties ?? {}) as Partial<RegionFeatureProps>;
    const label = props.region_code ?? `#${i}`;
    let featureOk = true;

    const g = f.geometry as { type?: string } | null;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) {
      report.issues.push({ level: 'error', feature: label, message: `几何类型不是多边形: ${g?.type ?? 'null'}` });
      featureOk = false;
    } else {
      report.geometry_types[g.type] = (report.geometry_types[g.type] ?? 0) + 1;
      const empty = g.type === 'Polygon'
        ? !((f.geometry as SimplePolygon).coordinates?.length)
        : !((f.geometry as SimpleMultiPolygon).coordinates?.length);
      if (empty) {
        report.issues.push({ level: 'error', feature: label, message: '空坐标' });
        featureOk = false;
      }
    }

    if (!props.source_id) {
      report.issues.push({ level: 'error', feature: label, message: 'source_id 缺失' });
      featureOk = false;
    }
    if (!props.region_code) {
      report.issues.push({ level: 'error', feature: label, message: 'region_code 缺失' });
      featureOk = false;
    } else if (seen.has(props.region_code)) {
      report.issues.push({ level: 'error', feature: label, message: `region_code 重复: ${props.region_code}` });
      featureOk = false;
    } else {
      seen.add(props.region_code);
    }
    if (props.name_en === undefined) {
      report.issues.push({ level: 'warn', feature: label, message: 'name_en 为 undefined（应为 string | null）' });
    }

    if (checkCoords(f.geometry, report, label, bounds)) sawAny = true;
    if (featureOk) report.passed++;
  }

  return finalize(report, bounds, sawAny);
}

/** 校验规范化后的 places FeatureCollection（同上，针对点要素） */
export function validatePlaces(fc: { features: Array<{ geometry: unknown; properties: unknown }> }, source: SourceCode, file: string): ValidationReport {
  const report = emptyReport(source, file);
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  const seen = new Set<string>();
  let sawAny = false;

  report.total = fc.features.length;
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i];
    const props = (f.properties ?? {}) as Partial<PlaceFeatureProps>;
    const label = props.place_code ?? `#${i}`;
    let featureOk = true;

    const g = f.geometry as { type?: string } | null;
    if (!g || g.type !== 'Point') {
      report.issues.push({ level: 'error', feature: label, message: `几何类型不是 Point: ${g?.type ?? 'null'}` });
      featureOk = false;
    } else {
      report.geometry_types['Point'] = (report.geometry_types['Point'] ?? 0) + 1;
      const coords = (f.geometry as PointGeometry).coordinates;
      if (!Array.isArray(coords) || coords.length < 2) {
        report.issues.push({ level: 'error', feature: label, message: '点坐标缺失' });
        featureOk = false;
      }
    }

    if (!props.source_id) {
      report.issues.push({ level: 'error', feature: label, message: 'source_id 缺失' });
      featureOk = false;
    }
    if (!props.place_code) {
      report.issues.push({ level: 'error', feature: label, message: 'place_code 缺失' });
      featureOk = false;
    } else if (seen.has(props.place_code)) {
      report.issues.push({ level: 'error', feature: label, message: `place_code 重复: ${props.place_code}` });
      featureOk = false;
    } else {
      seen.add(props.place_code);
    }

    if (checkCoords(f.geometry, report, label, bounds)) sawAny = true;
    if (featureOk) report.passed++;
  }
  return finalize(report, bounds, sawAny);
}

/** 仓库根目录（src/lib 的上一级） */
export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export function rawDataDir(source: SourceCode): string {
  return path.join(REPO_ROOT, 'data', 'raw', source);
}

export function processedDataDir(source: SourceCode): string {
  return path.join(REPO_ROOT, 'data', 'processed', source);
}
