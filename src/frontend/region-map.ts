// SQL region（粗粒度历史地理）-> 几何要素（三源细粒度）映射的规则求值器。
// 规则本体存于 DB 的 region_geometry_rule 表（01/02 SQL 装载），经
// atlas.json 的 region_geometry 段下发；此处只实现四类规则语义。
// 全部为「近似」映射：以现代国家组合或最接近的历史快照代表 SQL 中的
// 历史区域，note 字段说明近似方式，后续可随时扩充/替换。

import type { RegionVm } from './load';
import type { SourceCode } from '../lib/contract.js';

/** region_geometry_rule 行（src/build/project.ts 投影导出，字段与源格式一一对应） */
export interface RegionGeometryRule {
  region_code: string;
  source_code: SourceCode;
  rule_type: 'l0_country' | 'source_id' | 'name_regex' | 'awmc_snapshot';
  /** l0_country/source_id：码点集合；name_regex/awmc_snapshot：单值（regex 文本 / 快照年份） */
  match_values: string[];
  note: string | null;
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

function matches(rule: RegionGeometryRule, vm: RegionVm): boolean {
  switch (rule.rule_type) {
    case 'l0_country': {
      // 现代国家 L0（NUTS CNTR_CODE / GADM GID_0，如 italy = ['IT']、balkans = 10 国）
      const cc = countryOf(vm);
      return vm.family === 'nuts' && vm.level === 0 && cc !== null && rule.match_values.includes(cc);
    }
    case 'source_id':
      // 按规范化数据的原始要素 id 精确匹配（NUTS L1/L2 子区域、GADM 州级、英国构成国等）
      return rule.match_values.includes(vm.sourceId);
    case 'name_regex':
      // DARMC 行省拉丁名正则（不区分大小写，如北非诸省）
      return vm.family === 'provinces' && new RegExp(rule.match_values[0] ?? '', 'i').test(vm.nameEn ?? '');
    case 'awmc_snapshot':
      // AWMC 帝国快照年份（如罗马帝国 117 CE）
      return vm.family === 'empire' && vm.snapshot === Number(rule.match_values[0]);
  }
}

/** 把映射规则应用到已加载的几何 VM：
 *  byRegion: sqlRegion -> geometry codes；byGeometry: geometry code -> 候选 sqlRegions（可多个）。
 *  规则顺序 = 导出顺序（region_geometry_rule.id），决定 byGeometry 候选次序（hover 兜底用）。 */
export function resolveRegionGeometry(features: RegionVm[], rules: RegionGeometryRule[]): {
  byRegion: Map<string, string[]>;
  byGeometry: Map<string, string[]>;
} {
  const rulesByRegion = new Map<string, RegionGeometryRule[]>();
  for (const rule of rules) {
    const list = rulesByRegion.get(rule.region_code) ?? [];
    list.push(rule);
    rulesByRegion.set(rule.region_code, list);
  }
  const byRegion = new Map<string, string[]>();
  const byGeometry = new Map<string, string[]>();
  for (const [regionCode, rs] of rulesByRegion) {
    const codes = features
      .filter((vm) => {
        const source = vm.code.split(':')[0] as SourceCode;
        return rs.some((r) => r.source_code === source && matches(r, vm));
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
