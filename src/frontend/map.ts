// 地图渲染：d3-geo 方位等积投影（LAEA，近似 EPSG:3035 视觉），
// SVG 路径 + d3-zoom 缩放 + hover 高亮/提示。
// 快照时间轴切换只改 display 与既有填充色，不重建几何。

import { geoAzimuthalEqualArea, geoGraticule10, geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, type D3ZoomEvent } from 'd3-zoom';
import type { RegionVm, SourceView } from './load';
import { isVisible } from './load';
import { familyFill, modePalette } from './palette';
import { familyName, fmtYear, type Lang } from './i18n';
import { CAVEAT, type CaveatKind } from './atlas';
import { EUROPE_BBOX } from '../lib/shared.js';

export interface MapOpts {
  era: number;
  nutsLevel: number;
  showUndated: boolean;
}

export interface HoverEvent {
  vm: RegionVm | null;
  /** 相对地图容器的坐标（tooltip 用） */
  x: number;
  y: number;
}

export interface MapApi {
  render(view: SourceView, opts: MapOpts): void;
  updateVisibility(view: SourceView, opts: MapOpts): void;
  refreshColors(view: SourceView): void;
  /** 重建几何（族群分布模式：混合多源要素，默认全部可见） */
  setGeometry(features: RegionVm[]): void;
  /** setGeometry 的分帧版（启动路径）：帧预算内批量建路径，onProgress 报告 0..1，完成后 resolve */
  setGeometryProgressive(features: RegionVm[], onProgress?: (frac: number) => void): Promise<void>;
  /** 按 region_code 批量更新填充与可见性（内存操作，无网络）；dim=true 时压暗（图例联动聚焦） */
  applyStyles(entries: Iterable<[string, { fill?: string; visible: boolean; dim?: boolean }]>): void;
  /** 标注纹理叠加层：code -> 纹理类型（disputed 交叉斜线 / method 单向斜线）；空表即清除 */
  applyCaveats(entries: ReadonlyMap<string, CaveatKind>): void;
  setHover(code: string | null): void;
  onHover(cb: (e: HoverEvent) => void): void;
  /** 点选区域（鼠标单击 / 触屏轻点同构；拖动平移后的 click 不触发）：调用方据此单选该区域主族群；
   *  vm = null 表示点在语族区域以外（海洋/地图空白），调用方据此取消当前选中 */
  onClick(cb: (e: { vm: RegionVm | null }) => void): void;
  /** 重投影当前几何：复用既有节点就地更新 d（不重建 DOM/监听器），调用方负责重着色叠加层 */
  resize(): void;
}

/** tooltip 内容渲染器（由 main 依据当前模式提供） */
export type DescribeVm = (vm: RegionVm) => { name: string; meta: string };

/** 让出主线程一步（宏任务，无定时器钳制）：分帧构建的帧间隙由浏览器择机上帧。
 *  不用 rAF——无显示环境（headless/后台页）下 begin frame 会被合并批处理，帧节奏不可控。 */
const yieldTick = (): Promise<void> =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

/** 欧洲参考范围 bbox（手动 fit 与 favicon 生成共用）；唯一真实源在 shared.ts，此处 re-export 维持导入方不变 */
export { EUROPE_BBOX };

/** 主地图投影旋转参数（favicon 生成保持同一视向） */
export const MAP_PROJECTION_ROTATE: [number, number] = [-10, -52];

/** 欧洲参考范围的加密采样顶点（供手动 fit 投影后取 bounds） */
function europeRingVertices(): [number, number][] {
  const { w, s, e, n } = EUROPE_BBOX;
  const step = 2;
  const ring: [number, number][] = [];
  for (let x = w; x < e; x += step) ring.push([x, s]);
  for (let y = s; y < n; y += step) ring.push([e, y]);
  for (let x = e; x > w; x -= step) ring.push([x, n]);
  for (let y = n; y > s; y -= step) ring.push([w, y]);
  return ring;
}

/**
 * 手动仿射 fit：不依赖 d3 的 fitExtent（它会连同投影球盘一起量 bounds，
 * 导致目标区域被缩小），而是把 bbox 顶点直接过投影、取外接框，
 * 再换算 scale/translate。
 */
export const FIT_BASE_SCALE = 1000;

function fitProjectionToEurope(projection: GeoProjection, w: number, h: number, pad: number): void {
  projection.scale(FIT_BASE_SCALE);
  projection.translate([0, 0]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pt of europeRingVertices()) {
    const p = projection(pt);
    if (!p) continue;
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  if (!Number.isFinite(x0)) return;
  const bw = x1 - x0, bh = y1 - y0;
  const k = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
  projection.scale(FIT_BASE_SCALE * k);
  projection.translate([w / 2 - bcx * k, h / 2 - bcy * k]);
}

export function createMap(container: HTMLElement, lang: () => Lang, describeVm?: DescribeVm): MapApi {
  const svg = select(container).append('svg');
  // 标注纹理：底色之上叠稀疏斜线（不改变底色色相，族群颜色仍可辨识）。
  // 线条为「浅色描边 + 深色芯」双色调，任何底色上都有对比；
  // 缩放时 patternTransform 反向缩放，屏幕上的线宽与间距恒定。
  // 争议：间距 6 的交叉线（醒目）；处理说明：间距 7.3 的细单线（轻）
  const HATCH_SIZE: Record<CaveatKind, number> = { disputed: 6, method: 7.3 };
  const defs = svg.append('defs');
  const hatchPatterns: SVGPatternElement[] = [];
  // 每种纹理两份：地图用（随缩放反向缩放）与图例色块用（-key，静态）
  for (const [id, kind] of [
    ['hatch-method', CAVEAT.method], ['hatch-disputed', CAVEAT.disputed], ['hatch-method-key', CAVEAT.method], ['hatch-disputed-key', CAVEAT.disputed],
  ] as const) {
    const size = HATCH_SIZE[kind];
    const pat = defs
      .append('pattern')
      .attr('id', id)
      .attr('class', kind === CAVEAT.method ? 'hatch-light' : null)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', size)
      .attr('height', size)
      .attr('patternTransform', 'rotate(45)');
    const strokes: Array<[number, number, number, number]> = [[size / 2, 0, size / 2, size]];
    if (kind === CAVEAT.disputed) strokes.push([0, size / 2, size, size / 2]);
    for (const [x1, y1, x2, y2] of strokes) {
      pat.append('line').attr('class', 'hatch-halo').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
      pat.append('line').attr('class', 'hatch-core').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
    }
    if (!id.endsWith('-key')) hatchPatterns.push(pat.node()!);
  }
  const gRoot = svg.append('g');
  const gGraticule = gRoot.append('g');
  const gRegions = gRoot.append('g');
  const gOutline = gRoot.append('g');

  const tooltip = select(container).select<HTMLDivElement>('.map-tooltip');
  tooltip.html('<div class="tt-name"></div><div class="tt-meta"></div>');
  const nodesByCode = new Map<string, SVGPathElement>();
  let hoverCb: ((e: HoverEvent) => void) | null = null;
  let clickCb: ((e: { vm: RegionVm | null }) => void) | null = null;
  let hovered: string | null = null;
  // hover 描边覆盖层：复制几何 d 而不重排 path 节点——
  // appendChild 提升被悬停节点会让 Chromium 丢失其 hover 追踪，pointerleave 不再派发。
  let outlinePath: SVGPathElement | null = null;
  /** 标注纹理节点：插在所属几何之后（而非独立顶层），叠加单元（后绘制）因此能盖住其下 L0 的纹理 */
  let caveatNodes: SVGPathElement[] = [];
  let currentView: SourceView | null = null;
  let currentFeatures: RegionVm[] = [];

  const projection = geoAzimuthalEqualArea().rotate(MAP_PROJECTION_ROTATE);
  const pathGen = geoPath(projection);

  /** d 串缓存（键 = 几何对象）：模式来回切换时免去重复 pathGen（全量一次 ~0.4s）。
   *  fit() 实际改变投影参数（缩放/平移）时整体失效。 */
  const dCache = new Map<object, string>();

  function pathD(vm: RegionVm): string {
    const key = vm.feature as object;
    let d = dCache.get(key);
    if (d === undefined) {
      d = pathGen(vm.feature as unknown as GeoPermissibleObjects) ?? '';
      dCache.set(key, d);
    }
    return d;
  }

  function fit(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    const scaleBefore = projection.scale();
    const [tx, ty] = projection.translate();
    fitProjectionToEurope(projection, w, h, 14);
    const [nx, ny] = projection.translate();
    if (projection.scale() !== scaleBefore || nx !== tx || ny !== ty) dCache.clear();
  }

  function drawChrome(): void {
    gGraticule.selectAll('path').remove();
    gGraticule
      .append('path')
      .attr('class', 'graticule')
      .attr('d', pathGen(geoGraticule10()) ?? '');
  }

  function showTooltip(vm: RegionVm | null, evt: MouseEvent | null): void {
    if (!vm || !evt) {
      tooltip.attr('hidden', '');
      return;
    }
    // 触屏不显示悬浮 tooltip：选中信息由地图外的详情面板承载（粘性选中后面板仍在）
    if ((evt as PointerEvent).pointerType === 'touch') {
      tooltip.attr('hidden', '');
      return;
    }
    const l = lang();
    const described = describeVm
      ? describeVm(vm)
      : {
          name: vm.nameEn ?? vm.code,
          meta: `${familyName(vm.family, l)} · ${vm.snapshot !== null ? fmtYear(vm.snapshot, l) : '—'}`,
        };
    tooltip.select('.tt-name').text(described.name);
    tooltip.select('.tt-meta').text(described.meta);
    const el = tooltip.node();
    const wrap = container.getBoundingClientRect();
    const ttW = el?.offsetWidth ?? 200;
    const ttH = el?.offsetHeight ?? 50;
    let x = evt.clientX - wrap.left + 14;
    let y = evt.clientY - wrap.top + 14;
    if (x + ttW > wrap.width - 8) x = evt.clientX - wrap.left - ttW - 14;
    if (y + ttH > wrap.height - 8) y = evt.clientY - wrap.top - ttH - 14;
    tooltip.style('left', `${x}px`).style('top', `${y}px`).attr('hidden', null);
  }

  svg.call(
    zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 40])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        const { x, y, k } = event.transform;
        gRoot.attr('transform', `translate(${x},${y}) scale(${k})`);
        for (const pat of hatchPatterns) pat.setAttribute('patternTransform', `rotate(45) scale(${1 / k})`);
      }),
  );

  // 触屏点选/拖动判别的位移阈值（与 d3-zoom 双击的 tapDistance 同量级）
  const TAP_SLOP = 10;

  // 触屏点空白处（海洋等非区域目标）：清除粘性选中。鼠标路径不受影响。
  svg.node()!.addEventListener('pointerdown', (evt) => {
    if ((evt as PointerEvent).pointerType !== 'touch') return;
    if ((evt.target as Element).closest('path.region')) return;
    hoverCb?.({ vm: null, x: 0, y: 0 });
    showTooltip(null, null);
  });

  // 点选空白（非 path.region 目标）：以 vm=null 上报，调用方据此取消选中。区域上的 click
  // 由 path 节点自己的监听器处理（冒泡到此被 closest 跳过，不重复上报）；拖动平移后的
  // click 已被 d3-zoom 抑制，此处再按 pointerdown 锚点位移兜底（与区域点选同一阈值）
  let bgDownX = 0;
  let bgDownY = 0;
  svg.node()!.addEventListener('pointerdown', (evt) => {
    bgDownX = evt.clientX;
    bgDownY = evt.clientY;
  });
  svg.node()!.addEventListener('click', (evt) => {
    if ((evt.target as Element).closest('path.region')) return;
    if (Math.hypot(evt.clientX - bgDownX, evt.clientY - bgDownY) > TAP_SLOP) return;
    clickCb?.({ vm: null });
  });

  function bindHover(pathNode: SVGPathElement, vm: RegionVm): void {
    let downX = 0;
    let downY = 0;
    let dragged = false;
    pathNode.addEventListener('pointerenter', (evt) => {
      const pe = evt as PointerEvent;
      if (pe.pointerType === 'touch') {
        downX = pe.clientX; // 记按下位置，抬指时区分点选与拖动
        downY = pe.clientY;
        dragged = false;
      }
      hoverCb?.({ vm, x: 0, y: 0 });
      showTooltip(vm, evt as MouseEvent);
    });
    pathNode.addEventListener('pointermove', (evt) => {
      const pe = evt as PointerEvent;
      if (pe.pointerType === 'touch') {
        // 触屏无 tooltip（面板承载），move 仅用于判定是否已成拖动
        if (Math.hypot(pe.clientX - downX, pe.clientY - downY) > TAP_SLOP) dragged = true;
        return;
      }
      showTooltip(vm, evt as MouseEvent);
    });
    pathNode.addEventListener('pointerleave', (evt) => {
      // 触屏点选（未超出阈值）：抬指保持高亮——粘性选中，点空白处或点其他区域再清除；
      // 鼠标与触屏拖动平移维持原行为：离开即清除
      if ((evt as PointerEvent).pointerType === 'touch' && !dragged) return;
      hoverCb?.({ vm: null, x: 0, y: 0 });
      showTooltip(null, null);
    });
    pathNode.addEventListener('pointerdown', (evt) => {
      // 鼠标按下锚点（click 判拖动用）；触屏已在 pointerenter 记录
      if ((evt as PointerEvent).pointerType !== 'touch') {
        downX = evt.clientX;
        downY = evt.clientY;
        dragged = false;
      }
    });
    pathNode.addEventListener('click', (evt) => {
      // 点选区域：触屏拖动（dragged）与拖动平移后的 click（位移超阈值）都不算点选
      if (dragged || Math.hypot(evt.clientX - downX, evt.clientY - downY) > TAP_SLOP) return;
      clickCb?.({ vm });
    });
  }

  /** 生成 d 并追加一个区域节点（含 hover 绑定与溶解成员标记） */
  function appendRegion(vm: RegionVm, pal: ReturnType<typeof modePalette>): void {
    const d = pathD(vm);
    if (!d) return;
    const node = gRegions.append('path').attr('class', 'region').attr('data-code', vm.code).attr('d', d).node();
    // 溶解要素：成员 slug（与单元 data-code 后缀同形）供测试按原始单元寻址
    if (vm.memberIds) node?.setAttribute('data-members', vm.memberIds.map((id) => id.toLowerCase().replace(/[^a-z0-9]+/g, '_')).join(' '));
    if (!node) return;
    node.style.fill = familyFill(vm.family, vm.level, pal);
    nodesByCode.set(vm.code, node);
    bindHover(node, vm);
  }

  function ensureOutline(): void {
    outlinePath = gOutline
      .append('path')
      .attr('class', 'region-outline')
      .attr('fill', 'none')
      .attr('pointer-events', 'none')
      .node()!;
    outlinePath.style.display = 'none';
  }

  function resetLayers(): void {
    nodesByCode.clear();
    fit();
    drawChrome();
    gRegions.selectAll('path').remove();
    caveatNodes = [];
    gOutline.selectAll('path').remove();
  }

  function rebuild(features: RegionVm[]): void {
    resetLayers();
    const pal = modePalette();
    for (const vm of features) appendRegion(vm, pal);
    ensureOutline();
  }

  /** 分帧版 rebuild：每段最多 ~12ms 批量建路径（单个超大要素无法再切，
   *  一次 pathGen 仍可能超预算），段间让出主线程使进度条可动画；完成后 resolve */
  async function rebuildProgressive(features: RegionVm[], onProgress?: (frac: number) => void): Promise<void> {
    resetLayers();
    const pal = modePalette();
    const total = Math.max(features.length, 1);
    let i = 0;
    do {
      const t0 = performance.now();
      while (i < features.length) {
        appendRegion(features[i]!, pal);
        i++;
        if (performance.now() - t0 > 12 && i < features.length) break;
      }
      onProgress?.(i / total);
      if (i < features.length) await yieldTick();
    } while (i < features.length);
    ensureOutline();
  }

  return {
    render(view, opts) {
      currentView = view;
      currentFeatures = view.features;
      rebuild(view.features);
      this.updateVisibility(view, opts);
    },

    updateVisibility(view, opts) {
      for (const vm of view.features) {
        const node = nodesByCode.get(vm.code);
        if (!node) continue;
        node.style.display = isVisible(vm, view, opts.era, opts) ? '' : 'none';
      }
    },

    refreshColors(view) {
      const pal = modePalette();
      for (const vm of view.features) {
        const node = nodesByCode.get(vm.code);
        if (node) node.style.fill = familyFill(vm.family, vm.level, pal);
      }
    },

    setGeometry(features) {
      currentFeatures = features;
      rebuild(features);
    },

    async setGeometryProgressive(features, onProgress) {
      currentFeatures = features;
      await rebuildProgressive(features, onProgress);
    },

    applyStyles(entries) {
      for (const [code, st] of entries) {
        const node = nodesByCode.get(code);
        if (!node) continue;
        if (st.fill !== undefined) node.style.fill = st.fill;
        // 压暗不透明度（smoke-demo.mjs 按此字面值断言图例联动，两处须同步改）
        node.style.fillOpacity = st.dim ? '0.25' : '';
        node.style.display = st.visible ? '' : 'none';
      }
    },

    applyCaveats(entries) {
      for (const n of caveatNodes) n.remove();
      caveatNodes = [];
      for (const [code, kind] of entries) {
        const node = nodesByCode.get(code);
        if (!node || node.style.display === 'none') continue;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', `caveat caveat-${kind}`);
        p.setAttribute('data-code', code);
        p.setAttribute('d', node.getAttribute('d') ?? '');
        p.setAttribute('fill', `url(#hatch-${kind})`);
        p.setAttribute('pointer-events', 'none');
        node.after(p); // 只插入新节点、不移动被悬停节点（hover 追踪不受影响）
        caveatNodes.push(p);
      }
    },

    setHover(code) {
      hovered = code;
      if (code === null) showTooltip(null, null); // 粘性选中被清除（切模式/数据源等）时 tooltip 一并收起
      if (!outlinePath) return;
      if (code === null) {
        outlinePath.style.display = 'none';
        outlinePath.setAttribute('d', '');
        return;
      }
      const node = nodesByCode.get(code);
      if (!node) {
        outlinePath.style.display = 'none';
        return;
      }
      // 描边画在覆盖层上，无需提升被悬停节点（避免 hover 追踪丢失）
      outlinePath.setAttribute('d', node.getAttribute('d') ?? '');
      outlinePath.style.display = '';
    },

    onHover(cb) {
      hoverCb = cb;
    },

    onClick(cb) {
      clickCb = cb;
    },

    resize() {
      if (currentFeatures.length === 0) return;
      fit();
      drawChrome();
      for (const vm of currentFeatures) {
        const node = nodesByCode.get(vm.code);
        if (!node) continue;
        const d = pathD(vm);
        if (d) node.setAttribute('d', d);
      }
      this.setHover(hovered); // 几何 d 已变，覆盖层描边需重建
    },
  };
}
