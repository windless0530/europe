// 界面双语（数据里的 name_zh 目前为 null，翻译属下一阶段；
// 区域名展示规则：zh 模式下优先 name_zh，缺失回退 name_en）。

export type Lang = 'zh' | 'en';

const STRINGS = {
  appTitle: { zh: '欧洲历史族群图谱', en: 'European Historical Peoples Atlas' },
  appSubtitle: { zh: '拖动时间轴 · 悬停查看区域详情 · 滚轮缩放', en: 'Drag the timeline · Hover a region · Scroll to zoom' },
  langToggle: { zh: 'English', en: '中文' },
  sourceLabel: { zh: '数据源', en: 'Data source' },
  legendPeoples: { zh: '族群领地（Strabo 时代）', en: "Peoples' territories (Strabo's era)" },
  legendEmpire: { zh: '罗马帝国范围', en: 'Roman Empire extent' },
  legendProvinces: { zh: '罗马行省', en: 'Roman provinces' },
  legendKingdoms: { zh: '中世纪王国', en: 'Medieval kingdoms' },
  legendNuts: { zh: '现代区划（NUTS L{n}）', en: 'Modern subdivisions (NUTS L{n})' },
  legendUndated: { zh: '未断代实体', en: 'Undated entities' },
  levelLabel: { zh: '区划层级', en: 'Level' },
  showUndated: { zh: '显示未断代实体（波斯/亚历山大等）', en: 'Show undated entities (Persia, Alexander, …)' },
  play: { zh: '播放', en: 'Play' },
  pause: { zh: '暂停', en: 'Pause' },
  timelineNote: { zh: '该数据源为现代单一版本，无时间轴', en: 'This source has a single modern vintage' },
  panelHintTitle: { zh: '悬停地图上的区域', en: 'Hover a region on the map' },
  panelHintBody: {
    zh: '地图会高亮该区域，这里显示它的名称、类型与所属时期。',
    en: 'The map will highlight it and its details appear here.',
  },
  modeAtlas: { zh: '族群分布', en: 'Peoples' },
  modeGeo: { zh: '几何浏览', en: 'Geometry' },
  modeSwitchTo: { zh: '切换到', en: 'Switch to' },
  bootLoading: { zh: '正在加载全部数据…', en: 'Loading all data…' },
  bootHint: {
    zh: '数据全部载入内存后，缩放、拖动时间轴与悬浮查看都不会再产生网络请求。',
    en: 'Once loaded, zooming, the timeline and hover run entirely in memory — no further requests.',
  },
  bootFail: { zh: '加载失败，请刷新重试', en: 'Load failed — please refresh' },
  fLangs: { zh: '语言', en: 'Languages' },
  fReligions: { zh: '宗教', en: 'Religions' },
  fRelations: { zh: '族群关系', en: 'Related peoples' },
  fPresence: { zh: '存在方式', en: 'Presence' },
  fEvents: { zh: '当期事件', en: 'Events' },
  noRegionData: { zh: '当前年份该区域暂无族群数据', en: 'No people data in this region at this year' },
  unlinkedGeometry: { zh: '该几何区域未关联 SQL region（现代底图）', en: 'Geometry not linked to a SQL region (base map)' },
  approxNote: { zh: '边界为近似', en: 'approximate boundary' },
  toPresent: { zh: '至今', en: 'present' },
  legendNeutral: { zh: '无族群数据区域', en: 'No data' },
  fName: { zh: '名称', en: 'Name' },
  fFamily: { zh: '类别', en: 'Category' },
  fType: { zh: '区域类型', en: 'Region type' },
  fLevel: { zh: '层级', en: 'Level' },
  fYear: { zh: '年代', en: 'Date' },
  fSourceId: { zh: '来源 ID', en: 'Source ID' },
  fDataset: { zh: '数据集', en: 'Dataset' },
  fNoZh: { zh: '（中文名待补）', en: '' },
  familyNames: {
    people: { zh: '族群领地', en: 'People territory' },
    empire: { zh: '罗马帝国范围', en: 'Roman Empire extent' },
    undated: { zh: '未断代实体', en: 'Undated entity' },
    provinces: { zh: '罗马行省', en: 'Roman province' },
    kingdoms: { zh: '中世纪王国', en: 'Medieval kingdom' },
    nuts: { zh: '现代区划', en: 'Modern subdivision' },
  } as Record<string, { zh: string; en: string }>,
  regionTypes: {
    political_entity: { zh: '政治实体', en: 'Political entity' },
    historical_region: { zh: '历史地区', en: 'Historical region' },
    cultural_region: { zh: '文化区域', en: 'Cultural region' },
  } as Record<string, { zh: string; en: string }>,
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang): string {
  const entry = STRINGS[key] as { zh: string; en: string } | undefined;
  return entry ? entry[lang] : key;
}

export function familyName(family: string, lang: Lang): string {
  return STRINGS.familyNames[family]?.[lang] ?? family;
}

export function regionTypeName(type: string | null, lang: Lang): string {
  if (!type) return '—';
  return STRINGS.regionTypes[type]?.[lang] ?? type;
}

/** 年份格式化：负数公元前；1000-1500 标公元；1500 以后直接数字 */
export function fmtYear(year: number, lang: Lang): string {
  if (year < 0) return lang === 'zh' ? `公元前 ${-year} 年` : `${-year} BCE`;
  if (year >= 1500) return String(year);
  return lang === 'zh' ? `公元 ${year} 年` : `AD ${year}`;
}
