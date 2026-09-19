// ============================================================
// AWMC loader · 数据集清单与常量
// 数据源：Ancient World Mapping Center (UNC Chapel Hill) geodata 仓库
// https://github.com/AWMC/geodata （官网入口 https://awmc.unc.edu/gis-data/）
//
// 仓库提供两类发布物：
//  1. Cultural-Data/ 下逐数据集的 GeoJSON（README 声明"most up-to-date"）
//  2. "Cultural Shapefiles Apr 2024.zip"（ESRI shapefile 打包，是 GeoJSON
//     目录的超集：多出 ad_14/ad_69/314 范围、ethnonyms、ba_100 行省等）
// 两处均为 WGS84 (EPSG:4326)，无需投影转换。
// ============================================================

export const GEODATA_BASE = 'https://raw.githubusercontent.com/AWMC/geodata/master';
export const SOURCE_URL = 'https://github.com/AWMC/geodata';
export const SOURCE_HOMEPAGE = 'https://awmc.unc.edu/gis-data/';
export const LICENSE = 'ODC Open Database License (ODbL) v1.0';
export const LICENSE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';
/** 仓库 README 的 License 原文（2026-09 检索） */
export const LICENSE_NOTE =
  'The GeoJson files are offered under the ODC Open Database License (http://opendatacommons.org/licenses/odbl/1.0/). ' +
  'Data is derived from the Barrington Atlas of the Greek and Roman World, and uses AWMC modifications to ' +
  'OpenStreetMap (https://www.openstreetmap.org/), which is under the ODC Open Database License.';

// ------------------------------------------------------------
// 直接下载的 GeoJSON / 文档文件（相对 data/raw/awmc/ 的文件名）
// ------------------------------------------------------------
export interface DirectFile {
  dest: string;
  url: string;
  label: string;
}

export const GEOJSON_FILES: DirectFile[] = [
  {
    dest: 'roman_empire_bce_60.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/roman_empire_bce_60/roman_empire_bce_60.geojson`,
    label: 'Roman Empire 60 BCE extent',
  },
  {
    dest: 'roman_empire_ce_117_extent.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/roman_empire_ce_117_extent/roman_empire_ce_117_extent.geojson`,
    label: 'Roman Empire 117 CE extent',
  },
  {
    dest: 'roman_empire_ce_200_extent.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/roman_empire_ce_200_extent/roman_empire_ce_200_extent.geojson`,
    label: 'Roman Empire 200 CE extent',
  },
  {
    dest: 'alexanders_empire.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/alexanders_empire/alexanders_empire.geojson`,
    label: "Alexander's empire",
  },
  {
    dest: 'extent_of_the_persian_empire.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/persian_extent/extent_of_the_persian_empire.geojson`,
    label: 'Persian empire extent',
  },
  {
    dest: 'hasmonean_kingdom.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/hasmonean/hasmonean_kingdom.geojson`,
    label: 'Hasmonean kingdom',
  },
  {
    dest: 'herods_kingdom.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/herod/herods_kingdom.geojson`,
    label: "Herod's kingdom",
  },
  {
    dest: 'roman_senatorial_provinces.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/senatorial_province/roman_senatorial_provinces.geojson`,
    label: 'Roman senatorial provinces',
  },
  {
    dest: 'roman_empire_ce_200_provinces.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/roman_empire_ce_200_provinces/roman_empire_ce_200_provinces.geojson`,
    label: 'Roman Empire 200 CE provinces (linework)',
  },
  {
    dest: 'roman_empire_provinces_post_diocletian.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/political_shading/roman_empire_provinces%20post_diocletian/roman_empire_provinces%20post_diocletian.geojson`,
    label: 'Roman provinces post-Diocletian (linework)',
  },
  {
    dest: 'urban_areas.geojson',
    url: `${GEODATA_BASE}/Cultural-Data/urban_areas/urban_areas.geojson`,
    label: 'Urban areas (footprints)',
  },
  // 溯源文档
  { dest: 'LICENSE.txt', url: `${GEODATA_BASE}/LICENSE.txt`, label: 'LICENSE (ODbL full text)' },
  { dest: 'upstream_README.md', url: `${GEODATA_BASE}/README.md`, label: 'Upstream README' },
  {
    dest: 'upstream_attribute_information.md',
    url: `${GEODATA_BASE}/attribute_information.md`,
    label: 'Upstream attribute docs',
  },
];

export const SHAPEFILES_ZIP: DirectFile & { extractDir: string } = {
  dest: 'cultural_shapefiles_apr_2024.zip',
  url: `${GEODATA_BASE}/Cultural%20Shapefiles%20Apr%202024.zip`,
  label: 'Cultural Shapefiles Apr 2024 (zip archive)',
  extractDir: 'cultural_shapefiles_apr_2024',
};

// ------------------------------------------------------------
// 面状区域数据集（regions.geojson）
//  - mode='dissolve'：整份数据集的所有多边形碎片合并为 1 个 MultiPolygon
//    要素（"帝国范围"类原始数据无名称属性，碎片本身不构成独立区域）
//  - mode='per_feature'：每个原始要素一个区域（ethnonyms，带 en_name）
// ------------------------------------------------------------
export type RegionMode = 'dissolve' | 'per_feature';

export interface RegionDataset {
  id: string;
  /** raw 目录内路径（不含扩展名；geojson 含 .geojson） */
  file: string;
  format: 'geojson' | 'shapefile';
  mode: RegionMode;
  name_en: string | null;
  region_type: 'political_entity' | 'historical_region' | 'cultural_region';
  /** 数据集名称中明确给出的快照年份；未给出为 null（不编造） */
  snapshot_year: number | null;
}

export const REGION_DATASETS: RegionDataset[] = [
  {
    id: 'roman_empire_60_bce',
    file: 'roman_empire_bce_60.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: 'Roman Empire (60 BCE)',
    region_type: 'political_entity',
    snapshot_year: -60,
  },
  {
    id: 'roman_empire_14_ce',
    file: 'cultural_shapefiles_apr_2024/political_shading/roman_empire_ad_14_extent/roman_empire_ad_14_extent',
    format: 'shapefile',
    mode: 'dissolve',
    name_en: 'Roman Empire (14 CE)',
    region_type: 'political_entity',
    snapshot_year: 14,
  },
  {
    id: 'roman_empire_69_ce',
    file: 'cultural_shapefiles_apr_2024/political_shading/roman_empire_ad_69_extent/roman_empire_ad_69_extent',
    format: 'shapefile',
    mode: 'dissolve',
    name_en: 'Roman Empire (69 CE)',
    region_type: 'political_entity',
    snapshot_year: 69,
  },
  {
    id: 'roman_empire_117_ce',
    file: 'roman_empire_ce_117_extent.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: 'Roman Empire (117 CE, greatest extent)',
    region_type: 'political_entity',
    snapshot_year: 117,
  },
  {
    id: 'roman_empire_200_ce',
    file: 'roman_empire_ce_200_extent.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: 'Roman Empire (200 CE)',
    region_type: 'political_entity',
    snapshot_year: 200,
  },
  {
    id: 'roman_empire_314_ce',
    file: 'cultural_shapefiles_apr_2024/political_shading/roman_empire_ad_200_extent/roman_empire_diocletian_and_Constantine_314_extent',
    format: 'shapefile',
    mode: 'dissolve',
    name_en: 'Roman Empire under Diocletian and Constantine (314 CE)',
    region_type: 'political_entity',
    snapshot_year: 314,
  },
  {
    id: 'alexanders_empire',
    file: 'alexanders_empire.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: 'Empire of Alexander the Great',
    region_type: 'political_entity',
    snapshot_year: null,
  },
  {
    id: 'achaemenid_persian_empire',
    file: 'extent_of_the_persian_empire.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: 'Achaemenid Persian Empire',
    region_type: 'political_entity',
    snapshot_year: null,
  },
  {
    id: 'hasmonean_kingdom',
    file: 'hasmonean_kingdom.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: 'Hasmonean Kingdom',
    region_type: 'political_entity',
    snapshot_year: null,
  },
  {
    id: 'herods_kingdom',
    file: 'herods_kingdom.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: "Kingdom of Herod the Great",
    region_type: 'political_entity',
    snapshot_year: null,
  },
  {
    id: 'roman_senatorial_provinces',
    file: 'roman_senatorial_provinces.geojson',
    format: 'geojson',
    mode: 'dissolve',
    name_en: 'Roman Senatorial Provinces (set)',
    region_type: 'political_entity',
    snapshot_year: null,
  },
  {
    id: 'italy',
    file: 'cultural_shapefiles_apr_2024/political_shading/Italy_shading/Italy_shading',
    format: 'shapefile',
    mode: 'dissolve',
    name_en: 'Italy (wall-map shading)',
    region_type: 'historical_region',
    snapshot_year: null,
  },
  {
    id: 'ethnonyms',
    file: 'cultural_shapefiles_apr_2024/ethnonyms/ethnonyms',
    format: 'shapefile',
    mode: 'per_feature',
    /** 每要素名称取原始属性 en_name（Strabo《地理学》族群名） */
    name_en: null,
    region_type: 'cultural_region',
    snapshot_year: null,
  },
];

// ------------------------------------------------------------
// 线状数据集（lines.geojson）：各年份罗马行省边界 linework。
// 原始发布即 arc 节点线（非多边形），构面尝试见 README open_issues。
// ------------------------------------------------------------
export interface LineDataset {
  id: string;
  file: string;
  format: 'geojson' | 'shapefile';
  name_en: string;
  snapshot_year: number | null;
}

export const LINE_DATASETS: LineDataset[] = [
  {
    id: 'roman_provinces_60_bce',
    file: 'cultural_shapefiles_apr_2024/political_shading/roman_empire_60_bc_provinces/roman_empire_60_bc_provinces',
    format: 'shapefile',
    name_en: 'Roman provincial boundaries (60 BCE)',
    snapshot_year: -60,
  },
  {
    id: 'roman_provinces_14_ce',
    file: 'cultural_shapefiles_apr_2024/political_shading/roman_empire_ad_14_provinces/roman_empire_ad_14_provinces',
    format: 'shapefile',
    name_en: 'Roman provincial boundaries (14 CE)',
    snapshot_year: 14,
  },
  {
    id: 'roman_provinces_69_ce',
    file: 'cultural_shapefiles_apr_2024/political_shading/roman_empire_ad_69_provinces/roman_empire_ad_69_provinces',
    format: 'shapefile',
    name_en: 'Roman provincial boundaries (69 CE)',
    snapshot_year: 69,
  },
  {
    id: 'roman_empire_around_75_ce',
    file: 'cultural_shapefiles_apr_2024/political_shading/Roman_Empire_Around_AD_75/Roman_Empire_Around_AD_75',
    format: 'shapefile',
    name_en: 'Roman Empire boundary (around 75 CE)',
    snapshot_year: 75,
  },
  {
    id: 'roman_provinces_100_ce_ba',
    file: 'cultural_shapefiles_apr_2024/political_shading/ba_100_provinces/ba_100_provinces',
    format: 'shapefile',
    name_en: 'Roman provincial boundaries, Barrington Atlas 100 CE',
    snapshot_year: 100,
  },
  {
    id: 'roman_provinces_200_ce',
    file: 'roman_empire_ce_200_provinces.geojson',
    format: 'geojson',
    name_en: 'Roman provincial boundaries (200 CE)',
    snapshot_year: 200,
  },
  {
    id: 'roman_provinces_post_diocletian',
    file: 'roman_empire_provinces_post_diocletian.geojson',
    format: 'geojson',
    name_en: 'Roman provincial boundaries (post-Diocletian)',
    snapshot_year: null,
  },
];

// ------------------------------------------------------------
// 点状数据集（places.geojson）
// ------------------------------------------------------------
export const PLACES_DATASETS = [
  {
    id: 'urban_areas',
    file: 'urban_areas.geojson',
    format: 'geojson' as const,
    /** 原始为城市建成区多边形，取 pointOnSurface 作为代表点 */
    place_type: 'urban_area',
  },
];
