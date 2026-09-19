// 右侧详情面板：hover 区域的当前信息。
// 几何模式 show()；族群分布模式 showAtlas()（SQL region + 当年族群/语言/宗教/关系/事件）。

import type { RegionVm } from './load';
import type { AtlasModel, PresenceRow } from './atlas';
import { familyName, regionTypeName, t, fmtYear, type Lang } from './i18n';
import { familyFill } from './palette';

export interface PanelApi {
  show(vm: RegionVm, lang: Lang): void;
  showAtlas(vm: RegionVm | null, model: AtlasModel, year: number, lang: Lang): void;
  showIdle(lang: Lang): void;
}

function yearText(vm: RegionVm, lang: Lang): string {
  if (vm.snapshot !== null) return fmtYear(vm.snapshot, lang);
  const start = vm.feature.properties.start_year;
  const end = vm.feature.properties.end_year;
  if (start !== null && end !== null) return `${fmtYear(start, lang)} – ${fmtYear(end, lang)}`;
  if (start !== null) return `${fmtYear(start, lang)} –`;
  return lang === 'zh' ? '未断代' : 'Undated';
}

function yearRangeText(sy: number | null, ey: number | null, lang: Lang): string {
  const to = ey === null ? t('toPresent', lang) : fmtYear(ey, lang);
  return sy === null ? to : `${fmtYear(sy, lang)} – ${to}`;
}

export function createPanel(root: HTMLElement): PanelApi {
  function kv(dl: HTMLDListElement, key: string, value: string): void {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }

  function label(zh: string | null, en: string | null, lang: Lang, fallback = '—'): string {
    return ((lang === 'zh' ? zh : en) ?? en ?? zh) ?? fallback;
  }

  function peopleBlock(row: PresenceRow, model: AtlasModel, lang: Lang, isTop: boolean): HTMLElement {
    const block = document.createElement('div');
    block.className = 'people-block' + (isTop ? ' top' : '');
    const head = document.createElement('div');
    head.className = 'people-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = model.peopleColor.get(row.people_code) ?? 'transparent';
    const name = document.createElement('strong');
    name.textContent = label(row.people.name_zh, row.people.name_en, lang, row.people_code);
    head.append(dot, name);
    if (isTop) {
      const tag = document.createElement('span');
      tag.className = 'people-tag';
      tag.textContent = lang === 'zh' ? '主' : 'top';
      head.append(tag);
    }
    block.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'people-meta';
    meta.textContent = `${model.enumLabel('presence_type', row.presence, lang)} · ${yearRangeText(row.start_year, row.end_year, lang)}`;
    block.appendChild(meta);

    if (row.people.languages.length > 0) {
      const p = document.createElement('div');
      p.className = 'people-line';
      p.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = `${t('fLangs', lang)}: `;
      p.append(b, document.createTextNode(row.people.languages.map((l) => label(l.name_zh, l.name_en, lang)).join('、')));
      block.appendChild(p);
    }
    if (row.people.religions.length > 0) {
      const p = document.createElement('div');
      p.className = 'people-line';
      const b = document.createElement('b');
      b.textContent = `${t('fReligions', lang)}: `;
      p.append(b, document.createTextNode(row.people.religions.map((r) => label(r.name_zh, r.name_en, lang)).join('、')));
      block.appendChild(p);
    }
    const rels = row.people.relations.filter((r) => r.rel !== 'related_to' || row.people.relations.length <= 3);
    if (rels.length > 0) {
      const p = document.createElement('div');
      p.className = 'people-line';
      const b = document.createElement('b');
      b.textContent = `${t('fRelations', lang)}: `;
      p.append(
        b,
        document.createTextNode(
          rels
            .slice(0, 4)
            .map((r) => `${model.enumLabel('relation_type', r.rel, lang)} ${label(r.other_name_zh, r.other_name_en, lang, r.other_code)}`)
            .join('；'),
        ),
      );
      block.appendChild(p);
    }
    return block;
  }

  return {
    showAtlas(vm, model, year, lang) {
      if (!vm) {
        this.showIdle(lang);
        return;
      }
      root.innerHTML = '';
      const rf = model.regionFor(vm.code, year);
      if (!rf) {
        const h2 = document.createElement('h2');
        h2.textContent = (lang === 'zh' ? vm.nameZh : vm.nameEn) ?? vm.nameEn ?? vm.code;
        root.appendChild(h2);
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = t('unlinkedGeometry', lang);
        root.appendChild(hint);
        return;
      }
      const regionCode = rf.regionCode;
      const region = model.regionByCode.get(regionCode);
      const state = rf.state;

      const h2 = document.createElement('h2');
      h2.textContent = label(region?.name_zh ?? null, region?.name_en ?? null, lang, regionCode);
      root.appendChild(h2);
      if (lang === 'zh' && region?.name_en) {
        const sub = document.createElement('div');
        sub.className = 'zh-name';
        sub.textContent = `${region.name_en}（${t('approxNote', lang)}）`;
        root.appendChild(sub);
      }

      if (!state) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = t('noRegionData', lang);
        root.appendChild(hint);
        return;
      }

      const heading = document.createElement('div');
      heading.className = 'panel-section-title';
      heading.textContent = `${t('fPresence', lang)} · ${fmtYear(year, lang)}`;
      root.appendChild(heading);

      for (const row of state.rows) {
        root.appendChild(peopleBlock(row, model, lang, row === state.top));
      }

      const events = model.data.events.filter(
        (e) => e.region_code === regionCode && (e.start_year ?? -Infinity) <= year && year <= (e.end_year ?? Infinity),
      );
      if (events.length > 0) {
        const eh = document.createElement('div');
        eh.className = 'panel-section-title';
        eh.textContent = t('fEvents', lang);
        root.appendChild(eh);
        for (const e of events) {
          const p = document.createElement('div');
          p.className = 'people-line';
          p.textContent = `${label(e.name_zh, e.name_en, lang)}（${e.start_year ?? ''}${e.end_year && e.end_year !== e.start_year ? `–${e.end_year}` : ''}）`;
          root.appendChild(p);
        }
      }
    },

    show(vm, lang) {
      const name = (lang === 'zh' ? vm.nameZh : vm.nameEn) ?? vm.nameEn ?? vm.code;
      const zhMissing = lang === 'zh' && !vm.nameZh;
      root.innerHTML = '';

      const h2 = document.createElement('h2');
      h2.textContent = name;
      root.appendChild(h2);

      if (lang === 'zh' && vm.nameEn && vm.nameEn !== name) {
        const sub = document.createElement('div');
        sub.className = 'zh-name';
        sub.textContent = vm.nameEn + (zhMissing ? ' ' + t('fNoZh', lang) : '');
        root.appendChild(sub);
      } else if (lang === 'en' && vm.nameZh) {
        const sub = document.createElement('div');
        sub.className = 'zh-name';
        sub.textContent = vm.nameZh;
        root.appendChild(sub);
      }

      const badges = document.createElement('div');
      badges.className = 'badge-row';
      const badge = document.createElement('span');
      badge.className = 'badge';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = familyFill(vm.family, vm.level);
      badge.append(dot, document.createTextNode(familyName(vm.family, lang)));
      badges.appendChild(badge);
      root.appendChild(badges);

      const dl = document.createElement('dl');
      dl.className = 'kv';
      kv(dl, t('fType', lang), regionTypeName(vm.regionType, lang));
      if (vm.level !== null) kv(dl, t('fLevel', lang), String(vm.level));
      kv(dl, t('fYear', lang), yearText(vm, lang));
      kv(dl, t('fDataset', lang), vm.dataset);
      kv(dl, t('fSourceId', lang), vm.sourceId);
      root.appendChild(dl);
    },

    showIdle(lang) {
      root.innerHTML = `
        <div class="hint">
          <strong>${t('panelHintTitle', lang)}</strong><br />
          ${t('panelHintBody', lang)}
        </div>`;
    },
  };
}
