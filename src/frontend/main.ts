// 应用入口：启动全量加载（进度条）→ 装配 地图/时间轴/图例/面板/状态。
// 两种模式：
//   atlas 族群分布（默认）：SQL people_region 驱动着色 + 连续年份时间轴
//   geo   几何浏览：三源几何 + 快照时间轴
// 全部数据启动时进内存，此后缩放/时间轴/hover 零网络请求。

import './styles.css';
import type { SourceCode } from '../lib/contract.js';
import { createMap, type DescribeVm } from './map';
import { createTimeline } from './timeline';
import { createControls } from './legend';
import { createPanel } from './panel';
import { loadConfigSource, prefetchAllSources, type RegionVm, type SourceView } from './load';
import { atlasGeometryFeatures, buildAtlasModel, fetchAtlas, type AtlasData, type AtlasModel } from './atlas';
import { createStore } from './state';
import { familyName, fmtYear, t, type StringKey } from './i18n';
import { modePalette, onModeChange } from './palette';

type Mode = 'atlas' | 'geo';

const SOURCE_CODES: SourceCode[] = ['awmc', 'darmc', 'nuts'];

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
  2024: { zh: '现代', en: 'Present' },
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
  hint.textContent = t('bootHint', 'zh');
  const setProgress = (frac: number, label: string): void => {
    fill.style.width = `${Math.min(100, Math.round(frac * 100))}%`;
    text.textContent = label;
  };

  setProgress(0.01, 'atlas.json …');
  let atlasData: AtlasData;
  let views: Map<SourceCode, SourceView>;
  try {
    atlasData = await fetchAtlas((loaded, total) => {
      if (total > 0) setProgress(0.4 * (loaded / total), `atlas.json ${mb(loaded)} / ${mb(total)}`);
    });
    let done = 0;
    views = await prefetchAllSources((step) => {
      const w = 0.6 / 3;
      const base = 0.4 + w * done;
      const inner = step.total > 0 ? step.loaded / step.total : 0.4;
      const label = step.done ? `${step.label} ✓` : `${step.label} ${mb(step.loaded)}${step.total > 0 ? ` / ${mb(step.total)}` : ''}`;
      setProgress(base + w * (step.done ? 1 : inner), label);
      if (step.done) done++;
    });
    setProgress(1, 'OK');
  } catch (err) {
    overlay.classList.add('failed');
    text.textContent = `${t('bootFail', 'zh')}：${(err as Error).message}`;
    return;
  }

  const allFeatures: RegionVm[] = [...views.values()].flatMap((v) => v.features);
  const allByCode = new Map(allFeatures.map((vm) => [vm.code, vm]));
  const model: AtlasModel = buildAtlasModel(atlasData, allFeatures);
  const atlasFeatures = atlasGeometryFeatures(views);

  const initialSource = await loadConfigSource();
  const store = createStore({
    lang: 'zh',
    mode: 'atlas',
    source: initialSource,
    eraIndex: 0,
    year: 450,
    nutsLevel: 2,
    showUndated: false,
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
      const topName = rf.state
        ? ((s.lang === 'zh' ? rf.state.top.people.name_zh : rf.state.top.people.name_en) ?? rf.state.top.people.name_en)
        : null;
      return {
        name: ((s.lang === 'zh' ? region?.name_zh : region?.name_en) ?? region?.name_en) ?? rf.regionCode,
        meta: topName
          ? `${topName} · ${model.enumLabel('presence_type', rf.state!.top.presence, s.lang)}`
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
  const panel = createPanel(document.getElementById('detail-panel')!);

  let view: SourceView | null = null;
  let mapMode: Mode | null = null;
  let tlKind: 'steps' | 'continuous' | null = null;

  function opts() {
    const s = state();
    const era = view ? view.eras[Math.min(s.eraIndex, view.eras.length - 1)]! : 2024;
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
  }

  function renderSourceSeg(lang: string): void {
    const seg = document.getElementById('source-seg')!;
    const s = state();
    seg.style.display = s.mode === 'geo' ? '' : 'none';
    seg.innerHTML = '';
    seg.setAttribute('aria-label', t('sourceLabel', lang as 'zh' | 'en'));
    for (const code of SOURCE_CODES) {
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

  window.addEventListener('resize', () => {
    if (mapMode === 'atlas') map.setGeometry(atlasFeatures);
    else if (view) map.resize(view, opts());
  });

  onModeChange(() => {
    if (mapMode === 'atlas') {
      map.setGeometry(atlasFeatures);
      controls.renderAtlas(model, state().year, state().lang);
    } else if (view) {
      map.refreshColors(view);
      controls.render(view, opts(), state().lang);
    }
  });

  store.subscribe((s) => {
    if (s.mode === 'atlas') {
      if (mapMode !== 'atlas') {
        mapMode = 'atlas';
        map.setGeometry(atlasFeatures);
      }
      const paint = model.paintAt(s.year);
      const contextFill = modePalette().contextFill;
      const entries: Array<[string, { fill: string; visible: boolean }]> = atlasFeatures.map((vm) => [
        vm.code,
        { fill: paint.get(vm.code) ?? contextFill, visible: true },
      ]);
      map.applyStyles(entries);
      if (tlKind !== 'continuous') {
        tlKind = 'continuous';
        timeline.buildContinuous(model.yearRange, s.year);
      } else {
        timeline.update(s.year);
      }
      controls.renderAtlas(model, s.year, s.lang);
      const vm = s.hoverCode ? (allByCode.get(s.hoverCode) ?? null) : null;
      panel.showAtlas(vm, model, s.year, s.lang);
    } else {
      if (mapMode !== 'geo') mapMode = 'geo';
      if (!view || view.code !== s.source) {
        view = views.get(s.source) ?? null;
        if (view) {
          map.render(view, opts());
          tlKind = 'steps';
          timeline.buildSteps(view.eras, Math.min(s.eraIndex, view.eras.length - 1));
        }
      }
      if (view) {
        map.updateVisibility(view, opts());
        timeline.update(view.eras[Math.min(s.eraIndex, view.eras.length - 1)]!);
        controls.render(view, opts(), s.lang);
        const vm = s.hoverCode ? allByCode.get(s.hoverCode) : null;
        if (vm && vm.source === view.code) panel.show(vm, s.lang);
        else panel.showIdle(s.lang);
      }
    }
    applyStaticTexts(s.lang);
    renderSourceSeg(s.lang);
    map.setHover(s.hoverCode);
  });

  applyStaticTexts('zh');
  renderSourceSeg('zh');
  overlay.classList.add('hidden');
  store.set({}); // 触发首次渲染
}

void boot();
