// ============================================================
// AWMC loader · validate
// 校验 data/processed/awmc 产物并生成 manifest.json：
//  - regions/places 用 contract 通用校验器；lines 用本地校验器
//    （契约未定义线类型，见 README open_issues）
//  - 追加自定义检查：无 crs 成员、name_zh=null、start/end_year=null、
//    region_type 字典、快照年份落位 source_props.snapshot_year
//  - fixed/dropped 计数取自 normalize 写出的 _stats.json
// ============================================================

import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  processedDataDir,
  rawDataDir,
  validateRegions,
  validatePlaces,
  emptyReport,
  type Manifest,
  type ManifestFileEntry,
  type RegionsFile,
  type PlacesFile,
  type SourceCode,
  type ValidationIssue,
  type ValidationReport,
} from '../../lib/contract';
import type { LineFeature } from './normalize';
import { GEOJSON_FILES, LICENSE, LICENSE_URL, SHAPEFILES_ZIP, SOURCE_HOMEPAGE, SOURCE_URL } from './config';

const SOURCE: SourceCode = 'awmc';
const ALLOWED_REGION_TYPES = new Set([
  'continent',
  'historical_region',
  'political_entity',
  'modern_country',
  'cultural_region',
]);

interface LinesFile {
  type: 'FeatureCollection';
  features: LineFeature[];
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** 坐标树遍历（contract 未导出 walkPositions，此处本地实现） */
function walkPositions(node: unknown, visit: (pos: number[]) => void): void {
  if (!Array.isArray(node)) return;
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

interface BoundsAcc {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * 坐标级校验 + 真实 bbox 计算。
 * 背景：contract.ts（冻结）的 checkCoords 把 geometry 对象直接传给
 * walkPositions（期望数组），导致其坐标校验与 bbox 统计实际不生效
 * （bounds 恒为 ±Infinity）。此处在自定义检查里补齐，并把真实
 * bbox 回填到报告，契约缺口记入 open_issues。
 */
function checkCoordinates(
  fc: { features: Array<{ geometry: unknown; properties: unknown }> },
  codeField: 'region_code' | 'place_code' | 'line_code',
  report: ValidationReport,
): void {
  const bounds: BoundsAcc = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  let sawAny = false;
  fc.features.forEach((f, i) => {
    const label = ((f.properties as Record<string, unknown> | null)?.[codeField] as string) ?? `#${i}`;
    const geom = f.geometry as { coordinates?: unknown } | null;
    if (!geom) return;
    walkPositions(geom.coordinates, (pos) => {
      const [lon, lat] = pos;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        report.issues.push({ level: 'error', feature: label, message: `非数值坐标: ${JSON.stringify(pos)}` });
        return;
      }
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        report.issues.push({
          level: 'error',
          feature: label,
          message: `坐标越界（经纬度交换或投影未转 4326？）: [${lon}, ${lat}]`,
        });
        return;
      }
      if (lon < bounds.minLon) bounds.minLon = lon;
      if (lat < bounds.minLat) bounds.minLat = lat;
      if (lon > bounds.maxLon) bounds.maxLon = lon;
      if (lat > bounds.maxLat) bounds.maxLat = lat;
      sawAny = true;
    });
  });
  report.bounds = sawAny ? [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat] : null;
}

function validateLines(fc: LinesFile, file: string): ValidationReport {
  const report = emptyReport(SOURCE, file);
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  const seen = new Set<string>();
  let sawAny = false;

  report.total = fc.features.length;
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i];
    const props = f.properties ?? ({} as LineFeature['properties']);
    const label = props.line_code ?? `#${i}`;
    let featureOk = true;

    const g = f.geometry as { type?: string } | null;
    if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) {
      report.issues.push({ level: 'error', feature: label, message: `几何类型不是线: ${g?.type ?? 'null'}` });
      featureOk = false;
    } else {
      report.geometry_types[g.type] = (report.geometry_types[g.type] ?? 0) + 1;
    }
    if (!props.source_id) {
      report.issues.push({ level: 'error', feature: label, message: 'source_id 缺失' });
      featureOk = false;
    }
    if (!props.line_code) {
      report.issues.push({ level: 'error', feature: label, message: 'line_code 缺失' });
      featureOk = false;
    } else if (seen.has(props.line_code)) {
      report.issues.push({ level: 'error', feature: label, message: `line_code 重复: ${props.line_code}` });
      featureOk = false;
    } else {
      seen.add(props.line_code);
    }
    walkPositions(f.geometry?.coordinates, (pos) => {
      const [lon, lat] = pos;
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        report.issues.push({ level: 'error', feature: label, message: `坐标非法: [${lon}, ${lat}]` });
        featureOk = false;
        return;
      }
      if (lon < bounds.minLon) bounds.minLon = lon;
      if (lat < bounds.minLat) bounds.minLat = lat;
      if (lon > bounds.maxLon) bounds.maxLon = lon;
      if (lat > bounds.maxLat) bounds.maxLat = lat;
      sawAny = true;
    });
    if (featureOk) report.passed++;
  }
  report.bounds = sawAny ? [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat] : null;
  return report;
}

/** 通用附加检查（regions 专属约定） */
function extraRegionChecks(fc: RegionsFile, report: ValidationReport): void {
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i];
    const p = f.properties;
    const label = p.region_code ?? `#${i}`;
    if (p.name_zh !== null) {
      issues.push({ level: 'warn', feature: label, message: `name_zh 应为 null，实际 ${JSON.stringify(p.name_zh)}` });
    }
    if (p.start_year !== null || p.end_year !== null) {
      issues.push({
        level: 'warn',
        feature: label,
        message: `快照型数据 start/end_year 应为 null（实际 ${p.start_year}/${p.end_year}）`,
      });
    }
    if (p.region_type !== null && !ALLOWED_REGION_TYPES.has(p.region_type)) {
      issues.push({ level: 'warn', feature: label, message: `region_type 不在字典内: ${p.region_type}` });
    }
    if (!p.source_props || typeof p.source_props !== 'object') {
      issues.push({ level: 'warn', feature: label, message: 'source_props 缺失或非对象' });
    }
  }
  report.issues.push(...issues);
}

async function fileEntry(
  file: string,
  kind: ManifestFileEntry['kind'],
  geometryTypes: Record<string, number>,
  features: number,
): Promise<ManifestFileEntry> {
  const bytes = existsSync(file) ? (await stat(file)).size : 0;
  return {
    path: relativeToRepo(file),
    kind,
    features,
    geometry_types: Object.keys(geometryTypes).sort(),
    bytes,
  };
}

function relativeToRepo(file: string): string {
  const root = path.resolve(process.cwd());
  return path.relative(root, file).split(path.sep).join('/');
}

export async function runValidate(): Promise<void> {
  const outDir = processedDataDir('awmc');
  const regionsPath = path.join(outDir, 'regions.geojson');
  const placesPath = path.join(outDir, 'places.geojson');
  const linesPath = path.join(outDir, 'lines.geojson');

  if (!existsSync(regionsPath)) {
    console.error(`产物缺失: ${regionsPath}，请先运行 normalize`);
    process.exitCode = 1;
    return;
  }

  const regions = await readJson<RegionsFile>(regionsPath);
  const places = existsSync(placesPath) ? await readJson<PlacesFile>(placesPath) : null;
  const lines = existsSync(linesPath) ? await readJson<LinesFile>(linesPath) : null;

  // contract 通用校验器
  const regionsReport = validateRegions(regions, SOURCE, relativeToRepo(regionsPath));
  extraRegionChecks(regions, regionsReport);
  const placesReport = places ? validatePlaces(places, SOURCE, relativeToRepo(placesPath)) : null;
  const linesReport = lines ? validateLines(lines, relativeToRepo(linesPath)) : null;

  // 坐标级校验 + 真实 bbox（补 contract 校验器不生效的部分，见 checkCoordinates 注释）
  checkCoordinates(regions, 'region_code', regionsReport);
  if (places) checkCoordinates(places, 'place_code', placesReport!);
  if (lines && linesReport) checkCoordinates(lines, 'line_code', linesReport);

  // normalize 统计（fixed/dropped）
  const statsPath = path.join(outDir, '_stats.json');
  const stats = existsSync(statsPath)
    ? await readJson<{ fixed: { regions: number; places: number; lines: number }; dropped: { regions: number; places: number; lines: number } }>(statsPath)
    : { fixed: { regions: 0, places: 0, lines: 0 }, dropped: { regions: 0, places: 0, lines: 0 } };
  regionsReport.fixed = stats.fixed.regions;
  regionsReport.dropped = stats.dropped.regions;
  if (placesReport) {
    placesReport.fixed = stats.fixed.places;
    placesReport.dropped = stats.dropped.places;
  }
  if (linesReport) {
    linesReport.fixed = stats.fixed.lines;
    linesReport.dropped = stats.dropped.lines;
  }

  // 检查产物文件不含 crs 成员（契约要求）
  for (const f of [regionsPath, placesPath, linesPath]) {
    if (!existsSync(f)) continue;
    const head = (await readFile(f, 'utf8')).slice(0, 200);
    if (head.includes('"crs"')) {
      (regionsReport.issues ||= []).push({ level: 'error', message: `${path.basename(f)} 含 crs 成员（契约禁止）` });
    }
  }

  // retrieved_at：取 _meta.json 最早下载时间，缺省用当前时间
  const metaPath = path.join(rawDataDir('awmc'), '_meta.json');
  let retrievedAt = new Date().toISOString();
  const downloadUrls = [...GEOJSON_FILES.map((f) => f.url), SHAPEFILES_ZIP.url];
  if (existsSync(metaPath)) {
    const meta = await readJson<{ downloads?: Array<{ url: string; retrieved_at: string }> }>(metaPath);
    const times = (meta.downloads ?? []).map((d) => d.retrieved_at).filter(Boolean).sort();
    if (times.length > 0) retrievedAt = times[0];
  }

  const files: ManifestFileEntry[] = [
    await fileEntry(regionsPath, 'regions', regionsReport.geometry_types, regions.features.length),
  ];
  if (places && placesReport) {
    files.push(await fileEntry(placesPath, 'places', placesReport.geometry_types, places.features.length));
  }
  if (lines && linesReport) {
    files.push(await fileEntry(linesPath, 'lines', linesReport.geometry_types, lines.features.length));
  }

  const reports = [regionsReport, placesReport, linesReport].filter((r): r is ValidationReport => r !== null);

  const manifest: Manifest = {
    source: SOURCE,
    title: 'AWMC Geodata — Ancient World Mapping Center (UNC Chapel Hill)',
    url: SOURCE_URL,
    download_urls: downloadUrls,
    license: LICENSE,
    license_url: LICENSE_URL,
    retrieved_at: retrievedAt,
    files,
    validation: reports,
    temporal_coverage: {
      start_year: -60,
      end_year: 314,
      note:
        '均为快照型图层（无起止区间）：罗马帝国范围覆盖 60 BCE / CE 14 / 69 / 117 / 200 / 314；' +
        '行省边界线覆盖 60 BCE / CE 14 / 69 / 75 / 100 / 200 / 戴克里先之后；' +
        '亚历山大帝国、阿契美尼德波斯、哈斯蒙尼/希律王国、意大利、senatorial provinces 与 ethnonyms ' +
        '原始数据未给出年份（snapshot_year=null，未编造）。ethnonyms 全部源自 Strabo《地理学》' +
        '（约成书于 7 BCE–23 CE，可作为粗略时间锚点，待后续人工核定）。',
    },
    coverage_note:
      '空间覆盖：地中海世界整体（西起伊比利亚 -9.5°，东至美索不达米亚/印度河 74°，北至多瑙-莱茵一线以北的喀尔巴阡 ' +
      '~56°N，南至撒哈拉/阿拉伯 ~14-23°N）。对本项目"欧洲各族群分布地图"：' +
      '(1) 核心亮点是 ethnonyms——109 个 Strabo 记载的族群领地多边形（100 个完全落在欧洲参考范围内，' +
      '集中在伊比利亚/高卢/意大利/巴尔干/黑海以北）；(2) 罗马帝国 6 个快照 + 7 套行省边界线支撑罗马时期时间轴；' +
      '(3) 明显缺失：罗马之外的古代欧洲（凯尔特/日耳曼/斯拉夫各族的领地多边形）、中世纪早期王国、' +
      '罗马行省的"带名称多边形"（AWMC 行省数据均为无名称边界线，需 DARMC 或后续人工对齐）、' +
      '东欧/斯堪的纳维亚细节（ethnonyms 在这些区域覆盖很薄）。',
    decisions: [
      'GitHub org 实际为 AWMC/geodata（任务书中的 AncientWorldMappingCenter/awmc-geodata 已失效，官网 GIS Data 页现指向 AWMC/geodata）',
      'GeoJSON 逐文件下载为主（README 称 most up-to-date），另下载 Cultural Shapefiles Apr 2024.zip 以获取 GeoJSON 目录缺失的数据集（ad_14/ad_69/314 范围、ethnonyms、ba_100 行省线、Italy_shading 等）',
      '帝国范围类数据集的原始要素是无名称的碎片多边形（ArcInfo 自动属性），溶解为每数据集 1 个 MultiPolygon 要素；碎片级 OBJECTID/AREA 等自动字段在溶解后无信息量，未保留（以 parts 计数代替）',
      '行省数据原始即为 arc 节点 linework（含 1 个 MultiLineString），turf polygonize 因拓扑未节点化无法构面（详见 open_issues），按契约以 lines.geojson 保留',
      'ethnonyms 逐要素输出为 cultural_region；source_id=en_name（原生 Id 字段全为 0）；Skythians/Senonians 各出现 2 次，region_code 追加 _2 后缀消歧',
      'urban_areas 建成区多边形取 pointOnSurface 代表点输出为 places（place_type=urban_area），source_id 优先用 pleiadesid 尾段',
      'hasmonean/herod 采用 GeoJSON 版本：Apr 2024 zip 内对应 shapefile 的 DBF/几何疑似与 persian_extent 串数据（样本属性完全一致），不可信',
      '跳过 pleiades places（34k 点、89MB DBF，属另一项目的快照，license 归属需单独处理）、roads、regional name linework、aqueducts 等非区域类图层',
      '全部源数据 prj 均为 WGS84（EPSG:4326），未使用 proj4',
      'temp_conquest（美索不达米亚临时征服区，欧洲范围外）未选入',
    ],
    open_issues: [
      '契约缺口：contract.ts 未定义线要素类型（LineFeatureProps/校验器），本 loader 以 region_code 同构的 line_code 本地实现，建议主会话统一裁决',
      '契约 bug（冻结文件，仅报告）：contract.ts 的 checkCoords 将 geometry 对象传给期望数组的 walkPositions，导致 validateRegions/validatePlaces 的坐标校验与 bbox 统计不生效（bounds 恒为 ±Infinity）；本 loader 在 validate 里另行实现坐标校验并回填真实 bounds',
      '行省多边形缺失：AWMC 发布的各年份行省数据均为无名称边界线且拓扑未节点化（去重+分段后 turf polygonize 仅得 0-7 个碎面），无法重建行省面；带名称的行省面需依赖 DARMC 数据源',
      'ethnonyms 无时间字段：全部 source=Strabo（约 7 BCE–23 CE 成书），如需上时间轴需人工核定 snapshot_year',
      'Apr 2024 zip 中 hasmonean/herod shapefile 疑似数据错误（属性与 persian_extent 串数据），已用 GeoJSON 版替代，可向上游反馈',
      'region_type 字典建议：ethnonyms（族群领地）映射到 cultural_region 尚可，但若后续需要"族群 (ethnic_group)"专类，建议扩展字典',
      'regional name linework（含 TITLE + P_MIN_DATE/P_MAX_DATE 时间信息）未启用：它是标签放置线而非边界，未来可提取为区域命名的时空参考',
      'processed/_stats.json 为 normalize 内部统计（供 manifest 回填 fixed/dropped），非对外产物',
    ],
  };

  const manifestPath = path.join(outDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // 摘要输出
  console.log('\n校验摘要：');
  for (const r of reports) {
    const errors = r.issues.filter((i) => i.level === 'error').length;
    const warns = r.issues.filter((i) => i.level === 'warn').length;
    console.log(
      `  ${path.basename(r.file)}: total=${r.total} passed=${r.passed} fixed=${r.fixed} dropped=${r.dropped} ` +
        `errors=${errors} warns=${warns} bounds=${r.bounds ? r.bounds.map((x) => x.toFixed(1)).join(',') : 'null'}`,
    );
    for (const i of r.issues.slice(0, 20)) {
      console.log(`    [${i.level}] ${i.feature ? i.feature + ': ' : ''}${i.message}`);
    }
    if (r.issues.length > 20) console.log(`    …共 ${r.issues.length} 条 issue`);
  }
  console.log(`\nmanifest 已写入: ${manifestPath}`);

  const hasError = reports.some((r) => r.issues.some((i) => i.level === 'error'));
  if (hasError) {
    console.error('\n存在 error 级校验问题');
    process.exitCode = 1;
  } else {
    console.log('校验通过（无 error）');
  }
}
