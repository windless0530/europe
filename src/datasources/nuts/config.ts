// ============================================================
// NUTS loader 共享配置
// 数据源：
//   1. Eurostat GISCO NUTS 2024，RG 边界、1:20M、EPSG:4326、LEVL 0-3
//      （2024 版首次纳入 UA / XK / BA，英国因脱欧自 NUTS 2021 起移除）
//   2. GADM 4.1 admin0/admin1，补齐 NUTS 未覆盖的地理欧洲国家，
//      以及 NUTS 2024 只有 LEVL 0 的乌克兰的省级行政区
// ============================================================

/** NUTS 版本年份（vintage，进 source_props.vintage，start/end 留 null） */
export const NUTS_YEAR = 2024;

const GISCO_BASE = 'https://gisco-services.ec.europa.eu/distribution/v2/nuts';

/** 2024 版四个层级的文件都在 30MB 预算内（原始共约 3MB），LEVL 3 一并纳入 */
export const NUTS_LEVELS = [0, 1, 2, 3] as const;

export function nutsFileName(level: number): string {
  return `NUTS_RG_20M_${NUTS_YEAR}_4326_LEVL_${level}.geojson`;
}

export function nutsUrl(level: number): string {
  return `${GISCO_BASE}/geojson/${nutsFileName(level)}`;
}

// ------------------------------------------------------------
// GADM 4.1 补齐清单
// ------------------------------------------------------------
export const GADM_VERSION = '4.1';
const GADM_BASE = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json';

export interface GadmCountrySpec {
  /** GADM 大写 ISO3 */
  iso3: string;
  /** 需要下载的 GADM 层级（0=国界用于自建 level0 要素，1=admin1） */
  levels: number[];
  /**
   * admin1 要素的 parent_code。默认 `nuts:${slugify(iso3)}`（即本清单自建的
   * 国家级要素）；乌克兰例外——NUTS 2024 已有 UA LEVL 0，指向它。
   */
  parentOverride?: string;
  note?: string;
}

/**
 * 地理欧洲中 NUTS 2024 未覆盖（或仅国家级）的国家：
 *   GBR 脱欧后移出 NUTS；MDA/BLR/RUS 从不在 NUTS；
 *   AND/MCO/SMR/VAT 微型国家不在 NUTS；FRO 法罗群岛不在 NUTS；
 *   UKR 在 NUTS 2024 仅有 LEVL 0，admin1（州）用 GADM 补。
 * 为覆盖数据库中的格鲁吉亚人、亚美尼亚人和阿塞拜疆人，高加索三国补 L0；
 * 它们只作为现代空间代理，不改变欧洲主体数据的层级范围。
 */
export const GADM_COUNTRIES: GadmCountrySpec[] = [
  { iso3: 'GBR', levels: [0, 1], note: 'UK：脱欧后不在 NUTS' },
  { iso3: 'MDA', levels: [0, 1] },
  { iso3: 'BLR', levels: [0, 1] },
  { iso3: 'RUS', levels: [0, 1], note: 'admin1 按 Europe bbox 顶点过滤，仅保留欧洲部分州/边疆区/共和国' },
  { iso3: 'AND', levels: [0, 1] },
  { iso3: 'MCO', levels: [0], note: 'GADM 无 admin1（市镇为 level 2），仅国家级要素' },
  { iso3: 'SMR', levels: [0, 1] },
  { iso3: 'VAT', levels: [0], note: 'GADM 无 admin1，仅国家级要素' },
  { iso3: 'FRO', levels: [0, 1], note: '法罗群岛（丹麦自治领），不在 NUTS' },
  { iso3: 'UKR', levels: [1], parentOverride: 'nuts:ua', note: 'NUTS 2024 有 UA LEVL 0；admin1 补州级' },
  { iso3: 'GEO', levels: [0], note: '高加索空间代理，仅国家级' },
  { iso3: 'ARM', levels: [0], note: '高加索空间代理，仅国家级' },
  { iso3: 'AZE', levels: [0], note: '高加索空间代理，仅国家级' },
];

export function gadmFileName(iso3: string, level: number): string {
  return `gadm${GADM_VERSION.replace(/\./g, '')}_${iso3}_${level}.json.zip`;
}

export function gadmUrl(iso3: string, level: number): string {
  return `${GADM_BASE}/${gadmFileName(iso3, level)}`;
}

// ------------------------------------------------------------
// 欧洲参考范围（与 docs/data-contract.md 一致）
// ------------------------------------------------------------
export const EUROPE_BBOX: readonly [number, number, number, number] = [-31, 27, 45, 73];

/**
 * GADM 名称字段修正：GADM 的 JSON 导出把空格剥掉了
 * （"NorthernIreland"、"UnitedKingdom"、"St.Petersburg"）。
 * 这里做保守的机械恢复（小写→大写边界插入空格、句点后补空格），
 * 原始值仍完整保留在 source_props 中。
 */
export function restoreGadmSpaces(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input === 'NA' || input === '?') return null;
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\.(?=[A-Za-z])/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 已知 GADM 数据缺陷的名称修正表：
 * GBR.1_1 的 NAME_1 缺失（"NA"），但几何与 TYPE_1（ConstituentCountry）
 * 无歧义对应英格兰（GBR.2/3/4 分别为北爱/苏格兰/威尔士）。
 */
export const NAME_OVERRIDES: Record<string, string> = {
  'GBR.1_1': 'England',
};

/** manifest / README 用到的 license 文案 */
export const LICENSE_NUTS =
  'Eurostat GISCO / NUTS：欧盟委员会再利用政策（Commission Decision 2011/833/EU），注明出处即可自由再利用';
export const LICENSE_NUTS_URL = 'https://ec.europa.eu/eurostat/web/main/about/policies/copyright';
export const LICENSE_GADM =
  'GADM 4.1：学术与非商业使用免费；禁止再分发与商业使用（需另行授权）';
export const LICENSE_GADM_URL = 'https://gadm.org/license.html';
