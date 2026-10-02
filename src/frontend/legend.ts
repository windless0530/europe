// 图例 + 过滤器（几何浏览模式置于地图上方；
// 族群分布模式的图例已移至左侧「族群谱系」树，见 people-tree.ts）。
// 文本用 ink 色，色块只做身份标识（dataviz 规范）。

import type { SourceView, RegionVm } from './load';
import { isVisible } from './load';
import { familyFill } from './palette';
import { t, type Lang } from './i18n';

export interface LegendApi {
  render(view: SourceView, opts: { era: number; nutsLevel: number; showUndated: boolean }, lang: Lang): void;
}

const LEGEND_KEYS: Record<string, Parameters<typeof t>[0]> = {
  people: 'legendPeoples',
  empire: 'legendEmpire',
  provinces: 'legendProvinces',
  kingdoms: 'legendKingdoms',
};

export function createControls(legendRoot: HTMLElement, filtersRoot: HTMLElement, handlers: { onLevel: (l: number) => void; onUndated: (v: boolean) => void }): LegendApi {
  return {
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
