// 网站图标生成：用项目自有 NUTS L0 几何合成「欧洲大陆剪影」favicon。
// 为什么不用现成图标：欧盟旗只代表 27 国（政治符号，与含 UK/瑞士/挪威/
// 巴尔干/乌克兰、时间轴起于前 509 年的图谱错位）；Commons 欧洲剪影为
// CC BY-SA（署名 + 同许可传染）。自有管线产物（Eurostat NUTS）零许可负担，
// 且与站内地图同投影（LAEA 中心 10E/52N）——图标即地图微缩。
//
// 产物：public/favicon.svg（矢量，Chrome/Firefox/Edge）
//       public/favicon-32.png（32px 回退，Safari 等）
//       public/apple-touch-icon.png（180px，iOS 主屏/书签）
// 用法：npm run favicon

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { geoAzimuthalEqualArea } from 'd3-geo';
import { bboxClip, simplify, union } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pub = join(root, 'public');
mkdirSync(pub, { recursive: true });

// ---------- 1. 载入 NUTS L0 国家几何，裁剪到站内地图同一欧洲范围 ----------
const BBOX: [number, number, number, number] = [-31, 27, 45, 73]; // 与 map.ts europeRingVertices 一致
const file = JSON.parse(readFileSync(join(root, 'data/geography/processed/nuts/regions.geojson'), 'utf8'));
const l0: Array<Feature<Polygon | MultiPolygon>> = [];
for (const f of file.features as Feature[]) {
  if (f.properties?.level !== 0) continue;
  const clipped = bboxClip(f as Feature<Polygon | MultiPolygon>, BBOX);
  // bboxClip 会残留空多边形成员（[[ ]]），polyclip-ts 无法处理——清洗掉
  const g = clipped.geometry;
  const src = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const polys = src
    .map((poly) => poly.filter((ring) => ring.length >= 4))
    .filter((poly) => poly.length > 0);
  if (polys.length === 0) continue;
  l0.push({
    type: 'Feature',
    properties: {},
    geometry: polys.length === 1 && polys[0]!.length === 1
      ? { type: 'Polygon', coordinates: polys[0]! }
      : { type: 'MultiPolygon', coordinates: polys },
  });
}
console.log(`L0 国家几何：${l0.length} 个（已裁剪到 ${BBOX}，清洗空环后）`);

// ---------- 2. 合并为单一大陆形状并化简（图标 64px 无需海岸线细节） ----------
let shape = union({ type: 'FeatureCollection', features: l0 });
if (!shape) throw new Error('union 失败：未能合并 L0 几何');
shape = simplify(shape, { tolerance: 0.35, highQuality: true, mutate: true });
const polys = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates;
console.log(`化简后：${polys.length} 个多边形（未过滤）`);

// ---------- 3. LAEA 投影（与 map.ts 同参数），fit 到剪影自身外接框 ----------
// 不用地图的「欧洲环框」fit（含海洋边距）：图标要让大陆尽量占满芯片，
// 16px 标签页尺寸下才可辨。尺度按全量环定（维持现状占满度），但居中延迟到
// 步骤 4 面积过滤后按保留环重算——亚速尔/加纳利等西南碎屑会把全量外接框
// 撑偏，令过滤后的大陆主体整体偏右上。
const SIZE = 64;
const FIT_BASE = 1000;
const projection = geoAzimuthalEqualArea().rotate([-10, -52]);
projection.scale(FIT_BASE);
projection.translate([0, 0]);
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const ring of polys.flat() as [number, number][][]) {
  for (const c of ring) {
    const p = projection(c);
    if (!p) continue;
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
}
const pad = 2.5;
const k = Math.min((SIZE - pad * 2) / (x1 - x0), (SIZE - pad * 2) / (y1 - y0));
projection.scale(FIT_BASE * k);

// ---------- 4. 投影 + 像素面积过滤（去小岛碎屑与小孔洞）+ 生成 SVG path ----------
// 64px 画布上：主大陆/不列颠/爱尔兰/冰岛 ≥ 3px² 保留，
// 群岛碎屑 < 3px² 剔除；孔洞（内海/湖）< 1.5px² 直接填充不挖。
const shoelace = (pts: [number, number][]): number =>
  Math.abs(pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return s + (p[0] * q[1] - q[0] * p[1]);
  }, 0) / 2);

const paths: string[] = [];
// 面积与平移无关：先在 translate=[0,0] 下完成过滤并记录保留环，
// 再把保留环外接框中心平移到画心（全量框居中会被碎屑岛带偏）。
const keptRings: [number, number][][] = [];
let kx0 = Infinity, ky0 = Infinity, kx1 = -Infinity, ky1 = -Infinity;
for (const poly of polys) {
  const projected = (poly as [number, number][][])
    .map((ring) => ring.map((c) => projection(c)).filter((p): p is [number, number] => !!p))
    .filter((ring) => ring.length >= 3);
  if (projected.length === 0) continue;
  const [outer, ...holes] = projected;
  if (shoelace(outer!) < 3) continue; // 小岛碎屑
  const lonLats = poly[0] as [number, number][];
  const lons = lonLats.map((c) => c[0]);
  const lats = lonLats.map((c) => c[1]);
  console.log(
    `  保留多边形：面积 ${shoelace(outer!).toFixed(1)}px²，地理范围 ` +
      `lon ${Math.min(...lons).toFixed(0)}~${Math.max(...lons).toFixed(0)} / lat ${Math.min(...lats).toFixed(0)}~${Math.max(...lats).toFixed(0)}`,
  );
  const rings = [outer!, ...holes.filter((h) => shoelace(h) >= 1.5)];
  keptRings.push(...rings);
  for (const ring of rings) {
    for (const [px, py] of ring) {
      if (px < kx0) kx0 = px;
      if (py < ky0) ky0 = py;
      if (px > kx1) kx1 = px;
      if (py > ky1) ky1 = py;
    }
  }
}
const tx = SIZE / 2 - (kx0 + kx1) / 2;
const ty = SIZE / 2 - (ky0 + ky1) / 2;
for (const ring of keptRings) {
  paths.push(`M${ring.map(([x, y]) => `${(x + tx).toFixed(1)} ${(y + ty).toFixed(1)}`).join('L')}Z`);
}

// 配色：series-blue 芯片 + 近页面色剪影——明/暗浏览器标签页上都醒目
// （深色芯片会在深色标签页里「消失」），也贴合站点主题色。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#2a78d6"/>
<g fill="#f5f4ef" fill-rule="evenodd">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>
</svg>
`;
writeFileSync(join(pub, 'favicon.svg'), svg);
console.log(`favicon.svg：面积过滤后保留 ${paths.length} 个 path，${(svg.length / 1024).toFixed(1)} KB`);

// ---------- 5. PNG 回退（Safari 不支持 SVG favicon）：playwright 渲染 ----------
const render = async (size: number, out: string): Promise<void> => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const b64 = Buffer.from(svg).toString('base64');
  await page.setContent(
    `<body style="margin:0"><img src="data:image/svg+xml;base64,${b64}" width="${size}" height="${size}"></body>`,
  );
  await page.screenshot({ path: join(pub, out) });
  await browser.close();
};
await render(32, 'favicon-32.png');
await render(180, 'apple-touch-icon.png');
console.log('favicon-32.png / apple-touch-icon.png 完成');
