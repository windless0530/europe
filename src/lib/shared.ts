// ============================================================
// 双端共享常量（Node 构建侧 + 浏览器前端）：
// 本文件必须保持零依赖（尤其不得 import node: 内置模块），
// 否则会随前端打包进浏览器。纯函数/纯常量先例：geojson-format.ts。
// contract.ts 对此处常量做 re-export，保持其对外接口不变。
//
// 枚举书写约定：每个枚举用一个「自引用对象」作唯一真实源——
// 键名 = 成员值、键序 = 迭代序/契约序；成员引用一律写 SOURCE.darmc、
// CAVEAT.disputed 这类成员访问，比较位/传参位不再出现裸字符串。
// 迭代列表由 Object.keys 派生（JS 对象字符串键保持插入序，跨引擎稳定）。
// Record 键位（titles: Record<SourceCode,…> 等）仍写字面量，由类型检查约束。
// ============================================================

/** 三个数据源的机器码（顺序 = 契约序 = 族群分布绘制序 = UI 分段序） */
export const SOURCE = { awmc: 'awmc', darmc: 'darmc', nuts: 'nuts' } as const;
export type SourceCode = keyof typeof SOURCE;
export const SOURCES: readonly SourceCode[] = Object.keys(SOURCE) as SourceCode[];

/** /config 不可用或缺失 source 字段时的默认数据源 */
export const DEFAULT_SOURCE: SourceCode = SOURCE.nuts;

/** 无时间维度数据源（如 NUTS）的「现代」年代值（时间轴 era 兜底） */
export const MODERN_ERA_YEAR = 2024;

/** region_geometry 规则类型（求值器见 src/frontend/region-map.ts matches） */
export const RULE_TYPE = {
  l0_country: 'l0_country',
  source_id: 'source_id',
  name_regex: 'name_regex',
  awmc_snapshot: 'awmc_snapshot',
} as const;
export type RuleType = keyof typeof RULE_TYPE;
export const RULE_TYPES: readonly RuleType[] = Object.keys(RULE_TYPE) as RuleType[];

/** 标注类型（须与 reference.json 的 enums.caveat_kind 成员一致；
 *  纹理/文案/优先级按成员分派，见 map.ts、main.ts、panel.ts） */
export const CAVEAT = { disputed: 'disputed', method: 'method' } as const;
export type CaveatKind = keyof typeof CAVEAT;
export const CAVEAT_KINDS: readonly CaveatKind[] = Object.keys(CAVEAT) as CaveatKind[];

/** 谱系从属关系（须与 reference.json 的 enums.classification_relation 成员一致） */
export const CLASSIFICATION = {
  member_of: 'member_of',
  associated_with: 'associated_with',
  descendant_of: 'descendant_of',
} as const;
export type ClassificationRelation = keyof typeof CLASSIFICATION;

/** NUTS 区划层级取值域：前端序数蓝色带下标/层级选择器与 nuts 管线
 *  （下载/规范化/校验）共用；2024 版四个层级的文件都在 30MB 预算内
 *  （原始共约 3MB），LEVL 3 一并纳入 */
export const NUTS_LEVELS = [0, 1, 2, 3] as const;

/** 欧洲参考 bbox（与 docs/data-contract.md 一致）：前端投影手动 fit、
 *  favicon 生成与 nuts 管线越界过滤共用同一范围 */
export const EUROPE_BBOX = { w: -31, s: 27, e: 45, n: 73 } as const;
/** 同一 bbox 的元组形态 [w, s, e, n]（nuts 管线 anyVertexInBbox 逐坐标比较用） */
export const EUROPE_BBOX_TUPLE: readonly [number, number, number, number] = [
  EUROPE_BBOX.w,
  EUROPE_BBOX.s,
  EUROPE_BBOX.e,
  EUROPE_BBOX.n,
];

/** 前端 enumLabel 引用的枚举字典名（须与 reference.json 的 enums keys 一致） */
export const ENUM_DEF = {
  presenceType: 'presence_type',
  relationType: 'relation_type',
  caveatKind: 'caveat_kind',
} as const;

// ------------------------------------------------------------
// 线格式约定：值由各 datasource 管线写进 regions.geojson 的
// source_props，由 src/frontend/load.ts 读取——两端必须保持一致。
// ------------------------------------------------------------

/** AWMC 数据集 id（写入端 src/datasources/awmc/config.ts 的 datasets[].id）：
 *  ethnonyms = Strabo 族群领地；roman_empire_* 前缀 = 帝国快照 */
export const AWMC_DATASET = { ethnonyms: 'ethnonyms', romanEmpirePrefix: 'roman_empire' } as const;

/** DARMC 层名前缀（写入端 src/datasources/darmc/catalog.ts 的 key：prov117 / kingdoms814 …） */
export const DARMC_LAYER_PREFIX = { provinces: 'prov', kingdoms: 'kingdoms' } as const;

/** source_props 中携带「数据集/层名」的键（写入端 awmc/darmc 的 normalize） */
export const SOURCE_PROPS = { awmcDataset: 'awmc_dataset', layer: 'layer', layerTitle: 'layer_title' } as const;

/** 规范化几何产物的仓库相对路径（构建/脚本 join(root, …)；浏览器端加前导 /） */
export const processedRegionsRel = (code: string): string => `data/geography/processed/${code}/regions.geojson`;
