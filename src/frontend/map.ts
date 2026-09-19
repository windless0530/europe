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
  /** 按 region_code 批量更新填充与可见性（内存操作，无网络） */
  applyStyles(entries: Iterable<[string, { fill?: string; visible: boolean }]>): void;
  setHover(code: string | null): void;
  onHover(cb: (e: HoverEvent) => void): void;
  resize(view: SourceView, opts: MapOpts): void;
}

/** tooltip 内容渲染器（由 main 依据当前模式提供） */
export type DescribeVm = (vm: RegionVm) => { name: string; meta: string };

/** 欧洲参考范围的加密采样顶点（供手动 fit 投影后取 bounds） */
function europeRingVertices(): [number, number][] {
  const w = -31, s = 27, e = 45, n = 73, step = 2;
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
const FIT_BASE_SCALE = 1000;

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
  const gRoot = svg.append('g');
  const gGraticule = gRoot.append('g');
  const gRegions = gRoot.append('g');

  const tooltip = select(container).select<HTMLDivElement>('.map-tooltip');
  tooltip.html('<div class="tt-name"></div><div class="tt-meta"></div>');
  const nodesByCode = new Map<string, SVGPathElement>();
  let hoverCb: ((e: HoverEvent) => void) | null = null;
  let hovered: string | null = null;
  let currentView: SourceView | null = null;
  let currentFeatures: RegionVm[] = [];
  let currentOpts: MapOpts | null = null;

  const projection = geoAzimuthalEqualArea().rotate([-10, -52]);
  const pathGen = geoPath(projection);

  function fit(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    fitProjectionToEurope(projection, w, h, 14);
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
      }),
  );

  function bindHover(pathNode: SVGPathElement, vm: RegionVm): void {
    pathNode.addEventListener('pointerenter', (evt) => {
      hoverCb?.({ vm, x: 0, y: 0 });
      showTooltip(vm, evt as MouseEvent);
    });
    pathNode.addEventListener('pointermove', (evt) => {
      showTooltip(vm, evt as MouseEvent);
    });
    pathNode.addEventListener('pointerleave', () => {
      hoverCb?.({ vm: null, x: 0, y: 0 });
      showTooltip(null, null);
    });
  }

  function rebuild(features: RegionVm[]): void {
    nodesByCode.clear();
    fit();
    drawChrome();
    const pal = modePalette();
    gRegions.selectAll('path').remove();
    for (const vm of features) {
      const d = pathGen(vm.feature as unknown as GeoPermissibleObjects);
      if (!d) continue;
      const node = gRegions.append('path').attr('class', 'region').attr('data-code', vm.code).attr('d', d).node();
      if (!node) continue;
      node.style.fill = familyFill(vm.family, vm.level, pal);
      nodesByCode.set(vm.code, node);
      bindHover(node, vm);
    }
  }

  return {
    render(view, opts) {
      currentView = view;
      currentOpts = opts;
      currentFeatures = view.features;
      rebuild(view.features);
      this.updateVisibility(view, opts);
    },

    updateVisibility(view, opts) {
      currentOpts = opts;
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

    applyStyles(entries) {
      for (const [code, st] of entries) {
        const node = nodesByCode.get(code);
        if (!node) continue;
        if (st.fill !== undefined) node.style.fill = st.fill;
        node.style.display = st.visible ? '' : 'none';
      }
    },

    setHover(code) {
      const prev = hovered !== null ? nodesByCode.get(hovered) : null;
      prev?.classList.remove('hovered');
      hovered = code;
      if (code === null) return;
      const node = nodesByCode.get(code);
      if (!node) return;
      node.classList.add('hovered');
      // 提到最上层，保证描边完整
      node.parentNode?.appendChild(node);
    },

    onHover(cb) {
      hoverCb = cb;
    },

    resize(view, opts) {
      if (currentFeatures.length === 0) return;
      fit();
      drawChrome();
      for (const vm of currentFeatures) {
        const node = nodesByCode.get(vm.code);
        if (!node) continue;
        const d = pathGen(vm.feature as unknown as GeoPermissibleObjects);
        if (d) node.setAttribute('d', d);
      }
      currentOpts = opts;
    },
  };
}
