// ============================================================
// validate：校验 processed 产物并生成 manifest.json
//
// - 通用校验用契约里的 validatePlaces / validateRegions；
// - 追加自定义检查：place_type 取值域、退化环、[0,0] 点、
//   欧洲参考范围之外的覆盖提示（info）；
// - dropped / fixed 由 raw 与 processed 的要素数差值重新推得
//   （validate 独立运行时也成立；normalize 不做"修复"，fixed 恒 0）。
// ============================================================

import { readFile, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import {
  ALL_LAYERS,
  DATA_AVAILABILITY_URL,
  LICENSE,
  LICENSE_URL,
  SERVICE_INFO_URL,
  layerQueryUrl,
  type LayerSpec,
} from './catalog';
import type { NormalizeResult } from './normalize';
import {
  processedDataDir,
  rawDataDir,
  validatePlaces,
  validateRegions,
  writeJson,
  type Manifest,
  type ManifestFileEntry,
  type PlacesFile,
  type RegionFeature,
  type RegionsFile,
  type ValidationIssue,
  type ValidationReport,
} from '../../lib/contract';

/** README 中列全的 place_type 取值域 */
const PLACE_TYPE_VOCAB = new Set(['city', 'settlement', 'urban_area', 'town', 'bishopric']);

/** 欧洲参考范围（契约） */
const EUROPE_LON: [number, number] = [-31, 45];
const EUROPE_LAT: [number, number] = [27, 73];

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err; // 非"文件不存在"的错误不应被吞掉
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

// ---------- 自定义检查 ----------

function checkPlacesCustom(fc: PlacesFile, report: ValidationReport): void {
  let unnamed = 0;
  let noType = 0;
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i];
    const label = f.properties.place_code ?? `#${i}`;
    if (f.properties.name_en === null) unnamed++;
    const t = f.properties.place_type;
    if (t === null || t === undefined) {
      noType++;
    } else if (!PLACE_TYPE_VOCAB.has(t)) {
      report.issues.push({ level: 'error', feature: label, message: `place_type 超出词表: ${t}` });
    }
    const [lon, lat] = f.geometry.coordinates;
    if (lon === 0 && lat === 0) {
      report.issues.push({ level: 'error', feature: label, message: '坐标为 [0,0]' });
    }
  }
  if (unnamed > 0) {
    report.issues.push({ level: 'info', message: `${unnamed} 个要素 name_en 为 null（原始数据无名）` });
  }
  if (noType > 0) {
    report.issues.push({ level: 'warn', message: `${noType} 个要素 place_type 为 null（CLASS 无法识别）` });
  }
}

function walkRings(node: unknown, visit: (ring: unknown) => void): void {
  if (!Array.isArray(node) || node.length === 0) return;
  // 环 = 位置数组的数组；位置（元素是 number）不是环，跳过
  if (Array.isArray(node[0]) && typeof node[0][0] === 'number') {
    visit(node);
    return;
  }
  for (const child of node) walkRings(child, visit);
}

/**
 * 契约的 validatePlaces/validateRegions 里 checkCoords 把 geometry 对象
 * 传给只处理数组的 walkPositions，坐标遍历从不触达，bounds 恒为 null
 * （契约冻结不能改，见 README open_issues）。这里自定义补算 bounds。
 */
function computeBounds(fc: { features: Array<{ geometry: unknown }> }, report: ValidationReport): void {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visitPos = (pos: unknown) => {
    if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') return;
    const [lon, lat] = pos as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  };
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      visitPos(node);
      return;
    }
    for (const child of node) walk(child);
  };
  for (const f of fc.features) walk(f.geometry && (f.geometry as { coordinates?: unknown }).coordinates);
  if (Number.isFinite(minLon)) report.bounds = [minLon, minLat, maxLon, maxLat];
}

function checkRegionsCustom(fc: RegionsFile, report: ValidationReport): void {
  let degenerate = 0;
  for (let i = 0; i < fc.features.length; i++) {
    const f: RegionFeature = fc.features[i];
    const label = f.properties.region_code ?? `#${i}`;
    walkRings(f.geometry.coordinates, (ring) => {
      if (!Array.isArray(ring) || ring.length < 4) degenerate++;
    });
    if (f.properties.name_en === null) {
      report.issues.push({ level: 'warn', feature: label, message: 'name_en 为 null' });
    }
  }
  if (degenerate > 0) {
    report.issues.push({ level: 'warn', message: `${degenerate} 个环顶点数 < 4（退化几何，原样保留）` });
  }
}

function coverageHint(report: ValidationReport): void {
  const b = report.bounds;
  if (!b) return;
  const outside =
    b[0] < EUROPE_LON[0] || b[1] < EUROPE_LAT[0] || b[2] > EUROPE_LON[1] || b[3] > EUROPE_LAT[1];
  if (outside) {
    report.issues.push({
      level: 'info',
      message: `bounds [${b.join(', ')}] 超出欧洲参考范围（地中海/近东边缘属罗马世界正常覆盖）`,
    });
  }
}

// ---------- raw 计数（推 dropped 用） ----------

async function countRaw(layerKeys: string[]): Promise<number> {
  let total = 0;
  for (const key of layerKeys) {
    const file = path.join(rawDataDir('darmc'), `${key}.geojson`);
    if (!(await exists(file))) continue;
    const fc = await readJson<{ features: unknown[] }>(file);
    total += fc.features.length;
  }
  return total;
}

// ---------- 入口 ----------

export interface ValidateResult {
  manifest: Manifest;
}

export async function validate(norm?: NormalizeResult): Promise<ValidateResult> {
  const dir = processedDataDir('darmc');
  const placesFile = path.join(dir, 'places.geojson');
  const regionsFile = path.join(dir, 'regions.geojson');

  const files: ManifestFileEntry[] = [];
  const validation: ValidationReport[] = [];
  let rawPlaces = 0;
  let rawRegions = 0;

  if (await exists(placesFile)) {
    const fc = await readJson<PlacesFile>(placesFile);
    const report = validatePlaces(fc, 'darmc', path.relative(process.cwd(), placesFile));
    checkPlacesCustom(fc, report);
    computeBounds(fc, report);
    coverageHint(report);
    validation.push(report);
    const bytes = (await stat(placesFile)).size;
    files.push({
      path: path.relative(process.cwd(), placesFile),
      kind: 'places',
      features: fc.features.length,
      geometry_types: Object.keys(report.geometry_types),
      bytes,
    });
    rawPlaces = await countRaw(ALL_LAYERS.filter((l) => l.kind === 'places').map((l) => l.key));
    report.dropped = Math.max(0, rawPlaces - fc.features.length);
  }

  if (await exists(regionsFile)) {
    const fc = await readJson<RegionsFile>(regionsFile);
    const report = validateRegions(fc, 'darmc', path.relative(process.cwd(), regionsFile));
    checkRegionsCustom(fc, report);
    computeBounds(fc, report);
    coverageHint(report);
    validation.push(report);
    const bytes = (await stat(regionsFile)).size;
    files.push({
      path: path.relative(process.cwd(), regionsFile),
      kind: 'regions',
      features: fc.features.length,
      geometry_types: Object.keys(report.geometry_types),
      bytes,
    });
    rawRegions = await countRaw(ALL_LAYERS.filter((l) => l.kind === 'regions').map((l) => l.key));
    report.dropped = Math.max(0, rawRegions - fc.features.length);
  }

  // normalize 若在同进程运行过，用其逐层明细覆盖汇总口径（更精确）
  if (norm) {
    for (const r of validation) {
      if (r.file.endsWith('places.geojson')) {
        r.dropped = norm.places.reduce((acc, s) => acc + (s.raw - s.out), 0);
      } else if (r.file.endsWith('regions.geojson')) {
        r.dropped = norm.regions.reduce((acc, s) => acc + (s.raw - s.out), 0);
      }
    }
  }

  // retrieved_at：取 raw 文件的实际下载时间（mtime），查不到用当前时间
  let retrievedAt = new Date().toISOString();
  try {
    const mtimes = await Promise.all(
      ALL_LAYERS.map((l) => stat(path.join(rawDataDir('darmc'), `${l.key}.geojson`)).then((s) => s.mtimeMs).catch(() => 0)),
    );
    const valid = mtimes.filter((t) => t > 0);
    if (valid.length > 0) retrievedAt = new Date(Math.min(...valid)).toISOString();
  } catch {
    /* 保持默认 */
  }

  // 简化决策的量化记录（normalize 同进程运行时可得；否则用静态描述）
  const simplifyNote = norm
    ? `regions 多边形用 turf simplify（Douglas-Peucker）简化：provinces tolerance=0.001°（约 111m）、` +
      `kingdoms tolerance=0.002°（约 222m）；顶点 ${norm.regions
        .reduce((a, s) => a + (s.verticesBefore ?? 0), 0)
        .toLocaleString('en-US')} -> ${norm.regions
        .reduce((a, s) => a + (s.verticesAfter ?? 0), 0)
        .toLocaleString('en-US')}。` +
      '原边界为历史图集转绘近似线，容差低于其制图精度；相邻面独立简化可能产生细缝/重叠（显示用途可接受）。'
    : 'regions 多边形用 turf simplify 简化（provinces 0.001°/kingdoms 0.002°，详见 README 决策记录）。';

  const manifest: Manifest = {
    source: 'darmc',
    title: 'DARMC / Mapping Past Societies（哈佛，罗马与中世纪文明数字图谱）',
    url: 'https://darmc.harvard.edu/',
    download_urls: [
      DATA_AVAILABILITY_URL,
      SERVICE_INFO_URL,
      ...ALL_LAYERS.map((l) => layerQueryUrl(l)),
    ],
    license: LICENSE,
    license_url: LICENSE_URL,
    retrieved_at: retrievedAt,
    files,
    validation,
    temporal_coverage: {
      start_year: 117,
      end_year: 1450,
      note:
        '端点为所选快照图层的标称年份（行省 ca.117 – 主教区 ca.1450）。' +
        'cities / bishoprics600 两层的逐要素 TIMEPERIOD 编码（A/C/H/R/L 组合）' +
        '无官方解码文档，未换算为 start/end_year（契约要求不确定即 null）。',
    },
    coverage_note:
      'DARMC(MAPS) 对本项目的价值是点状聚落网络 + 罗马行省/中世纪王国的多边形快照，而非连续区域边界。' +
      '空间覆盖：cities/bishoprics 点层随 Barrington Atlas / Tabula Imperii Byzantini 覆盖整个罗马-拜占庭世界，' +
      '含地中海、北非、近东，并有 561 个点深入印度洋沿岸/中亚（如 Taxila、Palibothra，Barrington 原收），' +
      '超出欧洲参考范围但为真实源数据，未删（前端可按 bbox 过滤）；regions 面层为罗马行省（含北非/近东行省）' +
      '与中世纪王国（到大不列颠/罗斯/波兰为止）。东欧/北欧覆盖薄，无斯堪的纳维亚族群细节。' +
      '时间上是一组离散快照（117/303-324/500、814/1000/1200/1450），快照之间的过渡期需要其他数据源补足。' +
      '对"欧洲各族群分布地图"明显缺：族群语言/宗教归属属性（图层只有政教归属名，如 Frankish Empire），' +
      '以及 500-814 之间的政权边界断层。',
    decisions: [
      '数据通道：官网正式下载为 Google Drive 打包 geodatabase（老式链接，不适合脚本化复现）；' +
        '改用官网地图背后的 Harvard CGA ArcGIS Hosted Feature Services（匿名可查 GeoJSON，同一数据），' +
        '以 outSR=4326 + f=geojson 分页拉取，服务端即输出 WGS84，无需 proj4。',
      '点图层精选 3 个家族（10 个服务图层）：罗马城市与定居点 13,626；' +
        '中世纪 Major Towns 四期快照（814/1000/1200/1450）；主教区五期快照（600/900/1000/1200/1450）。' +
        '修道院各修会、伊斯兰城市、十字军城市等记入 README 可选扩展，未纳入。',
      '多边形图层精选 2 个家族（7 个服务图层）：罗马行省三期快照（117、303-324、500）与' +
        '中世纪王国四期快照（814/1000/1200/1450，含 Anglo-Saxon England、Frankish Empire 等族群政体名）。' +
        '全部为原始面数据，未做任何点缓冲伪造。',
      '时间语义：单年快照图层把年份写入 source_props.snapshot_year、start/end 置 null（契约对快照型数据的要求）；' +
        'Provinces ca. 303-324 是范围型快照，用 start_year=303/end_year=324 表达其文献断代。',
      'TIMEPERIOD（A/C/H/R/L）与 Founded/Bishopby 等模糊纪年字段不换算，置 null 并原样保留。',
      'place_code/region_code 用 `<layer>_<name-slug>_<OBJECTID>` 保证确定性唯一；' +
        'source_id 用原生 DARMCID（cities/bishoprics600 有），其余用 OBJECTID。',
      'place_type 词表：city/settlement/urban_area（cities 图层 CLASS 映射）、town（城镇快照）、bishopric（主教区快照）。',
      'region_type 对齐 SQL 字典：行省与王国均映射 political_entity；level/parent_code 置 null' +
        '（行省内 SUBDIVISIO/DIOCESE 层级未建树，见 open_issues）。',
      '空白串属性（" "）在派生字段中视为 null，source_props 保留原样；PROV_NAME 内嵌换行在 name_en 中折叠，source_props 保留原样。',
      simplifyNote,
    ],
    open_issues: [
      'TIMEPERIOD 编码（A/C/H/R/L 组合，cities 4,464 项为 null、其余组合若干）疑似 Barrington 传统分期' +
        '（Archaic/Classical/Hellenistic/Roman/Late），但未找到官方解码文档，未换算为整数年；' +
        '若后续找到官方文档可补 start/end_year，将显著提升时间轴可用性。',
      '"Bishoprics ca. 600" 层 2,359 点中 811 点 BISHOPRIC 字段为空白、TIMEPERIOD 分布横跨 R/L；' +
        '该层实为 TIB 全量主教座堂汇编按 ca.600 快照呈现，快照语义弱于 900/1000/1200/1450 各期，使用时需注意。',
      'cities 图层含 TYPE="Modern Settlement"（104 点）与 "Settlement traces"（100 点）、"D"（3 点，含义不明），' +
        '均保留为 place_type=settlement 并在 source_props.TYPE 保留原值。',
      '行省图层（尤其 303-324）的 DIOCESE/SUBDIVISIO 可建立 parent_code 层级（教区→行省），本阶段未做。',
      ' kingdoms1000 出现 "Belgium"/"United Kingdom" 等现代名（原数据如此，含拼写 Muslin[=Muslim]），原样保留。',
      '官方 Google Drive 的完整 geodatabase（含修道院、道路、经济数据等全部系列）未纳入本 loader；' +
        '若需要 lines.geojson（罗马道路），可从 Dataverse doi:10.7910/DVN/TI0KAU 或服务层获取，属可选扩展。',
      '契约缺口：PlaceFeatureProps 无 region/parent 概念，主教区点无法挂接 France Dioceses 面层级；' +
        '如需表达需要主会话裁决是否扩展契约。',
      '契约 bug（冻结无法修改，仅记录）：validatePlaces/validateRegions 的 checkCoords 把 geometry 对象' +
        '传给只递归数组的 walkPositions，坐标遍历从不触达，因此通用校验器产出的 bounds 恒为 null、' +
        '坐标越界检查实际不生效；本 loader 在自定义检查里补算了 bounds 与坐标检查。',
    ],
  };

  await writeJson(path.join(dir, 'manifest.json'), manifest);

  // 摘要输出
  for (const r of validation) {
    const errors = r.issues.filter((i) => i.level === 'error').length;
    const warns = r.issues.filter((i) => i.level === 'warn').length;
    console.log(
      `校验 ${r.file}: total=${r.total} passed=${r.passed} dropped=${r.dropped} errors=${errors} warns=${warns} bounds=${JSON.stringify(r.bounds)}`,
    );
    for (const issue of r.issues.slice(0, 20)) {
      console.log(`  [${issue.level}] ${issue.feature ? `${issue.feature}: ` : ''}${issue.message}`);
    }
    if (r.issues.length > 20) console.log(`  ...共 ${r.issues.length} 条 issue`);
  }
  console.log(`写出: ${path.join(dir, 'manifest.json')}`);

  return { manifest };
}
