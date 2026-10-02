// SQL region（粗粒度历史地理）-> 几何要素（三源细粒度）的人工映射表。
// 全部为「近似」：以现代国家组合或最接近的历史快照代表 SQL 中的历史区域，
// note 字段说明近似方式，后续可随时扩充/替换。

import type { RegionVm } from './load';
import type { SourceCode } from '../lib/contract.js';

export interface RegionGeomRule {
  source: SourceCode;
  test: (vm: RegionVm) => boolean;
}

export interface RegionGeomMapping {
  /** 近似方式说明（hover 面板展示） */
  note: string;
  rules: RegionGeomRule[];
}

/** 提取几何要素的国家码（NUTS 的 CNTR_CODE / GADM 的 GID_0 / L0 的 source_id） */
export function countryOf(vm: RegionVm): string | null {
  const sp = vm.feature.properties.source_props as Record<string, unknown>;
  for (const key of ['CNTR_CODE', 'GID_0']) {
    const v = sp[key];
    if (typeof v === 'string' && /^[A-Z]{2,3}$/.test(v)) return v;
  }
  if (vm.family === 'nuts' && vm.level === 0 && /^[A-Z]{2,3}$/.test(vm.sourceId)) return vm.sourceId;
  return null;
}

function nutsL0(codes: string[]): RegionGeomRule {
  const set = new Set(codes);
  return {
    source: 'nuts',
    test: (vm) => vm.family === 'nuts' && vm.level === 0 && countryOf(vm) !== null && set.has(countryOf(vm)!),
  };
}

/** 按规范化数据的原始要素 id 精确匹配（NUTS L1/L2 子区域、GADM 州级、英国构成国等）。 */
function nutsSourceIds(ids: string[]): RegionGeomRule {
  const set = new Set(ids);
  return {
    source: 'nuts',
    test: (vm) => set.has(vm.sourceId),
  };
}

/** 法国大区（NUTS L1）除布列塔尼外的 12 个 —— gaul/france/frankish_gaul 共用。 */
const FR_CORE_L1 = ['FR1', 'FRB', 'FRC', 'FRD', 'FRE', 'FRF', 'FRG', 'FRI', 'FRJ', 'FRK', 'FRL', 'FRM'];

const AFRICA_RE = /AFRICA|NUMIDIA|MAURETAN|AEGYPT|CYRENA|LIBYA|TRIPOLITAN|BYZACENA/i;

function darmcAfrica(): RegionGeomRule {
  return {
    source: 'darmc',
    test: (vm) => (vm.family === 'provinces') && AFRICA_RE.test(vm.nameEn ?? ''),
  };
}

export const REGION_GEOMETRY: Record<string, RegionGeomMapping> = {
  gaul: { note: '近似为法国（不含布列塔尼）+卢森堡', rules: [nutsSourceIds(FR_CORE_L1), nutsL0(['LU'])] },
  italy: { note: '近似为现代意大利', rules: [nutsL0(['IT'])] },
  balkans: { note: '近似为现代巴尔干诸国+希腊（Eurostat 希腊码为 EL、科索沃为 XK）', rules: [nutsL0(['SI', 'HR', 'BA', 'RS', 'ME', 'MK', 'AL', 'BG', 'EL', 'XK'])] },
  north_africa: { note: 'DARMC 罗马行省中的北非诸省', rules: [darmcAfrica()] },
  carpathian_basin: { note: '近似为现代匈牙利+斯洛伐克', rules: [nutsL0(['HU', 'SK'])] },
  roman_empire: {
    note: 'AWMC 罗马帝国 117 CE 快照范围',
    rules: [{ source: 'awmc', test: (vm) => vm.family === 'empire' && vm.snapshot === 117 }],
  },
  vandal_kingdom: { note: 'DARMC 北非行省近似（435-534 王国期）', rules: [darmcAfrica()] },
  europe: { note: '全图概念，无独立几何', rules: [] },
  central_europe: { note: '以奥地利+捷克近似中欧核心（德国已四分细分）', rules: [nutsL0(['AT', 'CZ'])] },
  eastern_europe: { note: '以现代白俄罗斯近似东欧历史活动空间（波/乌/罗已细分）', rules: [nutsL0(['BLR'])] },
  north_sea_coast: { note: '以荷兰+丹麦近似北海沿岸与日德兰（德国段已细分）', rules: [nutsL0(['NL', 'DK'])] },
  ireland_and_scotland: { note: '以现代爱尔兰与苏格兰构成国近似盖尔文化空间', rules: [nutsL0(['IE']), nutsSourceIds(['GBR.3_1'])] },
  lower_danube: { note: '以现代保加利亚近似多瑙河下游南岸（罗马尼亚已细分）', rules: [nutsL0(['BG'])] },
  england: { note: '以 GADM 英格兰构成国边界近似', rules: [nutsSourceIds(['GBR.1_1'])] },
  scotland: { note: '以 GADM 苏格兰构成国边界近似', rules: [nutsSourceIds(['GBR.3_1'])] },
  wales: { note: '以 GADM 威尔士构成国边界近似', rules: [nutsSourceIds(['GBR.4_1'])] },
  ireland: { note: '以现代爱尔兰国界近似', rules: [nutsL0(['IE'])] },
  france: { note: '以法国大区近似（不含布列塔尼，NUTS L1 ×12）', rules: [nutsSourceIds(FR_CORE_L1)] },
  austria: { note: '以现代奥地利国界近似', rules: [nutsL0(['AT'])] },
  netherlands: { note: '以现代荷兰国界近似', rules: [nutsL0(['NL'])] },
  denmark: { note: '以现代丹麦国界近似', rules: [nutsL0(['DK'])] },
  sweden: { note: '以瑞典 NUTS L2（除萨普米两区）近似', rules: [nutsSourceIds(['SE11', 'SE12', 'SE21', 'SE22', 'SE23', 'SE31'])] },
  norway: { note: '以挪威 NUTS L2（除北角）近似', rules: [nutsSourceIds(['NO02', 'NO06', 'NO08', 'NO09', 'NO0A', 'NO0B'])] },
  portugal: { note: '以现代葡萄牙国界近似', rules: [nutsL0(['PT'])] },
  romania: { note: '以罗马尼亚 NUTS L2（除特兰西瓦尼亚两区）近似', rules: [nutsSourceIds(['RO21', 'RO22', 'RO31', 'RO32', 'RO41', 'RO42'])] },
  poland: { note: '以波兰核心省（NUTS L2 ×10）近似', rules: [nutsSourceIds(['PL21', 'PL41', 'PL61', 'PL71', 'PL72', 'PL81', 'PL82', 'PL84', 'PL91', 'PL92'])] },
  czechia: { note: '以现代捷克国界近似', rules: [nutsL0(['CZ'])] },
  slovakia: { note: '以现代斯洛伐克国界近似', rules: [nutsL0(['SK'])] },
  serbia: { note: '以现代塞尔维亚国界近似', rules: [nutsL0(['RS'])] },
  croatia: { note: '以现代克罗地亚国界近似', rules: [nutsL0(['HR'])] },
  slovenia: { note: '以现代斯洛文尼亚国界近似', rules: [nutsL0(['SI'])] },
  bulgaria: { note: '以现代保加利亚国界近似', rules: [nutsL0(['BG'])] },
  greece: { note: '以现代希腊国界近似', rules: [nutsL0(['EL'])] },
  albania: { note: '以现代阿尔巴尼亚国界近似', rules: [nutsL0(['AL'])] },
  hungary: { note: '以现代匈牙利国界近似', rules: [nutsL0(['HU'])] },
  ukraine: { note: '以乌克兰中部/东部各州（GADM L1 ×18）近似', rules: [nutsSourceIds(['UKR.1_1', 'UKR.2_1', 'UKR.5_1', 'UKR.6_1', 'UKR.8_1', 'UKR.9_1', 'UKR.10_1', 'UKR.11_1', 'UKR.12_1', 'UKR.13_1', 'UKR.15_1', 'UKR.16_1', 'UKR.17_1', 'UKR.18_1', 'UKR.21_1', 'UKR.24_1', 'UKR.26_1', 'UKR.27_1'])] },
  belarus: { note: '以现代白俄罗斯国界近似', rules: [nutsL0(['BLR'])] },
  russia: { note: '以 GADM 俄罗斯国界近似（视图范围主要展示欧洲部分）', rules: [nutsL0(['RUS'])] },
  latvia: { note: '以现代拉脱维亚国界近似', rules: [nutsL0(['LV'])] },
  lithuania: { note: '以现代立陶宛国界近似', rules: [nutsL0(['LT'])] },
  estonia: { note: '以现代爱沙尼亚国界近似', rules: [nutsL0(['EE'])] },
  finland: { note: '以现代芬兰国界近似', rules: [nutsL0(['FI'])] },
  georgia: { note: '以 GADM 格鲁吉亚国界近似', rules: [nutsL0(['GEO'])] },
  armenia: { note: '以 GADM 亚美尼亚国界近似', rules: [nutsL0(['ARM'])] },
  azerbaijan: { note: '以 GADM 阿塞拜疆国界近似', rules: [nutsL0(['AZE'])] },

  // ---- 次国家级细分（2026-10-03 补丁 3：语言/族群断层线，非行政区划下钻） ----
  flanders: { note: '比利时弗拉芒大区（NUTS L1 BE2，荷兰语区）', rules: [nutsSourceIds(['BE2'])] },
  wallonia: { note: '瓦隆大区+布鲁塞尔首府区（BE1+BE3，法语区近似）', rules: [nutsSourceIds(['BE1', 'BE3'])] },
  switzerland_west: { note: '瑞士法语区（NUTS L2 CH01 莱芒湖区近似）', rules: [nutsSourceIds(['CH01'])] },
  switzerland_east: { note: '瑞士德语区（CH02–06；罗曼什谷地并入近似）', rules: [nutsSourceIds(['CH02', 'CH03', 'CH04', 'CH05', 'CH06'])] },
  ticino: { note: '瑞士意大利语区（提契诺州 CH07）', rules: [nutsSourceIds(['CH07'])] },
  andalusia: { note: '安达卢西亚+穆尔西亚（ES61/62/63/64，安达卢斯核心）', rules: [nutsSourceIds(['ES61', 'ES62', 'ES63', 'ES64'])] },
  castile: { note: '卡斯蒂利亚（含阿斯图里亚斯/马德里/加那利等，ES L2 ×8）', rules: [nutsSourceIds(['ES12', 'ES13', 'ES23', 'ES30', 'ES41', 'ES42', 'ES43', 'ES70'])] },
  catalonia: { note: '加泰罗尼亚+阿拉贡+巴伦西亚+巴利阿里（阿拉贡王冠，ES L2 ×4）', rules: [nutsSourceIds(['ES24', 'ES51', 'ES52', 'ES53'])] },
  galicia: { note: '加利西亚（ES11，斯维汇王国核心区）', rules: [nutsSourceIds(['ES11'])] },
  basque_country: { note: '巴斯克自治州+纳瓦拉（ES21/22，瓦斯科尼亞）', rules: [nutsSourceIds(['ES21', 'ES22'])] },
  brittany: { note: '布列塔尼（NUTS L1 FRH，阿莫里卡半岛）', rules: [nutsSourceIds(['FRH'])] },
  silesia_pomerania: { note: '西里西亚-波美拉尼亚（PL22/42/43/51/52/63，收复领土）', rules: [nutsSourceIds(['PL22', 'PL42', 'PL43', 'PL51', 'PL52', 'PL63'])] },
  masuria: { note: '马祖里/东普鲁士故地（PL62）', rules: [nutsSourceIds(['PL62'])] },
  galicia_volhynia: { note: '加利西亚-沃里尼亚（乌克兰西部 7 州 GADM 近似）', rules: [nutsSourceIds(['UKR.3_1', 'UKR.7_1', 'UKR.14_1', 'UKR.19_1', 'UKR.22_1', 'UKR.23_1', 'UKR.25_1'])] },
  crimea: { note: '克里米亚半岛（克里米亚+塞瓦斯托波尔州）', rules: [nutsSourceIds(['UKR.4_1', 'UKR.20_1'])] },
  transylvania: { note: '特兰西瓦尼亚（NUTS L2 RO11/12 近似）', rules: [nutsSourceIds(['RO11', 'RO12'])] },
  samiland: { note: '萨普米（挪威北角 NO07 + 瑞典上/中诺尔兰 SE32/33；芬兰拉普兰暂并入芬兰近似）', rules: [nutsSourceIds(['NO07', 'SE32', 'SE33'])] },

  // ---- 补丁 5（2026-10-05）：德国四分 + 潘诺尼亚/巴尔干细分 ----
  old_saxony: { note: '旧萨克森（德国西北 NUTS L2 ×11：石荷/不来梅/汉堡/梅克伦堡/下萨克森/威斯特法伦三区）', rules: [nutsSourceIds(['DEF0', 'DE50', 'DE60', 'DE80', 'DE91', 'DE92', 'DE93', 'DE94', 'DEA3', 'DEA4', 'DEA5'])] },
  swabia_francia: { note: '施瓦本-法兰克（德国西南 NUTS L2 ×13：巴符/黑森/莱茵兰/莱法/萨尔）', rules: [nutsSourceIds(['DE11', 'DE12', 'DE13', 'DE14', 'DE71', 'DE72', 'DE73', 'DEA1', 'DEA2', 'DEB1', 'DEB2', 'DEB3', 'DEC0'])] },
  thuringia_lausitz: { note: '图林根-劳西茨（德国中东部 NUTS L2 ×7：柏林/勃兰登堡/萨克森/萨安/图林根）', rules: [nutsSourceIds(['DE30', 'DE40', 'DED2', 'DED4', 'DED5', 'DEE0', 'DEG0'])] },
  bavaria: { note: '巴伐利亚（德国东南，拜恩自由州 NUTS L2 ×7）', rules: [nutsSourceIds(['DE21', 'DE22', 'DE23', 'DE24', 'DE25', 'DE26', 'DE27'])] },
  pannonia: { note: '潘诺尼亚（以现代匈牙利国界近似罗马行省-匈人-格皮德范围）', rules: [nutsL0(['HU'])] },
  bosnia: { note: '波斯尼亚和黑塞哥维那', rules: [nutsL0(['BA'])] },
  macedonia: { note: '北马其顿', rules: [nutsL0(['MK'])] },
  montenegro: { note: '黑山', rules: [nutsL0(['ME'])] },
};

/** 把映射规则应用到已加载的几何 VM：
 *  byRegion: sqlRegion -> geometry codes；byGeometry: geometry code -> 候选 sqlRegions（可多个） */
export function resolveRegionGeometry(features: RegionVm[]): {
  byRegion: Map<string, string[]>;
  byGeometry: Map<string, string[]>;
} {
  const byRegion = new Map<string, string[]>();
  const byGeometry = new Map<string, string[]>();
  for (const [regionCode, mapping] of Object.entries(REGION_GEOMETRY)) {
    const codes = features
      .filter((vm) => {
        const source = vm.code.split(':')[0] as SourceCode;
        return mapping.rules.some((r) => r.source === source && r.test(vm));
      })
      .map((vm) => vm.code);
    byRegion.set(regionCode, codes);
    for (const code of codes) {
      const list = byGeometry.get(code) ?? [];
      list.push(regionCode);
      byGeometry.set(code, list);
    }
  }
  return { byRegion, byGeometry };
}
