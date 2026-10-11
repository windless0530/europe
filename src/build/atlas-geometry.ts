// ============================================================
// 族群分布几何子集：data/geography/processed/<src>/regions.geojson（三源全量）
//   -> data/peoples/export/atlas-geometry.geojson
//
// 前端启动只加载 atlas.json + 本子集（约为三源全量的 1/4），几何浏览所需的
// 全量三源在进入该模式时按需加载。子集 = atlasGeometryFeatures（与前端同一套
// 规则：region_geometry 规则 + atlas.ts 渲染策略 SUBNATIONAL_LEVEL /
// GBR_CONSTITUENTS / OVERLAY_UNITS 挑选，再同区溶解合并）。**文件序 = 绘制顺序**
// （awmc → darmc → nuts 主体，叠加单元置尾，合并要素占首成员位），前端按文件序
// 直接绘制、不做任何运行时几何运算。合并要素携带 properties.members（成员 source_id），
// source_id 类规则与测试按成员寻址不受影响。
//
// 生成：npm run project（与 atlas.json 一起写出）。过期校验：npm run audit
// （几何管线重跑、region_geometry 或渲染策略变更后须重跑 project）。勿手改。
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RegionsFile, SourceCode } from '../lib/contract.js';
import { formatGeoJson } from '../lib/geojson-format.js';
import { buildView } from '../frontend/load.js';
import { atlasGeometryFeatures } from '../frontend/atlas.js';
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
  // 已溶解的绘制集合：文件序 = 绘制顺序，前端启动直接使用（不再运行时溶解）
  const features = atlasGeometryFeatures(views, rules).map((vm) => vm.feature);
  const out: RegionsFile = { type: 'FeatureCollection', features };
  return { text: formatGeoJson(out), count: features.length };
}
