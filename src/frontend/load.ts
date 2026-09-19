// 数据加载与视图模型：把三个源的规范化产物统一成
// { features, eras, families }，供地图/图例/时间轴消费。
//
// 家族（family）推导规则：
//   awmc  ethnonyms 数据集              -> people（蓝，常显，Strabo 时代）
//         roman_empire_* 带快照年        -> empire（橙，随时间轴切换）
//         其余（波斯/亚历山大/意大利等）  -> undated（中性灰，默认隐藏可勾选）
//   darmc prov* / kingdoms*             -> provinces（蓝）/ kingdoms（橙），快照+持续
//   nuts  全部                          -> nuts（按层级取序数蓝带）

import type { RegionFeature, RegionsFile, SourceCode } from '../lib/contract.js';

export type Family = 'people' | 'empire' | 'undated' | 'provinces' | 'kingdoms' | 'nuts';

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
}

export interface SourceView {
  code: SourceCode;
  title: string;
  features: RegionVm[];
  /** 全部快照年（升序）；无时间维度的源为 [2024] */
  eras: number[];
  /** 各家族的快照年集合（用于"最近一次快照持续显示"） */
  familySnapshots: Map<Family, number[]>;
}

function prop(vm: RegionFeature, key: string): unknown {
  return (vm.properties.source_props as Record<string, unknown> | null)?.[key];
}

function deriveFamily(code: SourceCode, f: RegionFeature): Family {
  const sp = f.properties.source_props as Record<string, unknown>;
  if (code === 'awmc') {
    const ds = String(sp?.awmc_dataset ?? '');
    if (ds === 'ethnonyms') return 'people';
    if (ds.startsWith('roman_empire')) return 'empire';
    return 'undated';
  }
  if (code === 'darmc') {
    const layer = String(sp?.layer ?? '');
    if (layer.startsWith('prov')) return 'provinces';
    if (layer.startsWith('kingdoms')) return 'kingdoms';
    return 'undated';
  }
  return 'nuts';
}

function snapshotOf(f: RegionFeature): number | null {
  const sp = f.properties.source_props as Record<string, unknown> | undefined;
  const snap = sp?.snapshot_year;
  if (typeof snap === 'number') return snap;
  if (typeof f.properties.start_year === 'number') return f.properties.start_year;
  return null;
}

export function buildView(code: SourceCode, file: RegionsFile): SourceView {
  const features: RegionVm[] = file.features.map((f) => ({
    source: code,
    code: f.properties.region_code,
    nameEn: f.properties.name_en,
    nameZh: f.properties.name_zh,
    family: deriveFamily(code, f),
    level: typeof f.properties.level === 'number' ? f.properties.level : null,
    snapshot: snapshotOf(f),
    regionType: f.properties.region_type,
    sourceId: f.properties.source_id,
    dataset: String(prop(f, 'awmc_dataset') ?? prop(f, 'layer') ?? prop(f, 'layer_title') ?? code),
    feature: f,
  }));

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

  const eras = eraSet.size > 0 ? [...eraSet].sort((a, b) => a - b) : [2024];

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
    case 'people':
      return true; // Strabo 时代领地，无逐要素年份，常显
    case 'empire':
    case 'kingdoms': {
      const active = familyActiveSnapshot(view.familySnapshots.get(vm.family) ?? [], era);
      return active !== null && vm.snapshot === active;
    }
    case 'provinces': {
      // 行省系列只持续到王国系列出现为止（814 起行政框架被王国层取代），
      // 避免晚期时间点上残留拜占庭行省底色
      const kingdomsActive = familyActiveSnapshot(view.familySnapshots.get('kingdoms') ?? [], era);
      if (kingdomsActive !== null) return false;
      const active = familyActiveSnapshot(view.familySnapshots.get('provinces') ?? [], era);
      return active !== null && vm.snapshot === active;
    }
    case 'undated':
      return opts.showUndated;
    case 'nuts':
      return vm.level === opts.nutsLevel;
    default:
      return false;
  }
}

const cache = new Map<SourceCode, SourceView>();

export async function loadSource(code: SourceCode): Promise<SourceView> {
  const hit = cache.get(code);
  if (hit) return hit;
  const res = await fetch(`/data/processed/${code}/regions.geojson`);
  if (!res.ok) throw new Error(`加载 ${code} 数据失败：HTTP ${res.status}`);
  const file = (await res.json()) as RegionsFile;
  const view = buildView(code, file);
  cache.set(code, view);
  return view;
}

// ------------------------------------------------------------
// 启动全量预取（带字节进度）：atlas.json + 三源几何，
// 完成后所有交互零网络请求
// ------------------------------------------------------------

export interface PrefetchStep {
  label: string;
  loaded: number;
  total: number;
  done: boolean;
}

async function fetchJsonWithProgress(url: string, onBytes?: (loaded: number, total: number) => void): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 加载失败：HTTP ${res.status}`);
  if (!res.body || !onBytes) return res.json();
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onBytes(loaded, total);
    }
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged));
}

const LABELS: Record<SourceCode, string> = { awmc: 'AWMC', darmc: 'DARMC', nuts: 'NUTS' };

/** 顺序预取三源几何到缓存，逐步回报进度 */
export async function prefetchAllSources(onStep?: (step: PrefetchStep) => void): Promise<Map<SourceCode, SourceView>> {
  const views = new Map<SourceCode, SourceView>();
  for (const code of ['awmc', 'darmc', 'nuts'] as SourceCode[]) {
    const label = `${LABELS[code]} regions.geojson`;
    onStep?.({ label, loaded: 0, total: 0, done: false });
    let lastLoaded = 0;
    let lastTotal = 0;
    const file = (await fetchJsonWithProgress(`/data/processed/${code}/regions.geojson`, (loaded, total) => {
      lastLoaded = loaded;
      lastTotal = total;
      onStep?.({ label, loaded, total, done: false });
    })) as RegionsFile;
    const view = buildView(code, file);
    cache.set(code, view);
    views.set(code, view);
    onStep?.({ label, loaded: lastLoaded, total: lastTotal || lastLoaded, done: true });
  }
  return views;
}

export async function loadConfigSource(): Promise<SourceCode> {
  try {
    const res = await fetch('/config');
    if (!res.ok) return 'nuts';
    const cfg = (await res.json()) as { source?: SourceCode };
    return cfg.source ?? 'nuts';
  } catch {
    return 'nuts';
  }
}
