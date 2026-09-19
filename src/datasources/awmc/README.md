# AWMC（Ancient World Mapping Center）loader

UNC Chapel Hill 古代世界制图中心公开地理数据的下载 / 规范化 / 校验管线。

```bash
npm run awmc                          # all: download + normalize + validate
npm run awmc -- download [--force]    # 仅下载（幂等，已存在跳过）
npm run awmc -- normalize             # raw -> processed（全量重写）
npm run awmc -- validate              # 校验 + 生成 manifest.json
```

## 数据源与 License

- 入口：官网 GIS Data 页 <https://awmc.unc.edu/gis-data/>，指向 GitHub 仓库
  **<https://github.com/AWMC/geodata>**（任务书中的 `AncientWorldMappingCenter/awmc-geodata` 已 404，org 实际名为 `AWMC`）
- 仓库 README（`data/raw/awmc/upstream_README.md`）原文声明：

  > The GeoJson files are offered under the ODC Open Database License
  > (http://opendatacommons.org/licenses/odbl/1.0/). Data is derived from the
  > Barrington Atlas of the Greek and Roman World, and uses AWMC modifications
  > to OpenStreetMap (https://www.openstreetmap.org/), which is under the ODC
  > Open Database License.

- **License：ODC Open Database License (ODbL) v1.0**，<https://opendatacommons.org/licenses/odbl/1-0/>
  （含 share-alike 义务；个人非商业项目可用，前端如公开分发需注意 ODbL 归属与同享条款）
- 下载内容：`Cultural-Data/` 下 11 个 GeoJSON（README 称 most up-to-date）+ 3 个溯源文档
  + `Cultural Shapefiles Apr 2024.zip`（解压；是 GeoJSON 目录的**超集**，含 ethnonyms、
  ad_14/ad_69/314 帝国范围、ba_100 行省线等）。全部 URL 记录在 `manifest.json` 的 `download_urls`。
- 全部源数据 prj 均为 WGS84（EPSG:4326），未使用 proj4。

## 产物（data/processed/awmc/）

| 文件 | 要素 | 几何 | 大小 | 内容 |
|---|---|---|---|---|
| `regions.geojson` | 121 | MultiPolygon×12, Polygon×109 | 5.8 MB | 12 个"实体级"区域 + 109 个族群领地 |
| `places.geojson` | 95 | Point | 0.06 MB | 古代城市建成区代表点（Rome/Ostia/…） |
| `lines.geojson` | 446 | LineString, MultiLineString | 1.1 MB | 7 套罗马行省/帝国边界 linework |
| `manifest.json` | — | — | — | 元数据 + 校验报告 |
| `_stats.json` | — | — | — | normalize 内部统计（供 manifest 回填 fixed/dropped，非对外产物） |

### regions.geojson 构成

**实体级（每数据集溶解为 1 个 MultiPolygon 要素）：**

| region_code | 数据集 | 原始碎片数 | snapshot_year | region_type |
|---|---|---|---|---|
| `awmc:roman_empire_60_bce` | roman_empire_bce_60 | 74 | -60 | political_entity |
| `awmc:roman_empire_14_ce` | roman_empire_ad_14_extent (zip) | 109 | 14 | political_entity |
| `awmc:roman_empire_69_ce` | roman_empire_ad_69_extent (zip) | 110 | 69 | political_entity |
| `awmc:roman_empire_117_ce` | roman_empire_ce_117_extent | 112 | 117 | political_entity |
| `awmc:roman_empire_200_ce` | roman_empire_ce_200_extent | 112 | 200 | political_entity |
| `awmc:roman_empire_314_ce` | roman_empire_diocletian_and_Constantine_314_extent (zip) | 111 | 314 | political_entity |
| `awmc:alexanders_empire` | alexanders_empire | 41 | null | political_entity |
| `awmc:achaemenid_persian_empire` | extent_of_the_persian_empire | 24 | null | political_entity |
| `awmc:hasmonean_kingdom` | hasmonean_kingdom | 1 | null | political_entity |
| `awmc:herods_kingdom` | herods_kingdom | 2 | null | political_entity |
| `awmc:roman_senatorial_provinces` | roman_senatorial_provinces（8 个无名碎片合并为"集合"） | 8 | null | political_entity |
| `awmc:italy` | Italy_shading (zip) | 1 | null | historical_region |

**族群领地（每要素一个区域，本项目核心价值）：**

- `awmc:ethnonyms` 数据集（zip 内 shapefile）：109 个多边形，`en_name` 为 Strabo《地理学》
  记载的族群名（Artabrians、Callaicians、Vettonians、Ilergetians、Skythians…），
  `region_type: 'cultural_region'`，`source_props` 原样保留 `Id/en_name/gr_name/source/creator`。
  其中 100 个完全落在欧洲参考范围（经 [-31,45] 纬 [27,73]）内，集中在伊比利亚、高卢、
  意大利、巴尔干、黑海以北。

### places.geojson

`urban_areas.geojson`（95 个城市建成区多边形）取 `turf.pointOnFeature` 代表点，
`place_type: 'urban_area'`；`source_props` 原样保留（pleiadesid/timeperiod/type 等，
注意上游 shapefile→GeoJSON 的 DBF 10 字符截断：contributo/descriptio/initial_pr）。

### lines.geojson（contract 未定义线类型，本地 `LineFeatureProps`，line_code 与 region_code 同构）

| 数据集 | 线数 | snapshot_year |
|---|---|---|
| roman_empire_60_bc_provinces (zip) | 16 | -60 |
| roman_empire_ad_14_provinces (zip) | 79 | 14 |
| roman_empire_ad_69_provinces (zip) | 79 | 69 |
| Roman_Empire_Around_AD_75 (zip) | 8 | 75 |
| ba_100_provinces (zip) | 87 | 100 |
| roman_empire_ce_200_provinces | 81 | 200 |
| roman_empire_provinces post_diocletian | 96 | null |

## 字段映射与 id 生成规则

- `region_code = awmc:${slugify(id 或 en_name)}`；重名自动追加 `_2`（Skythians、Senonians 各 2 个 → `skythians_2`/`senonians_2`，计入 fixed）
- `source_id`：溶解实体用数据集 id；ethnonyms 用 `en_name`（原生 `Id` 字段全为 0，无区分度）；
  places 优先用 pleiadesid URL 尾段，其次 title，最后 `urban_areas#序号`
- 快照年份 → `source_props.snapshot_year`（数据集名称中明确给出才填：-60/14/69/75/100/117/200/314；亚历山大/波斯/哈斯蒙尼/希律/senatorial/ethnonyms 原始数据未给年份 → null，**不编造**）
- `start_year`/`end_year` 一律 null（快照型数据）；`name_zh` 一律 null
- `name_en`：实体级用数据集可读名；ethnonyms 用 `en_name`；5 个全空属性的城市点为 null
- 行省/王国/帝国 → `political_entity`；宽泛地理（Italy）→ `historical_region`；族群领地 → `cultural_region`
- `source_props` 原样保留原始属性（键名不改）；仅追加带 `awmc_` 前缀的溯源键（`awmc_dataset`/`awmc_source_file`/`snapshot_year`）
- 产物不含 `crs` 成员（契约要求；上游 GeoJSON 的 CRS84 声明被丢弃）

## 校验摘要（validate，2026-09-19）

- regions：121/121 通过，0 error / 0 warn；bounds [-9.5, 14.2, 86.5, 56.1]
- places：95/95 通过，0 error / 0 warn；bounds [-5.8, 29.9, 44.6, 45.8]
- lines：446/446 通过，0 error / 0 warn；bounds [-8.7, 22.7, 43.1, 52.6]
- fixed=regions 2 + places 1（Pteria 重名 `_2` 消歧）；dropped=0
- 自定义检查：无 crs 成员、name_zh=null、start/end_year=null、region_type 字校验、
  坐标有限性与范围（补 contract 校验器不生效的部分，见 open_issues #2）

## 关键决策

1. **以 GeoJSON 逐文件为主、zip 为补充**：zip 独有 ethnonyms、ad_14/ad_69/314 范围、ba_100 行省线、Italy_shading，故两者都下载。
2. **帝国范围溶解**：原始"extent"类数据是无名称碎片多边形（ArcInfo 自动属性 OBJECTID/AREA/…，零信息量），每数据集溶解为 1 个 MultiPolygon；碎片级属性不保留（以 `parts` 计数记录）。溶解为几何拼接（非拓扑 union），碎片间可能存在微小重叠。
3. **行省保持线状**：所有年份的行省数据原始即为 arc 节点 linework（含 LPOLY_/RPOLY_ 拓扑字段但值全 0），turf polygonize 在去重/取整/分段后仅能闭合 0-7 个碎面（端点不共享，未节点化），无法重建行省面；按契约以 `lines.geojson` 保留，不伪造多边形。
4. **hasmonean/herod 用 GeoJSON 版本**：Apr 2024 zip 内同名 shapefile 的 DBF 记录与 persian_extent 完全一致（疑似上游数据错误），不可信。
5. **跳过**：pleiades places（约 3.4 万点、89 MB DBF，属 Pleiades 项目快照，license/归属应单独处理，见 open_issues）、roads、aqueducts、regional name linework、centuriation 等非区域类图层；temp_conquest（美索不达米亚临时征服区，欧洲范围外）。
6. **无名要素保留不丢**：5 个全空属性的城市点、8 个 senatorial 无名碎片（并入集合要素），如实保留/合并并在此说明。

## Open Issues

1. **契约缺口**：contract.ts 未定义线要素类型（LineFeatureProps / validateLines），本 loader 以 region_code 同构的 `line_code` 本地实现，建议主会话统一裁决。
2. **契约 bug（冻结文件，仅报告）**：contract.ts `checkCoords` 把 geometry 对象传给期望数组的 `walkPositions`，导致 `validateRegions`/`validatePlaces` 的坐标校验与 bbox 统计实际不生效（bounds 恒为 ±Infinity）；本 loader 在 validate 中另行实现坐标校验并回填真实 bounds。
3. **行省多边形缺失**：带名称的行省面需依赖 DARMC 数据源；AWMC 行省线无名称字段（仅 OBJECTID/PROVINCE10 拓扑残留）。
4. **ethnonyms 无时间字段**：全部 `source=Strabo`（约 7 BCE–23 CE 成书），如需上时间轴需人工核定 snapshot_year。
5. **region_type 字典建议**：族群领地暂映射 `cultural_region`；若前端需要"族群"专类，建议扩展字典。
6. **regional name linework 未启用**：含 TITLE 与 P_MIN_DATE/P_MAX_DATE 的区域名称时空信息（标签放置线），未来可提取为区域命名参考。
7. **zip 内 hasmonean/herod shapefile 疑似数据错误**，可向上游（awmc@unc.edu / GitHub issue）反馈。
8. **与 SQL seed 中 `region`（如 `italy`）的对齐**不在本任务范围，待主会话统一处理。
