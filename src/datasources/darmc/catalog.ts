// ============================================================
// DARMC / MAPS 图层目录（本 loader 实际抓取的图层清单）
//
// 数据通道说明（决策记录，详见 README.md）：
// DARMC 官网 https://darmc.harvard.edu/ 的正式下载方式是 Google Drive
// 打包的 geodatabase/shapefile（老式 docs.google.com 链接，不适合脚本化）；
// 而官网交互地图本身由 Harvard CGA（sap514_Harvard_CGA）的 ArcGIS Online
// Hosted Feature Services 提供服务，与官网图层一一对应，可匿名分页查询
// GeoJSON。本 loader 以该服务为官方程序化入口。
// ============================================================

/** Harvard CGA org 在 services1.arcgis.com 下的服务根 */
export const SERVICE_ROOT =
  'https://services1.arcgis.com/qN3V93cYGMKQCOxL/arcgis/rest/services';

export const SERVICE_INFO_URL =
  'https://www.arcgis.com/sharing/rest/content/items/48a6a8b1ff6648c48c3526836c63eeae?f=json';

/** 官网数据可用性页（license 与数据系列的正式说明所在） */
export const DATA_AVAILABILITY_URL = 'https://darmc.harvard.edu/data-availability';

export const LICENSE = 'CC BY-NC-SA 4.0';
export const LICENSE_URL = 'http://creativecommons.org/licenses/by-nc-sa/4.0/';

export interface LayerSpec {
  /** 短键，用于文件名与 place_code/region_code 前缀 */
  key: string;
  /** ArcGIS 服务名 */
  service: string;
  /** 服务内图层 id */
  layerId: number;
  /** 服务里的官方图层标题（原样） */
  title: string;
  /** 图层家族：cities / towns / bishoprics / provinces / kingdoms */
  family: string;
  /** 产出归属：places.geojson 还是 regions.geojson */
  kind: 'places' | 'regions';
  /** 单年快照（如 "ca. AD814"）→ 写入 source_props.snapshot_year；范围型为 null */
  snapshotYear: number | null;
  /** 范围型快照（如 "ca. 303-324"）→ start_year/end_year；单年快照为 null */
  startYear: number | null;
  endYear: number | null;
  /** 该服务的 OID 字段名（分页排序用；cities 服务是 ObjectId） */
  oidField: string;
}

export const PLACE_LAYERS: LayerSpec[] = [
  {
    key: 'cities',
    service: 'Roman_Cities_and_Settlements',
    layerId: 0,
    title: 'Cities and Settlements',
    family: 'cities',
    kind: 'places',
    snapshotYear: null,
    startYear: null,
    endYear: null,
    oidField: 'ObjectId',
  },
  {
    key: 'towns814',
    service: 'DARMC_Medieval_World',
    layerId: 4,
    title: 'Major Towns (ca. AD814)',
    family: 'towns',
    kind: 'places',
    snapshotYear: 814,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'towns1000',
    service: 'DARMC_Medieval_World',
    layerId: 7,
    title: 'Major Towns (ca. AD1000)',
    family: 'towns',
    kind: 'places',
    snapshotYear: 1000,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'towns1200',
    service: 'DARMC_Medieval_World',
    layerId: 10,
    title: 'Major Towns (ca. AD1200)',
    family: 'towns',
    kind: 'places',
    snapshotYear: 1200,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'towns1450',
    service: 'DARMC_Medieval_World',
    layerId: 13,
    title: 'Major Towns (ca. AD1450)',
    family: 'towns',
    kind: 'places',
    snapshotYear: 1450,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'bishoprics600',
    service: 'DARMC_Medieval_World',
    layerId: 52,
    title: 'Bishoprics ca. 600',
    family: 'bishoprics',
    kind: 'places',
    snapshotYear: 600,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'bishoprics900',
    service: 'DARMC_Medieval_World',
    layerId: 53,
    title: 'Bishoprics ca. 900',
    family: 'bishoprics',
    kind: 'places',
    snapshotYear: 900,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'bishoprics1000',
    service: 'DARMC_Medieval_World',
    layerId: 54,
    title: 'Bishoprics ca. 1000',
    family: 'bishoprics',
    kind: 'places',
    snapshotYear: 1000,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'bishoprics1200',
    service: 'DARMC_Medieval_World',
    layerId: 55,
    title: 'Bishoprics ca. 1200',
    family: 'bishoprics',
    kind: 'places',
    snapshotYear: 1200,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'bishoprics1450',
    service: 'DARMC_Medieval_World',
    layerId: 56,
    title: 'Bishoprics ca. 1450',
    family: 'bishoprics',
    kind: 'places',
    snapshotYear: 1450,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
];

export const REGION_LAYERS: LayerSpec[] = [
  {
    key: 'prov117',
    service: 'DARMC_Roman_World',
    layerId: 14,
    title: 'Boundaries: Provinces, ca. 117 CE',
    family: 'provinces',
    kind: 'regions',
    snapshotYear: 117,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'prov303',
    service: 'DARMC_Roman_World',
    layerId: 15,
    title: 'Boundaries: Provinces, ca. 303-324 CE',
    family: 'provinces',
    kind: 'regions',
    snapshotYear: null,
    startYear: 303,
    endYear: 324,
    oidField: 'OBJECTID',
  },
  {
    key: 'prov500',
    service: 'DARMC_Roman_World',
    layerId: 16,
    title: 'Boundaries: Provinces, ca. 500 CE',
    family: 'provinces',
    kind: 'regions',
    snapshotYear: 500,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'kingdoms814',
    service: 'DARMC_Medieval_World',
    layerId: 5,
    title: 'Boundaries: Kingdoms, ca. 814 CE',
    family: 'kingdoms',
    kind: 'regions',
    snapshotYear: 814,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'kingdoms1000',
    service: 'DARMC_Medieval_World',
    layerId: 8,
    title: 'Boundaries: Kingdoms, ca. 1000 CE',
    family: 'kingdoms',
    kind: 'regions',
    snapshotYear: 1000,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'kingdoms1200',
    service: 'DARMC_Medieval_World',
    layerId: 11,
    title: 'Boundaries: Kingdoms, ca. 1200 CE',
    family: 'kingdoms',
    kind: 'regions',
    snapshotYear: 1200,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
  {
    key: 'kingdoms1450',
    service: 'DARMC_Medieval_World',
    layerId: 14,
    title: 'Boundaries: Kingdoms, ca. 1450 CE',
    family: 'kingdoms',
    kind: 'regions',
    snapshotYear: 1450,
    startYear: null,
    endYear: null,
    oidField: 'OBJECTID',
  },
];

export const ALL_LAYERS: LayerSpec[] = [...PLACE_LAYERS, ...REGION_LAYERS];

/** 构造某图层分页查询的 REST URL（记录进 manifest 的 download_urls 用同一形式） */
export function layerQueryUrl(layer: LayerSpec): string {
  return `${SERVICE_ROOT}/${layer.service}/FeatureServer/${layer.layerId}/query`;
}
