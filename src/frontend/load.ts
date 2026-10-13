// 数据加载与视图模型：把三个源的规范化产物统一成
// { features, eras, families }，供地图/图例/时间轴消费。
//
// 家族（family）推导规则：
//   awmc  ethnonyms 数据集              -> people（蓝，常显，Strabo 时代）
//         roman_empire_* 带快照年        -> empire（橙，随时间轴切换）
//         其余（波斯/亚历山大/意大利等）  -> undated（中性灰，默认隐藏可勾选）
//   darmc prov* / kingdoms*             -> provinces（蓝）/ kingdoms（橙），快照+持续
//   nuts  全部                          -> nuts（按层级取序数蓝带）

import type { RegionFeature, RegionsFile } from '../lib/contract.js';
import {
  AWMC_DATASET,
  DARMC_LAYER_PREFIX,
  DEFAULT_SOURCE,
  MODERN_ERA_YEAR,
  processedRegionsRel,
  SOURCE,
  SOURCE_PROPS,
} from '../lib/shared.js';
import type { SourceCode } from '../lib/shared.js';

/** 渲染家族全集（推导规则见头注）；键序 = 图例分段序 */
export const FAMILY = {
  people: 'people',
  empire: 'empire',
  provinces: 'provinces',
  kingdoms: 'kingdoms',
  undated: 'undated',
  nuts: 'nuts',
} as const;
export type Family = keyof typeof FAMILY;
export const FAMILIES: readonly Family[] = Object.keys(FAMILY) as Family[];

export interface RegionVm {
  source: SourceCode;
  code: string;
  nameEn: string | null;
  nameZh: string | null;
  family: Family;
  level: number | null;
  /** 快照年（source_props.snapshot_year ?? start_year），无则 null */
  snapshot: number | null;
  regionType: string | null;
  sourceId: string;
  /** 展示用的数据集/图层名 */
  dataset: string;
  feature: RegionFeature;
  /** 族群分布模式下由同区几何溶解而成的要素：成员原始 source_id（规则按成员匹配） */
  memberIds?: string[];
}

export interface SourceView {
  code: SourceCode;
  title: string;
  features: RegionVm[];
  /** 全部快照年（升序）；无时间维度的源为 [MODERN_ERA_YEAR]（2024） */
  eras: number[];
  /** 各家族的快照年集合（用于"最近一次快照持续显示"） */
  familySnapshots: Map<Family, number[]>;
}

function prop(vm: RegionFeature, key: string): unknown {
  return (vm.properties.source_props as Record<string, unknown> | null)?.[key];
}

function deriveFamily(code: SourceCode, f: RegionFeature): Family {
  const sp = f.properties.source_props as Record<string, unknown>;
  if (code === SOURCE.awmc) {
    const ds = String(sp?.[SOURCE_PROPS.awmcDataset] ?? '');
    if (ds === AWMC_DATASET.ethnonyms) return FAMILY.people;
    if (ds.startsWith(AWMC_DATASET.romanEmpirePrefix)) return FAMILY.empire;
    return FAMILY.undated;
  }
  if (code === SOURCE.darmc) {
    const layer = String(sp?.[SOURCE_PROPS.layer] ?? '');
    if (layer.startsWith(DARMC_LAYER_PREFIX.provinces)) return FAMILY.provinces;
    if (layer.startsWith(DARMC_LAYER_PREFIX.kingdoms)) return FAMILY.kingdoms;
    return FAMILY.undated;
  }
  return FAMILY.nuts;
}

function snapshotOf(f: RegionFeature): number | null {
  const sp = f.properties.source_props as Record<string, unknown> | undefined;
  const snap = sp?.snapshot_year;
  if (typeof snap === 'number') return snap;
  if (typeof f.properties.start_year === 'number') return f.properties.start_year;
  return null;
}

function toVm(code: SourceCode, f: RegionFeature): RegionVm {
  return {
    source: code,
    code: f.properties.region_code,
    nameEn: f.properties.name_en,
    nameZh: f.properties.name_zh,
    family: deriveFamily(code, f),
    level: typeof f.properties.level === 'number' ? f.properties.level : null,
    snapshot: snapshotOf(f),
    regionType: f.properties.region_type,
    sourceId: f.properties.source_id,
    dataset: String(prop(f, SOURCE_PROPS.awmcDataset) ?? prop(f, SOURCE_PROPS.layer) ?? prop(f, SOURCE_PROPS.layerTitle) ?? code),
    feature: f,
    memberIds: f.properties.members,
  };
}

export function buildView(code: SourceCode, file: RegionsFile): SourceView {
  const features: RegionVm[] = file.features.map((f) => toVm(code, f));

  const familySnapshots = new Map<Family, number[]>();
  const eraSet = new Set<number>();
  for (const vm of features) {
    if (vm.snapshot !== null) {
      eraSet.add(vm.snapshot);
      const list = familySnapshots.get(vm.family) ?? [];
      list.push(vm.snapshot);
      familySnapshots.set(vm.family, list);
    }
  }
  for (const [k, v] of familySnapshots) familySnapshots.set(k, [...new Set(v)].sort((a, b) => a - b));

  const eras = eraSet.size > 0 ? [...eraSet].sort((a, b) => a - b) : [MODERN_ERA_YEAR];

  const titles: Record<SourceCode, string> = {
    awmc: 'AWMC — Ancient World Mapping Center',
    darmc: 'DARMC / Mapping Past Societies (Harvard)',
    nuts: 'NUTS 2024 + GADM 4.1',
  };

  return { code, title: titles[code], features, eras, familySnapshots };
}

/** 家族在 era 年应显示的快照年（该家族 ≤ era 的最近一次快照；无则不显示） */
export function familyActiveSnapshot(snapshots: number[], era: number): number | null {
  let best: number | null = null;
  for (const s of snapshots) if (s <= era && (best === null || s > best)) best = s;
  return best;
}

/** 某要素在给定状态下是否可见 */
export function isVisible(vm: RegionVm, view: SourceView, era: number, opts: { nutsLevel: number; showUndated: boolean }): boolean {
  switch (vm.family) {
    case FAMILY.people:
      return true; // Strabo 时代领地，无逐要素年份，常显
    case FAMILY.empire:
    case FAMILY.kingdoms: {
      const active = familyActiveSnapshot(view.familySnapshots.get(vm.family) ?? [], era);
      return active !== null && vm.snapshot === active;
    }
    case FAMILY.provinces: {
      // 行省系列只持续到王国系列出现为止（814 起行政框架被王国层取代），
      // 避免晚期时间点上残留拜占庭行省底色
      const kingdomsActive = familyActiveSnapshot(view.familySnapshots.get(FAMILY.kingdoms) ?? [], era);
      if (kingdomsActive !== null) return false;
      const active = familyActiveSnapshot(view.familySnapshots.get(FAMILY.provinces) ?? [], era);
      return active !== null && vm.snapshot === active;
    }
    case FAMILY.undated:
      return opts.showUndated;
    case FAMILY.nuts:
      return vm.level === opts.nutsLevel;
    default:
      return false;
  }
}

// ------------------------------------------------------------
// 按模式分段加载（带字节进度），载入后全部内存运算：
//   启动：atlas.json + atlas-geometry.geojson（族群分布模式所需的全部数据）
//   几何浏览：首次进入 / 首次切到某数据源时加载该源 regions.geojson，缓存后不再请求
// ------------------------------------------------------------

/** 站点基路径（vite base，形如 '/europe/'，尾含斜杠）：所有运行期数据请求挂在 base 下，子路径部署与本机直访同构。
 *  tsx 直跑的脚本（coverage-audit / paint-sim）也 import 本模块，那里没有 vite 注入的 import.meta.env，回退 '/' */
const BASE = import.meta.env?.BASE_URL ?? '/';

export const ATLAS_URL = `${BASE}data/peoples/export/atlas.json`;
export const ATLAS_GEOMETRY_URL = `${BASE}data/peoples/export/atlas-geometry.geojson`;
export const SOURCE_LABELS: Record<SourceCode, string> = { awmc: 'AWMC', darmc: 'DARMC', nuts: 'NUTS' };

/** 并发拉取多个 JSON，按合计字节回报进度。total = 各响应 content-length 之和；任一缺失则为 0（进度未知） */
export async function fetchJsonBatch(urls: string[], onBytes?: (loaded: number, total: number) => void): Promise<unknown[]> {
  const responses = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} 加载失败：HTTP ${res.status}`);
      return res;
    }),
  );
  const lengths = responses.map((r) => Number(r.headers.get('content-length')) || 0);
  const total = lengths.every((n) => n > 0) ? lengths.reduce((a, b) => a + b, 0) : 0;
  let loaded = 0;
  return Promise.all(
    responses.map(async (res) => {
      if (!res.body || !onBytes) return res.json();
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          size += value.byteLength;
          loaded += value.byteLength;
          onBytes(loaded, total);
        }
      }
      const merged = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(merged));
    }),
  );
}

/** 族群分布几何子集（多源混合、构建期已溶解）直接建绘制 VM：
 *  文件序 = 构建期确定的绘制顺序，启动加载后零几何运算。不进几何浏览缓存。 */
export function atlasGeometryVms(file: RegionsFile): RegionVm[] {
  return file.features.map((f) => toVm(f.properties.source, f));
}

const cache = new Map<SourceCode, SourceView>();
const pending = new Map<SourceCode, Promise<SourceView>>();

/** 几何浏览数据源（全量 regions.geojson）：首次加载带进度，之后命中缓存；同源并发请求只发一次 */
export function loadSource(code: SourceCode, onBytes?: (loaded: number, total: number) => void): Promise<SourceView> {
  const hit = cache.get(code);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(code);
  if (inflight) return inflight;
  const p = fetchJsonBatch([`${BASE}${processedRegionsRel(code)}`], onBytes)
    .then(([file]) => {
      const view = buildView(code, file as RegionsFile);
      cache.set(code, view);
      return view;
    })
    .finally(() => pending.delete(code));
  pending.set(code, p);
  return p;
}

export async function loadConfigSource(): Promise<SourceCode> {
  try {
    const res = await fetch(`${BASE}config`);
    if (!res.ok) return DEFAULT_SOURCE;
    const cfg = (await res.json()) as { source?: SourceCode };
    return cfg.source ?? DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}
