// ============================================================
// download：从 Harvard CGA 的 DARMC ArcGIS Hosted Feature Services
// 分页拉取所选图层的 GeoJSON，原样落盘到 data/raw/darmc/<key>.geojson
//
// - 幂等：文件已存在则跳过（--force 强制重下）
// - 分页：resultOffset + orderByFields=<OID>；页大小取服务自身的
//   maxRecordCount（先查 FeatureServer?f=json），避免服务端截断导致
//   提前停止（exceededTransferLimit 在 f=geojson 下不可靠，实测恒为 false）
// - 坐标：请求 outSR=4326，f=geojson 输出即 WGS84 经纬度
// ============================================================

import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_LAYERS, SERVICE_ROOT, layerQueryUrl, type LayerSpec } from './catalog';
import { rawDataDir } from '../../lib/contract';

interface RawFeature {
  type: 'Feature';
  id?: number | string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

interface RawFC {
  type: 'FeatureCollection';
  crs?: unknown;
  features: RawFeature[];
  exceededTransferLimit?: boolean;
}

const USER_AGENT = 'europe-atlas-darmc-loader/1.0 (personal research project)';

async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      const json = JSON.parse(text) as unknown;
      // ArcGIS 出错时返回 200 + {"error": {...}}
      if (json && typeof json === 'object' && 'error' in json) {
        throw new Error(`ArcGIS error: ${JSON.stringify((json as { error: unknown }).error).slice(0, 300)}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetch 失败（${attempts} 次）: ${url}\n${String(lastErr)}`);
}

/** 每个服务只查一次 maxRecordCount */
const maxRecordCountCache = new Map<string, number>();

async function getMaxRecordCount(service: string): Promise<number> {
  const cached = maxRecordCountCache.get(service);
  if (cached !== undefined) return cached;
  const info = (await fetchJson(`${SERVICE_ROOT}/${service}/FeatureServer?f=json`)) as {
    maxRecordCount?: number;
  };
  const n = typeof info.maxRecordCount === 'number' && info.maxRecordCount > 0 ? info.maxRecordCount : 1000;
  maxRecordCountCache.set(service, n);
  return n;
}

async function fetchCount(layer: LayerSpec): Promise<number> {
  const url =
    `${layerQueryUrl(layer)}?where=1%3D1&returnCountOnly=true&f=json`;
  const res = (await fetchJson(url)) as { count?: number };
  return res.count ?? -1;
}

async function downloadLayer(layer: LayerSpec, dir: string, force: boolean): Promise<void> {
  const file = path.join(dir, `${layer.key}.geojson`);
  let exists = true;
  try {
    await access(file);
  } catch {
    exists = false;
  }
  if (exists && !force) {
    console.log(`  [skip] ${layer.key} 已存在: ${file}`);
    return;
  }

  const pageSize = await getMaxRecordCount(layer.service);
  const expected = await fetchCount(layer);
  const features: RawFeature[] = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
      orderByFields: layer.oidField,
    });
    const page = (await fetchJson(`${layerQueryUrl(layer)}?${params.toString()}`)) as RawFC;
    if (!Array.isArray(page.features)) throw new Error(`${layer.key}: 返回无 features 数组`);
    features.push(...page.features);
    if (page.features.length < pageSize) break; // 最后一页
    offset += page.features.length;
    if (offset > 200_000) throw new Error(`${layer.key}: 分页超过 200000，疑似死循环`);
  }

  const fc: RawFC = { type: 'FeatureCollection', features };
  await writeFile(file, JSON.stringify(fc), 'utf8');
  const warn =
    expected >= 0 && expected !== features.length
      ? `（警告：returnCountOnly=${expected} 与实际 ${features.length} 不一致）`
      : '';
  console.log(`  [ok] ${layer.key}: ${features.length} 要素 -> ${path.relative(process.cwd(), file)} ${warn}`);
}

export async function download(force = false): Promise<void> {
  const dir = rawDataDir('darmc');
  await mkdir(dir, { recursive: true });
  console.log(`下载 DARMC 图层（${ALL_LAYERS.length} 个服务图层）到 ${dir}`);
  for (const layer of ALL_LAYERS) {
    await downloadLayer(layer, dir, force);
  }
}
