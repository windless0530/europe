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
function countryOf(vm: RegionVm): string | null {
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

/** 按规范化数据的原始要素 id 精确匹配（用于英国构成国等 L1 几何）。 */
function nutsSourceIds(ids: string[]): RegionGeomRule {
  const set = new Set(ids);
  return {
    source: 'nuts',
    test: (vm) => set.has(vm.sourceId),
  };
}

const AFRICA_RE = /AFRICA|NUMIDIA|MAURETAN|AEGYPT|CYRENA|LIBYA|TRIPOLITAN|BYZACENA/i;

function darmcAfrica(): RegionGeomRule {
  return {
    source: 'darmc',
    test: (vm) => (vm.family === 'provinces') && AFRICA_RE.test(vm.nameEn ?? ''),
  };
}

export const REGION_GEOMETRY: Record<string, RegionGeomMapping> = {
  iberian_peninsula: { note: '近似为现代西班牙+葡萄牙', rules: [nutsL0(['ES', 'PT'])] },
  gaul: { note: '近似为现代法国+比利时+卢森堡', rules: [nutsL0(['FR', 'BE', 'LU'])] },
  britannia: { note: '近似为大不列颠岛（GADM 英国 L0）', rules: [nutsL0(['GBR'])] },
  italy: { note: '近似为现代意大利', rules: [nutsL0(['IT'])] },
  balkans: { note: '近似为现代巴尔干诸国+希腊（Eurostat 希腊码为 EL）', rules: [nutsL0(['SI', 'HR', 'BA', 'RS', 'ME', 'MK', 'AL', 'BG', 'EL'])] },
  north_africa: { note: 'DARMC 罗马行省中的北非诸省', rules: [darmcAfrica()] },
  carpathian_basin: { note: '近似为现代匈牙利+斯洛伐克', rules: [nutsL0(['HU', 'SK'])] },
  roman_empire: {
    note: 'AWMC 罗马帝国 117 CE 快照范围',
    rules: [{ source: 'awmc', test: (vm) => vm.family === 'empire' && vm.snapshot === 117 }],
  },
  visigothic_kingdom: { note: '近似为现代西班牙+葡萄牙（伊比利亚核心期）', rules: [nutsL0(['ES', 'PT'])] },
  ostrogothic_kingdom: { note: '近似为现代意大利（493-553 王国期）', rules: [nutsL0(['IT'])] },
  vandal_kingdom: { note: 'DARMC 北非行省近似（435-534 王国期）', rules: [darmcAfrica()] },
  frankish_gaul: { note: '近似为现代法比卢+荷兰+德国（法兰克扩张期）', rules: [nutsL0(['FR', 'BE', 'LU', 'NL', 'DE'])] },
  europe: { note: '全图概念，无独立几何', rules: [] },
  central_europe: { note: '以现代德国+奥地利+捷克+波兰近似中欧历史活动空间', rules: [nutsL0(['DE', 'AT', 'CZ', 'PL'])] },
  eastern_europe: { note: '以现代波兰+乌克兰+白俄罗斯+罗马尼亚近似东欧历史活动空间', rules: [nutsL0(['PL', 'UA', 'BLR', 'RO'])] },
  north_sea_coast: { note: '以现代德国+荷兰+丹麦近似北海沿岸与日德兰', rules: [nutsL0(['DE', 'NL', 'DK'])] },
  ireland_and_scotland: { note: '以现代爱尔兰与苏格兰构成国近似盖尔文化空间', rules: [nutsL0(['IE']), nutsSourceIds(['GBR.3_1'])] },
  lower_danube: { note: '以现代罗马尼亚+保加利亚近似多瑙河下游', rules: [nutsL0(['RO', 'BG'])] },
  england: { note: '以 GADM 英格兰构成国边界近似', rules: [nutsSourceIds(['GBR.1_1'])] },
  scotland: { note: '以 GADM 苏格兰构成国边界近似', rules: [nutsSourceIds(['GBR.3_1'])] },
  wales: { note: '以 GADM 威尔士构成国边界近似', rules: [nutsSourceIds(['GBR.4_1'])] },
  ireland: { note: '以现代爱尔兰国界近似', rules: [nutsL0(['IE'])] },
  france: { note: '以现代法国国界近似', rules: [nutsL0(['FR'])] },
  germany: { note: '以现代德国国界近似', rules: [nutsL0(['DE'])] },
  netherlands: { note: '以现代荷兰国界近似', rules: [nutsL0(['NL'])] },
  denmark: { note: '以现代丹麦国界近似', rules: [nutsL0(['DK'])] },
  sweden: { note: '以现代瑞典国界近似', rules: [nutsL0(['SE'])] },
  norway: { note: '以现代挪威国界近似', rules: [nutsL0(['NO'])] },
  spain: { note: '以现代西班牙国界近似', rules: [nutsL0(['ES'])] },
  portugal: { note: '以现代葡萄牙国界近似', rules: [nutsL0(['PT'])] },
  romania: { note: '以现代罗马尼亚国界近似', rules: [nutsL0(['RO'])] },
  poland: { note: '以现代波兰国界近似', rules: [nutsL0(['PL'])] },
  czechia: { note: '以现代捷克国界近似', rules: [nutsL0(['CZ'])] },
  slovakia: { note: '以现代斯洛伐克国界近似', rules: [nutsL0(['SK'])] },
  serbia: { note: '以现代塞尔维亚国界近似', rules: [nutsL0(['RS'])] },
  croatia: { note: '以现代克罗地亚国界近似', rules: [nutsL0(['HR'])] },
  slovenia: { note: '以现代斯洛文尼亚国界近似', rules: [nutsL0(['SI'])] },
  bulgaria: { note: '以现代保加利亚国界近似', rules: [nutsL0(['BG'])] },
  greece: { note: '以现代希腊国界近似', rules: [nutsL0(['EL'])] },
  albania: { note: '以现代阿尔巴尼亚国界近似', rules: [nutsL0(['AL'])] },
  hungary: { note: '以现代匈牙利国界近似', rules: [nutsL0(['HU'])] },
  ukraine: { note: '以现代乌克兰国界近似', rules: [nutsL0(['UA'])] },
  belarus: { note: '以现代白俄罗斯国界近似', rules: [nutsL0(['BLR'])] },
  russia: { note: '以 GADM 俄罗斯国界近似（视图范围主要展示欧洲部分）', rules: [nutsL0(['RUS'])] },
  latvia: { note: '以现代拉脱维亚国界近似', rules: [nutsL0(['LV'])] },
  lithuania: { note: '以现代立陶宛国界近似', rules: [nutsL0(['LT'])] },
  estonia: { note: '以现代爱沙尼亚国界近似', rules: [nutsL0(['EE'])] },
  finland: { note: '以现代芬兰国界近似', rules: [nutsL0(['FI'])] },
  georgia: { note: '以 GADM 格鲁吉亚国界近似', rules: [nutsL0(['GEO'])] },
  armenia: { note: '以 GADM 亚美尼亚国界近似', rules: [nutsL0(['ARM'])] },
  azerbaijan: { note: '以 GADM 阿塞拜疆国界近似', rules: [nutsL0(['AZE'])] },
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
