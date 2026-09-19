// ============================================================
// 数据源 registry：三个数据源的统一注册与加载入口。
//
// 前端导出阶段通过 loadSource(activeSource()) 获取数据，
// 切换数据源 = 修改 atlas.config.json 的 source 字段
// （CLI：npm run data -- use nuts|awmc|darmc），无需改代码。
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest, PlacesFile, RegionsFile, SourceCode } from '../lib/contract.js';
import { REPO_ROOT, SOURCES } from '../lib/contract.js';

export type ArtifactKind = 'regions' | 'places' | 'lines';

export interface SourceRegistryEntry {
  code: SourceCode;
  /** 展示名 */
  title: string;
  /** 一句话定位 */
  description: string;
  /** 重新生成数据的命令 */
  cli: string;
  /** license 摘要（正式记录见各源 manifest.json） */
  license: string;
  /** 时间定位 */
  temporal: string;
  /** 该源理论上可产出的产物 */
  provides: ArtifactKind[];
}

export const REGISTRY: Record<SourceCode, SourceRegistryEntry> = {
  awmc: {
    code: 'awmc',
    title: 'AWMC（Ancient World Mapping Center）',
    description: '古代世界：罗马帝国 6 个快照范围、Strabo 记载的 109 个族群领地多边形、城市点与行省边界线',
    cli: 'npm run awmc',
    license: 'ODC ODbL v1.0（share-alike，注明出处）',
    temporal: '快照：-60 / 14 / 69 / 117 / 200 / 314 CE；ethnonyms 约 7 BCE–23 CE（Strabo 成书期）',
    provides: ['regions', 'places', 'lines'],
  },
  darmc: {
    code: 'darmc',
    title: 'DARMC / Mapping Past Societies（哈佛）',
    description: '罗马-中世纪：行省（117/303-324/500）与王国（814/1000/1200/1450）多边形快照 + 城市定居点/主教区点网络',
    cli: 'npm run darmc',
    license: 'CC BY-NC-SA 4.0（非商业 + 相同方式共享 + 署名）',
    temporal: '快照：117 / 303-324 / 500 / 814 / 1000 / 1200 / 1450；cities 层 TIMEPERIOD 未换算',
    provides: ['regions', 'places'],
  },
  nuts: {
    code: 'nuts',
    title: 'NUTS 2024（Eurostat GISCO）+ GADM 4.1 补齐',
    description: '现代次国家边界（L0-L3），时间轴现代端的固定网格与对照底图',
    cli: 'npm run nuts',
    license: 'NUTS：EU 再利用政策（注明出处可自由复用）；GADM：非商业免费、禁止再分发（公开上线需处理）',
    temporal: 'vintage 2024（现代，start/end 全 null）',
    provides: ['regions'],
  },
};

// ------------------------------------------------------------
// 当前数据源配置：atlas.config.json（仓库根，提交）
// ------------------------------------------------------------

const CONFIG_FILE = path.join(REPO_ROOT, 'atlas.config.json');

export interface AtlasConfig {
  source: SourceCode;
}

export function readConfig(): AtlasConfig {
  if (!existsSync(CONFIG_FILE)) return { source: 'nuts' };
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as AtlasConfig;
}

export function activeSource(): SourceCode {
  return readConfig().source;
}

export function useSource(source: SourceCode): void {
  if (!SOURCES.includes(source)) {
    throw new Error(`未知数据源: ${source}（可选：${SOURCES.join(' | ')}）`);
  }
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ source }, null, 2)}\n`, 'utf8');
}

// ------------------------------------------------------------
// 产物加载
// ------------------------------------------------------------

export interface LoadedSource {
  entry: SourceRegistryEntry;
  manifest: Manifest | null;
  regions: RegionsFile | null;
  places: PlacesFile | null;
  /** 线要素（契约未定义类型，仅 awmc 产出；结构为普通 GeoJSON FeatureCollection） */
  lines: { type: 'FeatureCollection'; features: unknown[] } | null;
  missing: string[];
}

function readJsonIfExists<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

function processedPath(source: SourceCode, kind: ArtifactKind): string {
  const name = kind === 'regions' ? 'regions.geojson' : kind === 'places' ? 'places.geojson' : 'lines.geojson';
  return path.join(REPO_ROOT, 'data', 'processed', source, name);
}

/**
 * 加载数据源的规范化产物。
 * 未生成的产物返回 null 并计入 missing（提示用 <cli> 生成）；
 * 全部缺失时抛错（该源尚未跑过 pipeline）。
 */
export function loadSource(source: SourceCode): LoadedSource {
  const entry = REGISTRY[source];
  const dir = path.join(REPO_ROOT, 'data', 'processed', source);
  const manifest = readJsonIfExists<Manifest>(path.join(dir, 'manifest.json'));
  const regions = readJsonIfExists<RegionsFile>(processedPath(source, 'regions'));
  const places = readJsonIfExists<PlacesFile>(processedPath(source, 'places'));
  const lines = readJsonIfExists<{ type: 'FeatureCollection'; features: unknown[] }>(processedPath(source, 'lines'));

  const missing: string[] = [];
  for (const kind of entry.provides) {
    const file = processedPath(source, kind);
    if (!existsSync(file)) missing.push(path.relative(REPO_ROOT, file));
  }
  if (!manifest) missing.push(path.relative(REPO_ROOT, path.join(dir, 'manifest.json')));
  if (missing.length === entry.provides.length + 1) {
    throw new Error(`数据源 ${source} 尚未生成任何产物，先运行：${entry.cli}`);
  }

  return { entry, manifest, regions, places, lines, missing };
}

export function listSources(): SourceRegistryEntry[] {
  return SOURCES.map((s) => REGISTRY[s]);
}
