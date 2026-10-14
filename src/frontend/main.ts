// 应用入口：启动加载族群分布数据（进度条）→ 装配 地图/时间轴/图例/面板/状态。
// 两种模式：
//   atlas 族群分布（默认）：SQL people_region 驱动着色 + 连续年份时间轴
//   geo   几何浏览：三源几何 + 快照时间轴
// 分段加载：启动只加载 atlas.json + atlas-geometry.geojson（族群分布所需全部数据）；
// 几何浏览首次进入 / 首次切到某数据源时加载该源（独立进度，缓存）。载入后缩放/时间轴/hover 零网络请求。

import './styles.css';
import type { RegionsFile } from '../lib/contract.js';
import { ENUM_DEF, MODERN_ERA_YEAR, SOURCES } from '../lib/shared.js';
import type { SourceCode } from '../lib/shared.js';
import { createMap, type DescribeVm } from './map';
import { createTimeline } from './timeline';
import { createControls } from './legend';
import { createPanel } from './panel';
import {
  ATLAS_GEOMETRY_URL,
  ATLAS_URL,
  SOURCE_LABELS,
  atlasGeometryVms,
  fetchJsonBatch,
  loadConfigSource,
  loadSource,
  type RegionVm,
  type SourceView,
} from './load';
import { buildAtlasModel, caveatActive, CAVEAT, CAVEAT_KINDS, type AtlasData, type AtlasModel, type CaveatKind, type PresenceRow } from './atlas';
import { createPeopleTree } from './people-tree';
import { getCookie, setCookie } from './cookies';
import { createStore, type Mode } from './state';
import { familyName, fmtYear, t, type StringKey } from './i18n';
import { modePalette, onModeChange } from './palette';

/** caveat_kind -> tooltip 提示文案键（与 MAP_NOTE_KEYS 同构，新增枚举值时两处一起补） */
const CAVEAT_HINT_KEYS: Record<CaveatKind, StringKey> = { disputed: 'caveatHintDisputed', method: 'caveatHintMethod' };
/** caveat_kind -> 地图左下角图例文案键 */
const MAP_NOTE_KEYS: Record<CaveatKind, StringKey> = { disputed: 'mapNoteDisputed', method: 'mapNoteMethod' };

/** 谱系树「显示未点亮族群」开关的持久化 cookie（'1'/'0'，缺省显示） */
const COOKIE_SHOW_INACTIVE = 'ptree-show-inactive';

/** 几何浏览模式的时期名（快照年 -> 名称） */
const GEO_ERA_NAMES: Record<number, { zh: string; en: string }> = {
  [-60]: { zh: '罗马共和国晚期', en: 'Late Roman Republic' },
  14: { zh: '罗马帝国早期', en: 'Early Roman Empire' },
  69: { zh: '弗拉维王朝时期', en: 'Flavian era' },
  117: { zh: '图拉真治下版图极盛', en: 'Empire under Trajan' },
  200: { zh: '塞维鲁王朝时期', en: 'Severan era' },
  303: { zh: '戴克里先改革', en: 'Diocletian reforms' },
  314: { zh: '君士坦丁时期', en: 'Constantinian era' },
  500: { zh: '晚期古代', en: 'Late Antiquity' },
  814: { zh: '加洛林时代', en: 'Carolingian era' },
  1000: { zh: '中世纪盛期之始', en: 'Millennium year' },
  1200: { zh: '中世纪盛期', en: 'High Middle Ages' },
  1450: { zh: '中世纪晚期', en: 'Late Middle Ages' },
  [MODERN_ERA_YEAR]: { zh: '现代', en: 'Present' },
};

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function boot(): Promise<void> {
  // ---------------- 启动进度层 ----------------
  const overlay = document.getElementById('boot-overlay')!;
  const fill = document.getElementById('boot-fill') as HTMLDivElement;
  const text = document.getElementById('boot-text')!;
  const hint = document.getElementById('boot-hint')!;
  const title = overlay.querySelector<HTMLElement>('.boot-title')!;
  hint.textContent = t('bootHint', 'zh');
  const setProgress = (frac: number, label: string): void => {
    fill.style.width = `${Math.min(100, Math.round(frac * 100))}%`;
    text.textContent = label;
  };
  /** 进度回调：本段数据（启动 = 族群分布数据；几何浏览 = 单个数据源）加载完即 100% */
  const byteProgress = (label: string) => (loaded: number, total: number): void =>
    setProgress(total > 0 ? loaded / total : 0, `${label} ${mb(loaded)}${total > 0 ? ` / ${mb(total)}` : ''}`);

  const bootLabel = 'atlas.json + atlas-geometry.geojson';
  setProgress(0.01, `${bootLabel} …`);
  // /config 只决定几何浏览模式的初始数据源，与数据下载并行、不阻塞首渲染
  const configReady = loadConfigSource();
  let atlasData: AtlasData;
  let atlasGeometry: RegionsFile;
  try {
    [atlasData, atlasGeometry] = (await fetchJsonBatch([ATLAS_URL, ATLAS_GEOMETRY_URL], byteProgress(bootLabel))) as [AtlasData, RegionsFile];
    setProgress(1, 'OK');
  } catch (err) {
    overlay.classList.add('failed');
    text.textContent = `${t('bootFail', 'zh')}：${(err as Error).message}`;
    return;
  }

  // 族群分布模式的绘制集合：构建期已选定并溶解，文件序 = 绘制顺序，启动零几何运算
  const atlasFeatures = atlasGeometryVms(atlasGeometry);
  const allByCode = new Map<string, RegionVm>(atlasFeatures.map((vm) => [vm.code, vm]));
  /** 几何浏览数据源（全量）：按需加载后放入 */
  const geoViews = new Map<SourceCode, SourceView>();
  const model: AtlasModel = buildAtlasModel(atlasData, atlasFeatures);

  const initialSource = await configReady;
  const store = createStore({
    lang: 'zh',
    mode: 'atlas',
    source: initialSource,
    eraIndex: 0,
    year: 450,
    nutsLevel: 2,
    showUndated: false,
    showInactive: getCookie(COOKIE_SHOW_INACTIVE) !== '0',
    peopleSel: [],
    hoverCode: null,
  });
  const state = () => store.get();

  const describeVm: DescribeVm = (vm) => {
    const s = state();
    if (s.mode === 'atlas') {
      const rf = model.regionFor(vm.code, s.year);
      if (!rf) {
        return { name: (s.lang === 'zh' ? vm.nameZh : vm.nameEn) ?? vm.nameEn ?? vm.code, meta: t('unlinkedGeometry', s.lang) };
      }
      const region = model.regionByCode.get(rf.regionCode);
      // 提示条显示的族群：选中族群覆盖此几何时显示它（与改涂一致），否则主族群——
      // 两者都是该区域自己的族群行，选中不改变悬停信息的归属
      const sel = s.peopleSel.length === 1 ? s.peopleSel[0]! : null;
      let row: PresenceRow | null = rf.state?.top ?? null;
      if (sel !== null && rf.state !== null && model.peopleOverlayAt(sel, s.year).paint.has(vm.code)) {
        const states = model.regionsAt(s.year);
        for (const rc of model.geometryToRegions.get(vm.code) ?? []) {
          const hit = states.get(rc)?.rows.find((r) => r.people_code === sel);
          if (hit) {
            row = hit;
            break;
          }
        }
      }
      const topName = row !== null ? ((s.lang === 'zh' ? row.people.name_zh : row.people.name_en) ?? row.people.name_en) : null;
      // 当年有标注时在 tooltip 末尾提示（详情见右侧面板）；显示选中族群行时标注与其纹理同源
      const rowSel = row !== null && row.people_code === sel;
      const cav = rowSel
        ? caveatActive(row!, s.year) ? [row!] : []
        : rf.state?.rows.filter((r) => caveatActive(r, s.year)) ?? [];
      const cavKind: CaveatKind | null = cav.length === 0 ? null : cav.some((r) => r.caveat_kind === CAVEAT.disputed) ? CAVEAT.disputed : CAVEAT.method;
      const cavHint = cavKind === null ? '' : ` · ${t(CAVEAT_HINT_KEYS[cavKind], s.lang)}`;
      return {
        name: ((s.lang === 'zh' ? region?.name_zh : region?.name_en) ?? region?.name_en) ?? rf.regionCode,
        meta: topName
          ? `${topName} · ${model.enumLabel(ENUM_DEF.presenceType, row!.presence, s.lang)}${cavHint}`
          : t('noRegionData', s.lang),
      };
    }
    return {
      name: vm.nameEn ?? vm.code,
      meta: `${familyName(vm.family, s.lang)} · ${vm.snapshot !== null ? fmtYear(vm.snapshot, s.lang) : '—'}`,
    };
  };

  const map = createMap(document.getElementById('map-wrap')!, () => state().lang, describeVm);
  const timeline = createTimeline(document.getElementById('timeline')!);
  const controls = createControls(document.getElementById('legend')!, document.getElementById('filters')!, {
    onLevel: (level) => store.set({ nutsLevel: level }),
    onUndated: (v) => store.set({ showUndated: v }),
  });
  const peopleTree = createPeopleTree(document.getElementById('people-tree')!);
  const panel = createPanel(document.getElementById('detail-panel')!);

  const treeRoot = document.getElementById('people-tree')!;
  // 地图左下角固定说明：全图着色规则 + 纹理图例（仅族群分布模式）
  const mapNote = document.createElement('div');
  mapNote.className = 'map-note';
  document.getElementById('map-wrap')!.appendChild(mapNote);
  function renderMapNote(lang: 'zh' | 'en'): void {
    mapNote.innerHTML = '';
    const rule = document.createElement('div');
    rule.className = 'map-note-rule';
    rule.textContent = t('mapNoteRule', lang);
    const keys = document.createElement('div');
    keys.className = 'map-note-keys';
    for (const kind of CAVEAT_KINDS) {
      const key = MAP_NOTE_KEYS[kind];
      const item = document.createElement('span');
      item.className = 'map-note-key';
      const sw = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sw.setAttribute('class', 'map-note-swatch');
      sw.setAttribute('width', '18');
      sw.setAttribute('height', '12');
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('width', '18');
      r.setAttribute('height', '12');
      r.setAttribute('rx', '2');
      r.setAttribute('fill', `url(#hatch-${kind}-key)`);
      sw.appendChild(r);
      item.append(sw, document.createTextNode(t(key, lang)));
      keys.appendChild(item);
    }
    mapNote.append(rule, keys);
  }
  const controlsRow = document.getElementById('controls-row')!;

  // 图例树聚焦：悬停谱系树叶 -> 地图只亮该族群当年活动的区域，其余压暗（内存操作）；
  // 已有单选族群时让位——选中即持久聚焦（见 applyAtlasPaint）
  let legendFocus: string | null = null;
  peopleTree.onHighlight((code) => {
    legendFocus = code;
    if (state().mode === 'atlas') applyAtlasPaint(state());
  });
  peopleTree.onToggle((v) => {
    store.set({ showInactive: v });
    setCookie(COOKIE_SHOW_INACTIVE, v ? '1' : '0');
  });
  // 谱系树单选：选中族群入 store（单一数据源），地图把该族群当年活动区域改涂其族群色
  peopleTree.onSelect((codes) => store.set({ peopleSel: codes }));

  // 窄屏抽屉：按钮拉出，遮罩 / 头部 ✕ 收回（桌面端 CSS 隐藏按钮，树为常驻侧栏）
  const treeBtn = document.getElementById('tree-toggle')!;
  const treeScrim = document.getElementById('tree-scrim')!;
  const setTreeOpen = (v: boolean) => document.body.classList.toggle('tree-open', v);
  treeBtn.addEventListener('click', () => setTreeOpen(true));
  treeScrim.addEventListener('click', () => setTreeOpen(false));
  peopleTree.onClose(() => setTreeOpen(false));
  function renderTreeBtn(lang: 'zh' | 'en'): void {
    const n = state().peopleSel.length;
    treeBtn.textContent = `${t('treeBtn', lang)}${n > 0 ? ` · ${n}` : ''}`;
  }

  function applyAtlasPaint(s: { year: number; peopleSel: string[] }): void {
    const paint = model.paintAt(s.year);
    // 谱系树单选族群的覆盖层：其当年活动切片覆盖的几何改涂该族群固定色（未选 = 主流着色）
    const selCode = s.peopleSel.length === 1 ? s.peopleSel[0]! : null;
    const overlay = selCode !== null ? model.peopleOverlayAt(selCode, s.year) : null;
    // geometry -> 当年主族群（聚焦压暗判定）
    const geomPeople = new Map<string, string>();
    for (const [regionCode, st] of model.regionsAt(s.year)) {
      for (const g of model.regionGeometry.get(regionCode) ?? []) geomPeople.set(g, st.top.people_code);
    }
    // 点亮规则：单选族群 = 持久聚焦——其当年活动的几何点亮、其余压暗，移出谱系树不恢复全亮，
    // 取消选中才恢复；未选中时悬停谱系树叶临时聚焦。聚焦点亮含被更高优先级盖住、主族群
    // 并非它的区域（与单选改涂同一视角：盖尔人在 800 年的爱尔兰也属其活动区）
    const focusCode = selCode ?? legendFocus;
    const focusPaint =
      focusCode === null ? null : focusCode === selCode ? overlay!.paint : model.peopleOverlayAt(focusCode, s.year).paint;
    const lit = (code: string): boolean =>
      focusCode === null || geomPeople.get(code) === focusCode || focusPaint?.has(code) === true;
    const contextFill = modePalette().contextFill;
    const entries: Array<[string, { fill: string; visible: boolean; dim: boolean }]> = atlasFeatures.map((vm) => [
      vm.code,
      {
        fill: overlay?.paint.get(vm.code) ?? paint.get(vm.code) ?? contextFill,
        visible: model.geometryLive(vm.code, s.year),
        dim: !lit(vm.code),
      },
    ]);
    map.applyStyles(entries);
    // 标注纹理：压暗的区域不叠纹理，避免干扰聚焦；被覆盖几何改用所选族群自身标注
    // （涂色与纹理同源），其余几何保持主流层标注
    const caveats = model.caveatAt(s.year);
    for (const [code, st] of entries) {
      if (st.dim) caveats.delete(code);
      else if (overlay?.paint.has(code)) {
        const kind = overlay.caveats.get(code);
        if (kind !== undefined) caveats.set(code, kind);
        else caveats.delete(code);
      }
    }
    map.applyCaveats(caveats);
  }

  let view: SourceView | null = null;
  let mapMode: Mode | null = null;
  let tlKind: 'steps' | 'continuous' | null = null;

  /** 几何浏览数据源按需加载：复用启动进度层，只显示该数据源自身的进度（加载完即 100%）。
   *  成功后重新渲染；失败时点击进度层返回（回到上一个已加载的数据源，否则回族群分布）。 */
  let lastGeoSource: SourceCode | null = null;
  let loadingGeo: SourceCode | null = null;
  async function ensureGeoSource(code: SourceCode): Promise<void> {
    if (loadingGeo === code) return; // 加载中的重复触发（如期间的其他状态更新）
    loadingGeo = code;
    const lang = state().lang;
    const label = `${SOURCE_LABELS[code]} regions.geojson`;
    title.textContent = t('geoLoadTitle', lang);
    hint.textContent = t('geoLoadHint', lang);
    overlay.classList.remove('failed', 'hidden');
    setProgress(0, `${label} …`);
    try {
      const loaded = await loadSource(code, byteProgress(label));
      if (!geoViews.has(code)) {
        geoViews.set(code, loaded);
        for (const vm of loaded.features) if (!allByCode.has(vm.code)) allByCode.set(vm.code, vm);
      }
      setProgress(1, 'OK');
      overlay.classList.add('hidden');
      store.set({}); // 重入 geo 分支完成渲染
    } catch (err) {
      overlay.classList.add('failed');
      text.textContent = `${t('geoLoadFail', lang)}：${(err as Error).message}`;
      hint.textContent = t('geoLoadDismiss', lang);
      overlay.addEventListener(
        'click',
        () => {
          overlay.classList.add('hidden');
          overlay.classList.remove('failed');
          if (lastGeoSource && geoViews.has(lastGeoSource)) store.set({ source: lastGeoSource, eraIndex: 0, hoverCode: null });
          else store.set({ mode: 'atlas', hoverCode: null });
        },
        { once: true },
      );
    } finally {
      loadingGeo = null;
    }
  }

  function opts() {
    const s = state();
    const era = view ? view.eras[Math.min(s.eraIndex, view.eras.length - 1)]! : MODERN_ERA_YEAR;
    return { era, nutsLevel: s.nutsLevel, showUndated: s.showUndated };
  }

  function applyStaticTexts(lang: string): void {
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n as StringKey, lang as 'zh' | 'en');
    }
    document.getElementById('lang-toggle')!.textContent = t('langToggle', lang as 'zh' | 'en');
    const modeBtn = document.getElementById('mode-toggle')!;
    const other = state().mode === 'atlas' ? 'modeGeo' : 'modeAtlas';
    modeBtn.textContent = t(other, lang as 'zh' | 'en');
    timeline.setLang(); // 播放按钮 / 单一版本提示 / 年份标签随语言刷新
    renderTreeBtn(lang as 'zh' | 'en');
  }

  function renderSourceSeg(lang: string): void {
    const seg = document.getElementById('source-seg')!;
    const s = state();
    seg.style.display = s.mode === 'geo' ? '' : 'none';
    seg.innerHTML = '';
    seg.setAttribute('aria-label', t('sourceLabel', lang as 'zh' | 'en'));
    for (const code of SOURCES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = code.toUpperCase();
      if (code === s.source) b.classList.add('active');
      b.addEventListener('click', () => store.set({ source: code, eraIndex: 0, hoverCode: null }));
      seg.appendChild(b);
    }
  }

  document.getElementById('lang-toggle')!.addEventListener('click', () => {
    store.set({ lang: state().lang === 'zh' ? 'en' : 'zh' });
  });

  document.getElementById('mode-toggle')!.addEventListener('click', () => {
    store.set({ mode: state().mode === 'atlas' ? 'geo' : 'atlas', hoverCode: null });
  });

  timeline.setDescribe((v) => {
    const s = state();
    let name = '';
    if (s.mode === 'atlas') {
      const period = model.periodAt(v);
      name = ((s.lang === 'zh' ? period?.name_zh : period?.name_en) ?? period?.name_en) ?? '';
    } else {
      name = GEO_ERA_NAMES[v]?.[s.lang] ?? '';
    }
    return { year: fmtYear(v, s.lang), name };
  });

  timeline.onValue((v) => {
    if (state().mode === 'atlas') {
      store.set({ year: v });
    } else if (view) {
      const idx = view.eras.indexOf(v);
      if (idx >= 0) store.set({ eraIndex: idx });
    }
  });

  map.onHover(({ vm }) => {
    store.set({ hoverCode: vm ? vm.code : null });
  });

  // 点选区域 = 单选该区域当前主族群（与谱系树点叶同一入口：同区再点取消）；点在语族
  // 区域以外（海洋/空白）或无族群数据的区域 = 取消当前选中。鼠标单击与触屏轻点同构
  // （map.ts 已过滤拖动平移）
  map.onClick(({ vm }) => {
    const s = state();
    if (s.mode !== 'atlas') return;
    const top = (vm !== null ? model.regionFor(vm.code, s.year)?.state?.top : null) ?? null;
    if (top === null) {
      if (s.peopleSel.length > 0) store.set({ peopleSel: [] });
      return;
    }
    store.set({ peopleSel: s.peopleSel[0] === top.people_code ? [] : [top.people_code] });
  });

  // resize 防抖：全量重投影开销大，拖动窗口期间不逐事件重算；就地在既有节点上更新 d，
  // 不重建 DOM/监听器。标注纹理层复制几何节点的 d，重投影后由 applyAtlasPaint 重建
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (mapMode === 'atlas') {
        map.resize();
        applyAtlasPaint(state());
      } else if (view) map.resize();
    }, 150);
  });

  onModeChange(() => {
    if (mapMode === 'atlas') {
      map.setGeometry(atlasFeatures);
      applyAtlasPaint(state());
      peopleTree.render(model, state().year, state().lang, state().showInactive, new Set(state().peopleSel));
    } else if (view) {
      map.refreshColors(view);
      controls.render(view, opts(), state().lang);
    }
  });

  // 订阅按变更字段做增量更新：hover 只刷新面板与描边，年份只重着色 + 时间轴 + 谱系树，
  // 语言只刷静态文案——避免每次 set 全量跑完整管线（hover 高频触发）。
  store.subscribe((s, prev) => {
    const modeSwitch = s.mode !== prev.mode;
    const langCh = s.lang !== prev.lang;
    const yearCh = s.year !== prev.year;
    const hoverCh = s.hoverCode !== prev.hoverCode;
    const selCh = s.peopleSel !== prev.peopleSel;
    const sourceCh = s.source !== prev.source;
    const geoOptsCh = modeSwitch || sourceCh || s.eraIndex !== prev.eraIndex || s.nutsLevel !== prev.nutsLevel || s.showUndated !== prev.showUndated;

    if (modeSwitch) {
      setTreeOpen(false); // 切模式收回抽屉（遮罩不得盖住几何浏览）
      treeBtn.style.display = s.mode === 'atlas' ? '' : 'none';
      mapNote.style.display = s.mode === 'atlas' ? '' : 'none';
      controlsRow.style.display = s.mode === 'geo' ? '' : 'none';
    }
    if (langCh || modeSwitch) renderMapNote(s.lang);
    if (s.mode === 'atlas') {
      if (mapMode !== 'atlas') {
        mapMode = 'atlas';
        map.setGeometry(atlasFeatures);
      }
      if (yearCh || modeSwitch || selCh) applyAtlasPaint(s);
      if (tlKind !== 'continuous') {
        tlKind = 'continuous';
        timeline.buildContinuous(model.yearRange, s.year);
      } else if (yearCh) {
        timeline.update(s.year);
      }
      if (yearCh || langCh || modeSwitch || s.showInactive !== prev.showInactive) {
        peopleTree.render(model, s.year, s.lang, s.showInactive, new Set(s.peopleSel));
      }
      if (selCh) {
        peopleTree.setSelected(new Set(s.peopleSel));
        renderTreeBtn(s.lang); // 抽屉收起时按钮徽标反馈已选数量
      }
      if (hoverCh || yearCh || langCh || modeSwitch || selCh) {
        const vm = s.hoverCode ? (allByCode.get(s.hoverCode) ?? null) : null;
        panel.showAtlas(vm, model, s.year, s.lang, s.peopleSel[0] ?? null);
      }
    } else {
      const entering = mapMode !== 'geo';
      mapMode = 'geo';
      const loaded = geoViews.get(s.source);
      let rebuilt = false;
      if (!loaded) {
        void ensureGeoSource(s.source); // 首次进入该数据源：加载完成后 store.set({}) 重入本分支
      } else if (entering || view !== loaded) {
        // 每次进入几何浏览（或切换数据源）都重建几何与快照时间轴——族群分布模式会替换地图几何与时间轴
        view = loaded;
        lastGeoSource = s.source;
        map.render(view, opts());
        tlKind = 'steps';
        timeline.buildSteps(view.eras, Math.min(s.eraIndex, view.eras.length - 1));
        rebuilt = true;
      }
      if (view && view === loaded && (rebuilt || geoOptsCh)) {
        map.updateVisibility(view, opts());
        timeline.update(view.eras[Math.min(s.eraIndex, view.eras.length - 1)]!);
        controls.render(view, opts(), s.lang);
      }
      if (view && view === loaded && (rebuilt || hoverCh || langCh)) {
        const vm = s.hoverCode ? allByCode.get(s.hoverCode) : null;
        if (vm && vm.source === view.code) panel.show(vm, s.lang);
        else panel.showIdle(s.lang);
      }
    }
    if (langCh || modeSwitch) applyStaticTexts(s.lang);
    if (langCh || modeSwitch || sourceCh) renderSourceSeg(s.lang);
    if (hoverCh) map.setHover(s.hoverCode);
  });

  applyStaticTexts('zh');
  renderSourceSeg('zh');
  // 分帧构建地图几何：进度条持续走到 100%，避免 0.5s 级长任务卡住进度动画
  const mapLabel = t('bootMap', 'zh');
  await map.setGeometryProgressive(atlasFeatures, (frac) => setProgress(frac, mapLabel));
  overlay.classList.add('hidden');
  mapMode = 'atlas'; // 几何已就位：首次渲染不再走订阅分支里的 setGeometry 重建
  store.set({}); // 触发首次渲染
}

void boot();
