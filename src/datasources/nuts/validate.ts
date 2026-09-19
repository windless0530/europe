// ============================================================
// NUTS loader · validate + manifest
// 1) 用契约通用校验器 validateRegions 检查 regions.geojson；
// 2) 追加自定义检查：
//    - parent_code 必须指向存在的 region_code，且父级 level = 子级 level-1
//    - NUTS 编码前缀规则（level n 的父级 = NUTS_ID 前 2n 字符）
//    - 层级树完整性：level>=1 的要素沿 parent 链必达 level 0
//    - source_props.origin 必须存在（nuts / gadm）
//    - 几何整体落在欧洲参考 bbox 的宽松外扩范围外 -> warn
// 3) 汇总 normalize_stats.json 的 fixed/dropped 写入 manifest.json
// ============================================================

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  type Manifest,
  type RegionsFile,
  type ValidationIssue,
  type ValidationReport,
  rawDataDir,
  processedDataDir,
  writeJson,
  validateRegions,
  regionCode,
  slugify,
  REPO_ROOT,
} from '../../lib/contract';
import {
  NUTS_LEVELS,
  NUTS_YEAR,
  GADM_VERSION,
  GADM_COUNTRIES,
  nutsUrl,
  gadmUrl,
  EUROPE_BBOX,
  LICENSE_NUTS,
  LICENSE_NUTS_URL,
  LICENSE_GADM,
  LICENSE_GADM_URL,
} from './config';
import type { NormalizeStats } from './normalize';

/** 契约 bbox 的宽松外扩，用于兜底告警（而非过滤） */
const WARN_BBOX: readonly [number, number, number, number] = [-45, 24, 70, 82];

function geometryBounds(geometry: unknown): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let saw = false;
  const root = (geometry as { coordinates?: unknown })?.coordinates ?? geometry;
  (function walk(node: unknown): void {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [lon, lat] = node as number[];
      if (lon < minX) minX = lon;
      if (lat < minY) minY = lat;
      if (lon > maxX) maxX = lon;
      if (lat > maxY) maxY = lat;
      saw = true;
      return;
    }
    for (const child of node) walk(child);
  })(root);
  return saw ? [minX, minY, maxX, maxY] : null;
}

function customChecks(fc: RegionsFile, report: ValidationReport): void {
  // ------------------------------------------------------------
  // 坐标检查 + bounds 补算：
  // 契约 validateRegions 的 checkCoords/walkPositions 只遍历数组，
  // 传入 Feature.geometry 对象时坐标检查与 bounds 实际不生效（契约冻结、
  // 不可修改），这里用自定义遍历补上，结果写回 report.bounds。
  // ------------------------------------------------------------
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let saw = false;
  const badCoords: string[] = [];
  for (const f of fc.features) {
    const root = (f.geometry as { coordinates?: unknown })?.coordinates;
    (function walk(node: unknown): void {
      if (!Array.isArray(node)) return;
      if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
        const [lon, lat] = node as number[];
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          if (badCoords.length < 10) badCoords.push(`${f.properties.region_code}: [${lon}, ${lat}]`);
          return;
        }
        saw = true;
        if (lon < minX) minX = lon;
        if (lat < minY) minY = lat;
        if (lon > maxX) maxX = lon;
        if (lat > maxY) maxY = lat;
        return;
      }
      for (const child of node) walk(child);
    })(root);
  }
  for (const msg of badCoords) {
    report.issues.push({ level: 'error', message: `坐标非法（越界/非数值）: ${msg}` });
  }
  if (saw) report.bounds = [minX, minY, maxX, maxY];

  const byCode = new Map<string, { level: number | null; parent: string | null; origin: unknown; nutsId: unknown; sourceId: string }>();
  for (const f of fc.features) {
    const p = f.properties;
    byCode.set(p.region_code, {
      level: p.level,
      parent: p.parent_code,
      origin: (p.source_props as Record<string, unknown>)?.origin,
      nutsId: (p.source_props as Record<string, unknown>)?.NUTS_ID,
      sourceId: p.source_id,
    });
  }

  for (const f of fc.features) {
    const p = f.properties;
    const label = p.region_code;

    // origin 标记
    if (p.source_props?.origin !== 'nuts' && p.source_props?.origin !== 'gadm') {
      report.issues.push({ level: 'warn', feature: label, message: `source_props.origin 缺失或非预期: ${String(p.source_props?.origin)}` });
    }

    // parent 引用与层级差
    if (p.parent_code === null) {
      if (p.level !== 0) {
        report.issues.push({ level: 'error', feature: label, message: `level=${p.level} 但 parent_code 为 null` });
      }
    } else {
      const parent = byCode.get(p.parent_code);
      if (!parent) {
        report.issues.push({ level: 'error', feature: label, message: `parent_code 指向不存在的要素: ${p.parent_code}` });
      } else if (parent.level === null || p.level === null || parent.level !== p.level - 1) {
        report.issues.push({ level: 'error', feature: label, message: `父级层级不连续: level=${p.level}, parent level=${parent.level}` });
      }
    }

    // NUTS 前缀规则：level n 的父级编码 = NUTS_ID 前 level+1 字符（NUTS_ID 共 level+2 字符）
    if (p.source_props?.origin === 'nuts' && p.level !== null && p.level > 0 && typeof p.source_props?.NUTS_ID === 'string') {
      const expected = regionCode('nuts', slugify(p.source_props.NUTS_ID.slice(0, p.level + 1)));
      if (p.parent_code !== expected) {
        report.issues.push({ level: 'error', feature: label, message: `NUTS 前缀规则不满足: 期望 parent=${expected}, 实际=${p.parent_code}` });
      }
    }

    // 层级树完整性：沿 parent 链必达 level 0
    if (p.level !== null && p.level > 0) {
      let cur: { level: number | null; parent: string | null } | undefined = byCode.get(p.region_code);
      let steps = 0;
      let reachedRoot = false;
      const seen = new Set<string>([p.region_code]);
      while (cur && steps <= 5) {
        steps++;
        if (cur.level === 0) { reachedRoot = true; break; }
        const nextCode = cur.parent;
        if (!nextCode || seen.has(nextCode)) break;
        seen.add(nextCode);
        cur = byCode.get(nextCode);
      }
      if (!reachedRoot) {
        report.issues.push({ level: 'error', feature: label, message: `层级树不完整: 从 level=${p.level} 沿 parent 链无法到达 level 0` });
      }
    }

    // 几何兜底告警
    const b = geometryBounds(f.geometry);
    if (b && (b[0] < WARN_BBOX[0] || b[1] < WARN_BBOX[1] || b[2] > WARN_BBOX[2] || b[3] > WARN_BBOX[3])) {
      report.issues.push({ level: 'info', feature: label, message: `几何范围超出欧洲参考 bbox 较多（俄罗斯亚洲部分等）: [${b.map((x) => x.toFixed(1)).join(', ')}]` });
    }
  }

  // 覆盖摘要（info）
  const countries = new Map<string, number>();
  for (const f of fc.features) {
    const sp = f.properties.source_props as Record<string, unknown>;
    const cc = typeof sp.CNTR_CODE === 'string' ? sp.CNTR_CODE : typeof sp.GID_0 === 'string' && sp.GID_0 !== 'NA' ? sp.GID_0 : null;
    if (cc) countries.set(cc, (countries.get(cc) ?? 0) + 1);
  }
  report.issues.push({
    level: 'info',
    message: `覆盖国家/地区数: ${countries.size}；层级分布见 manifest.decisions 与 normalize_stats.json`,
  });
}

function buildCoverageNote(stats: NormalizeStats | null, gadmCountries: string[]): string {
  const lines: string[] = [];
  lines.push(
    `NUTS 2024 覆盖 39 个国家/地区（EU27 + IS/NO/CH/LI + 候选国 TR/RS/ME/MK/AL/BA/XK + UA），层级 0-3；` +
      `其中 UA 仅 LEVL 0、BA 至 LEVL 2，其余均至 LEVL 3。`,
  );
  lines.push(
    `GADM 4.1 补齐：${gadmCountries.join('、')}（英国[脱欧]、摩尔多瓦、白俄罗斯、俄罗斯欧洲部分、安道尔、摩纳哥、圣马力诺、梵蒂冈、法罗群岛为 NUTS 缺口；乌克兰为 NUTS 仅国家级、补 admin1 州级）。` +
      `俄罗斯仅保留与欧洲参考 bbox 相交的 40 余个州/边疆区/共和国，叶尼塞以东的亚洲部分未纳入。`,
  );
  lines.push(
    `已按 bbox 过滤：法国海外大区（FRY* 瓜德罗普/马提尼克/法属圭亚那/留尼汪/马约特）与斯瓦尔巴（NO0B2，纬度 74-81N 超出参考范围 73N）。`,
  );
  lines.push(
    `对“欧洲各族群分布地图”仍明显缺失：高加索三国（格鲁吉亚/亚美尼亚/阿塞拜疆）、哈萨克斯坦乌拉尔以西部分、` +
      `北塞浦路斯（NUTS CY 不含）、直布罗陀等英属海外领地（GADM GBR_1 未单列）、马耳他骑士团等虚拟实体；` +
      `微型国家中摩纳哥/梵蒂冈/圣马力诺仅有国家级要素（GADM admin1 不可用或为空）。`,
  );
  if (stats) {
    lines.push(
      `normalize 丢弃明细：NUTS bbox 外 ${stats.nuts.dropped_outside_europe.length}、GADM 脱敏 ${stats.gadm.dropped_masked.length}、` +
        `无属性 ${stats.gadm.dropped_no_attrs.length}、GADM bbox 外 ${stats.gadm.dropped_outside_europe.length}。`,
    );
  }
  return lines.join('\n');
}

export async function runValidate(): Promise<ValidationReport> {
  const outDir = processedDataDir('nuts');
  const regionsPath = path.join(outDir, 'regions.geojson');
  if (!existsSync(regionsPath)) throw new Error(`产物缺失：${regionsPath}（先运行 normalize）`);

  const fc: RegionsFile = JSON.parse(readFileSync(regionsPath, 'utf8'));

  // 通用校验器
  const report = validateRegions(fc, 'nuts', path.relative(REPO_ROOT, regionsPath));
  // 自定义检查
  customChecks(fc, report);

  // normalize 统计（fixed / dropped）
  const statsPath = path.join(outDir, 'normalize_stats.json');
  const stats: NormalizeStats | null = existsSync(statsPath) ? JSON.parse(readFileSync(statsPath, 'utf8')) : null;
  if (stats) {
    report.fixed = stats.gadm.names_fixed.length;
    report.dropped =
      stats.nuts.dropped_outside_europe.length +
      stats.gadm.dropped_masked.length +
      stats.gadm.dropped_no_attrs.length +
      stats.gadm.dropped_outside_europe.length +
      stats.dropped_geometry_bad.length;
  }

  // ---------------- manifest ----------------
  const metaPath = path.join(rawDataDir('nuts'), '_meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
  const retrievedAt =
    meta?.downloads?.filter((d: { retrieved_at: string }) => d.retrieved_at).map((d: { retrieved_at: string }) => d.retrieved_at).sort().pop() ??
    new Date().toISOString();

  const downloadUrls: string[] = [];
  for (const level of NUTS_LEVELS) downloadUrls.push(nutsUrl(level));
  for (const spec of GADM_COUNTRIES) for (const l of spec.levels) downloadUrls.push(gadmUrl(spec.iso3, l));

  const gadmCountryNames = GADM_COUNTRIES.map((s) => `${s.iso3}${s.parentOverride ? '（补 UA admin1）' : ''}`);

  const manifest: Manifest = {
    source: 'nuts',
    title: `NUTS ${NUTS_YEAR}（Eurostat GISCO）+ GADM ${GADM_VERSION} 补齐 —— 现代次国家边界`,
    url: 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/',
    download_urls: downloadUrls,
    license: `${LICENSE_NUTS}；补齐数据 ${LICENSE_GADM}`,
    license_url: LICENSE_NUTS_URL,
    retrieved_at: retrievedAt,
    files: [
      {
        path: path.relative(REPO_ROOT, regionsPath),
        kind: 'regions',
        features: fc.features.length,
        geometry_types: Object.keys(report.geometry_types),
        bytes: (await stat(regionsPath)).size,
      },
      ...(existsSync(statsPath)
        ? [
            {
              path: path.relative(REPO_ROOT, statsPath),
              kind: 'other' as const,
              features: 0,
              geometry_types: [],
              bytes: (await stat(statsPath)).size,
            },
          ]
        : []),
    ],
    validation: [report],
    temporal_coverage: {
      start_year: null,
      end_year: null,
      note: `版本型数据：NUTS ${NUTS_YEAR}（vintage 在各要素 source_props.vintage=${NUTS_YEAR}），GADM ${GADM_VERSION} 为当前快照（无官方年代标注）；start/end_year 一律 null`,
    },
    coverage_note: buildCoverageNote(stats, gadmCountryNames),
    decisions: [
      `采用 NUTS 2024（最新版），20M 精度、EPSG:4326、LEVL 0-3 全取：原始共约 3MB，远低于 30MB 预算，LEVL 3 也纳入`,
      `NUTS 2024 已含 UA/XK/BA（2021 版没有）；英国自 NUTS 2021 起因脱欧移除 -> GADM GBR 补 4 个构成国 + 国界`,
      `name_en 取 NAME_LATN（拉丁转写/国语名，如 "Crna Gora"/"İstanbul"），不是英文译名；NAME_ENGL 字段在子层级是国名而非区域名，故不采用`,
      `region_type=null：建议 SQL region_type 字典增加 modern_subdivision（见 README open_issues）`,
      `欧洲参考 bbox [-31,27,45,73] 外无顶点的要素丢弃：FRY*（法国海外大区 5 组）、NO0B2 斯瓦尔巴、俄罗斯亚洲部分约 40 个州`,
      `GADM JSON 导出剥掉了名称中的空格（"NorthernIreland"），做保守机械恢复（小写->大写边界与句点后补空格），原始值保留在 source_props；GBR.1_1 NAME_1 缺失按几何/类型判定为 England（NAME_OVERRIDES 表）`,
      `GADM 4.1 乌克兰有 1 个脱敏要素（GID/NAME="?"）与 1 个 GBR 全 NA 要素，直接丢弃并计数`,
      `乌克兰层级结构：NUTS UA LEVL 0 为国家级（region_code=nuts:ua），GADM UKR admin1（27 州，含克里米亚与塞瓦斯托波尔，GADM 口径）挂在其下`,
      `GADM 几何保持原始精度未做 turf 简化：产物共约 ${stats ? (stats.regions_geojson_bytes / 1048576).toFixed(1) : '?'} MB，在 30MB 预算内`,
      `GADM license 单独记录：${LICENSE_GADM}（${LICENSE_GADM_URL}）——本产物为个人非商业项目使用，若公开分发需重新评估`,
    ],
    open_issues: [
      `契约缺口：src/lib/contract.ts 的 walkPositions 只遍历数组，validateRegions 传入 Feature.geometry 对象时坐标检查与 bounds 统计实际不生效；本 loader 在自定义检查中补做了坐标校验并回填 report.bounds，建议主会话统一修复契约（三个 loader 同步适配）`,
      `GADM license 禁止再分发：regions.geojson 已包含 GADM 派生几何，网站若公开上线需移除 GADM 要素或取得授权`,
      `乌克兰 NUTS 2024 只有 LEVL 0，未来版本若出 UA LEVL 1-3 应替换 GADM 补齐层`,
      `建议 SQL region_type 字典增加 modern_subdivision；NUTS 层级（level 0-3）与 GADM admin1（level 1）混用时前端需按 source_props.origin 区分`,
      `GADM 名称空格恢复为启发式，个别名称（如 "Cityof St.Petersburg"）仍不自然，可考虑后续人工校订`,
      `摩纳哥/梵蒂冈/圣马力诺无 admin1（GADM 更细层级为 level2+），目前只有国家级要素`,
      `北塞浦路斯、直布罗陀等争议/海外领地未覆盖`,
    ],
  };

  const manifestPath = path.join(outDir, 'manifest.json');
  await writeJson(manifestPath, manifest);

  // ---------------- 摘要输出 ----------------
  const errors = report.issues.filter((i: ValidationIssue) => i.level === 'error');
  const warns = report.issues.filter((i: ValidationIssue) => i.level === 'warn');
  console.log(`validate: ${report.file}`);
  console.log(`  要素 ${report.total}，通过 ${report.passed}，fixed ${report.fixed}，dropped ${report.dropped}`);
  console.log(`  几何类型 ${JSON.stringify(report.geometry_types)}，bounds ${JSON.stringify(report.bounds)}`);
  console.log(`  issues: error ${errors.length}, warn ${warns.length}, info ${report.issues.length - errors.length - warns.length}`);
  for (const i of errors.slice(0, 20)) console.log(`    [error] ${i.feature ?? ''} ${i.message}`);
  for (const i of warns.slice(0, 20)) console.log(`    [warn] ${i.feature ?? ''} ${i.message}`);
  console.log(`  manifest -> ${path.relative(REPO_ROOT, manifestPath)}`);

  if (errors.length > 0 || report.passed !== report.total) process.exitCode = 1;
  return report;
}
