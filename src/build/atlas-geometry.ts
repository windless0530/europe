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
//
// 导出前做两级有损压缩（确定性、纯几何、不影响要素集合与文件序）：
//   1. Douglas-Peucker 简化，容差 0.002°——默认视口约 0.084°/px，偏差 ~1/40 px；
//      40× 最大缩放下 <1px，由 1px 不随缩放白描边（path.region non-scaling-stroke）
//      覆盖。收益集中在超密海岸线（GADM 俄罗斯占原点数 75%）。
//   2. 坐标量化到 4 位小数（~11m，远低于源头分辨率）——同区溶解产物带
//      全精度浮点（13-14 位），源头坐标本就多为 4 位。
//   逐多边形简化，退化环（turf 抛错 / 环不闭合）仅回退该多边形原坐标；简化后逐环
//   校正绕向与输入一致（d3-geo 球面绕向定内外，翻转环 = 全球补集）。
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simplify } from '@turf/turf';
import type { MultiPolygon, Polygon } from 'geojson';
import type { RegionFeature, RegionsFile, SourceCode } from '../lib/contract.js';
import { formatGeoJson } from '../lib/geojson-format.js';
import { buildView } from '../frontend/load.js';
import { atlasGeometryFeatures } from '../frontend/atlas.js';
import type { RegionGeometryRule } from '../frontend/region-map.js';

export const ATLAS_GEOMETRY_REL = 'data/peoples/export/atlas-geometry.geojson';

const SOURCES: SourceCode[] = ['awmc', 'darmc', 'nuts'];

const SIMPLIFY_TOLERANCE_DEG = 0.002;

/** 环闭合且不少于 4 个坐标点 */
function ringValid(ring: number[][]): boolean {
  return ring.length >= 4 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1];
}

/** 平面带符号面积（shoelace），符号即绕向 */
function ringSignedArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  return a / 2;
}

/** 4 位小数量化（~11m） */
const quantize = (n: number): number => Math.round(n * 10000) / 10000;

function simplifyPolygon(poly: number[][][]): number[][][] {
  try {
    const s = simplify({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: poly } }, {
      tolerance: SIMPLIFY_TOLERANCE_DEG,
      highQuality: false,
    }).geometry as Polygon;
    if (s.coordinates.length === poly.length && s.coordinates.every((r) => ringValid(r))) {
      // d3-geo 按球面绕向定内外：clean-coords 偶发翻转环绕向，翻转环会渲染成
      // 近乎全球的补集（实测 9066 环翻 37 处）。逐环强制与输入同绕向：异号则反转。
      return s.coordinates.map((r, i) => {
        const q = r.map(([x, y]) => [quantize(x), quantize(y)]);
        const aIn = ringSignedArea(poly[i]!);
        const aOut = ringSignedArea(q);
        if (aIn !== 0 && aOut !== 0 && Math.sign(aIn) !== Math.sign(aOut)) q.reverse();
        return q;
      });
    }
  } catch {
    // 退化多边形（如源头即 <4 点的环）：保留原坐标
  }
  return poly.map((r) => r.map(([x, y]) => [quantize(x), quantize(y)]));
}

/** 要素级：逐多边形 DP 简化 + 量化；要素数与顺序不变 */
function simplifyFeature(ft: RegionFeature): RegionFeature {
  const g = ft.geometry as Polygon | MultiPolygon;
  const out =
    g.type === 'Polygon'
      ? ({ type: 'Polygon', coordinates: simplifyPolygon(g.coordinates) } as Polygon)
      : ({ type: 'MultiPolygon', coordinates: g.coordinates.map(simplifyPolygon) } as MultiPolygon);
  return { ...ft, geometry: out } as RegionFeature;
}

/** 由三源全量几何 + atlas.json 的 region_geometry 渲染子集文件内容（确定性：同输入同字节） */
export function renderAtlasGeometry(root: string, rules: RegionGeometryRule[]): { text: string; count: number } {
  const views = new Map<SourceCode, ReturnType<typeof buildView>>();
  for (const code of SOURCES) {
    const file = JSON.parse(readFileSync(join(root, `data/geography/processed/${code}/regions.geojson`), 'utf8')) as RegionsFile;
    views.set(code, buildView(code, file));
  }
  // 已溶解的绘制集合：文件序 = 绘制顺序，前端启动直接使用（不再运行时溶解）；
  // 随后 DP 简化 + 量化压缩（见头注）
  const features = atlasGeometryFeatures(views, rules).map((vm) => simplifyFeature(vm.feature));
  const out: RegionsFile = { type: 'FeatureCollection', features };
  return { text: formatGeoJson(out), count: features.length };
}
