// 图例 + 过滤器（图例与过滤同行置于地图上方）。
// 文本用 ink 色，色块只做身份标识（dataviz 规范）。

import type { SourceView, RegionVm } from './load';
import { isVisible } from './load';
import type { AtlasModel } from './atlas';
import { familyFill } from './palette';
import { t, type Lang } from './i18n';

export interface LegendApi {
  render(view: SourceView, opts: { era: number; nutsLevel: number; showUndated: boolean }, lang: Lang): void;
  /** 族群分布模式：T 年被着色的 (族群, 区域) 列表 */
  renderAtlas(model: AtlasModel, year: number, lang: Lang): void;
}

function peopleLabel(nameZh: string | null, nameEn: string | null, lang: Lang, code: string): string {
  return (lang === 'zh' ? nameZh : nameEn) ?? nameEn ?? code;
}

const LEGEND_KEYS: Record<string, Parameters<typeof t>[0]> = {
  people: 'legendPeoples',
  empire: 'legendEmpire',
  provinces: 'legendProvinces',
  kingdoms: 'legendKingdoms',
};

export function createControls(legendRoot: HTMLElement, filtersRoot: HTMLElement, handlers: { onLevel: (l: number) => void; onUndated: (v: boolean) => void }): LegendApi {
  return {
    renderAtlas(model, year, lang) {
      const states = [...model.regionsAt(year).entries()].sort(
        (a, b) => b[1].top.render_priority - a[1].top.render_priority || a[0].localeCompare(b[0]),
      );
      legendRoot.innerHTML = '';
      for (const [regionCode, state] of states) {
        const region = model.regionByCode.get(regionCode);
        const item = document.createElement('span');
        item.className = 'legend-item';
        const sw = document.createElement('span');
        sw.className = 'legend-swatch';
        sw.style.background = model.peopleColor.get(state.top.people_code) ?? 'transparent';
        const label = document.createElement('span');
        label.textContent =
          peopleLabel(state.top.people.name_zh, state.top.people.name_en, lang, state.top.people_code) +
          ' · ' +
          peopleLabel(region?.name_zh ?? null, region?.name_en ?? null, lang, regionCode);
        item.append(sw, label);
        if (state.rows.length > 1) {
          const cn = document.createElement('span');
          cn.className = 'count';
          cn.textContent = `+${state.rows.length - 1}`;
          item.append(cn);
        }
        legendRoot.appendChild(item);
      }
      const neutral = document.createElement('span');
      neutral.className = 'legend-item';
      const nsw = document.createElement('span');
      nsw.className = 'legend-swatch';
      nsw.style.background = 'var(--context-fill)';
      neutral.append(nsw, document.createTextNode(t('legendNeutral', lang)));
      legendRoot.appendChild(neutral);
      filtersRoot.innerHTML = '';
    },

    render(view, opts, lang) {
      // ---- 图例 ----
      const counts = new Map<string, number>();
      for (const vm of view.features as RegionVm[]) {
        if (!isVisible(vm, view, opts.era, opts)) continue;
        counts.set(vm.family, (counts.get(vm.family) ?? 0) + 1);
      }
      const entries: Array<{ family: string; label: string; color: string; count?: number }> = [];
      for (const [family, key] of Object.entries(LEGEND_KEYS)) {
        if (!counts.has(family)) continue;
        entries.push({ family, label: t(key, lang), color: familyFill(family, null) });
      }
      if (counts.has('undated')) {
        entries.push({ family: 'undated', label: t('legendUndated', lang), color: familyFill('undated', null) });
      }
      if (view.code === 'nuts') {
        entries.push({
          family: 'nuts',
          label: t('legendNuts', lang).replace('{n}', String(opts.nutsLevel)),
          color: familyFill('nuts', opts.nutsLevel),
          count: view.features.filter((vm) => vm.level === opts.nutsLevel).length,
        });
      }

      legendRoot.innerHTML = '';
      for (const e of entries) {
        const item = document.createElement('span');
        item.className = 'legend-item';
        const sw = document.createElement('span');
        sw.className = 'legend-swatch';
        sw.style.background = e.color;
        const label = document.createElement('span');
        label.textContent = e.label;
        item.append(sw, label);
        const c = counts.get(e.family) ?? e.count;
        if (typeof c === 'number') {
          const cn = document.createElement('span');
          cn.className = 'count';
          cn.textContent = String(c);
          item.append(cn);
        }
        legendRoot.appendChild(item);
      }
      if (legendRoot.children.length === 0) {
        legendRoot.innerHTML = `<span class="legend-item">${t('panelHintTitle', lang)}</span>`;
      }

      // ---- 过滤器 ----
      filtersRoot.innerHTML = '';
      if (view.code === 'nuts') {
        const label = document.createElement('label');
        label.textContent = t('levelLabel', lang);
        const select = document.createElement('select');
        for (const lv of [0, 1, 2, 3]) {
          const opt = document.createElement('option');
          opt.value = String(lv);
          opt.textContent = `NUTS L${lv}`;
          if (lv === opts.nutsLevel) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => handlers.onLevel(Number(select.value)));
        label.appendChild(select);
        filtersRoot.appendChild(label);
      }
      if (view.code === 'awmc') {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = opts.showUndated;
        cb.addEventListener('change', () => handlers.onUndated(cb.checked));
        label.append(cb, document.createTextNode(t('showUndated', lang)));
        filtersRoot.appendChild(label);
      }
    },
  };
}
