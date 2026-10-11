// ============================================================
// 族群分布几何子集：data/geography/processed/<src>/regions.geojson（三源全量）
//   -> data/peoples/export/atlas-geometry.geojson
//
// 前端启动只加载 atlas.json + 本子集（约为三源全量的 1/4），几何浏览所需的
// 全量三源在进入该模式时按需加载。子集 = atlasGeometrySelection（与前端同一套
// 逐要素挑选规则：region_geometry 规则 + atlas.ts 渲染策略 SUBNATIONAL_LEVEL /
// GBR_CONSTITUENTS / OVERLAY_UNITS）选中的原始要素，要素内容与源文件逐字相同、
// 顺序保持「源 awmc → darmc → nuts，源内文件序」，故前端对子集求值与对全量求值结果一致。
//
// 生成：npm run project（与 atlas.json 一起写出）。过期校验：npm run audit
// （几何管线重跑、region_geometry 或渲染策略变更后须重跑 project）。勿手改。
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RegionsFile, SourceCode } from '../lib/contract.js';
import { formatGeoJson } from '../lib/geojson-format.js';
import { buildView } from '../frontend/load.js';
import { atlasGeometrySelection } from '../frontend/atlas.js';
import type { RegionGeometryRule } from '../frontend/region-map.js';

export const ATLAS_GEOMETRY_REL = 'data/peoples/export/atlas-geometry.geojson';

const SOURCES: SourceCode[] = ['awmc', 'darmc', 'nuts'];

/** 由三源全量几何 + atlas.json 的 region_geometry 渲染子集文件内容（确定性：同输入同字节） */
export function renderAtlasGeometry(root: string, rules: RegionGeometryRule[]): { text: string; count: number } {
  const views = new Map<SourceCode, ReturnType<typeof buildView>>();
  for (const code of SOURCES) {
    const file = JSON.parse(readFileSync(join(root, `data/geography/processed/${code}/regions.geojson`), 'utf8')) as RegionsFile;
    views.set(code, buildView(code, file));
  }
  const picked = new Set(atlasGeometrySelection(views, rules).map((vm) => vm.code));
  // 按源顺序、源内文件序输出（与选择结果的绘制顺序无关，前端重新求值）
  const features = SOURCES.flatMap((code) => views.get(code)!.features.filter((vm) => picked.has(vm.code)).map((vm) => vm.feature));
  const out: RegionsFile = { type: 'FeatureCollection', features };
  return { text: formatGeoJson(out), count: features.length };
}
