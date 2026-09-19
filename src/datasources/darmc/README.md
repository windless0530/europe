# DARMC / Mapping Past Societies（哈佛）loader

数据源：**Digital Atlas of Roman and Medieval Civilizations (DARMC)**，现名
**Mapping Past Societies (MAPS)**，哈佛大学 Science of the Human Past / Center
for Geographic Analysis 维护。覆盖罗马与中世纪文明（约公元前 550 – 公元 1500）
的地理图层，以点状聚落数据见长，另含政区多边形快照。

- 官网：<https://darmc.harvard.edu/>（数据可用性：<https://darmc.harvard.edu/data-availability>）
- 本 loader 实际使用的服务：Harvard CGA（ArcGIS Online org `qN3V93cYGMKQCOxL`，账号
  `sap514_Harvard_CGA`）托管的官方地图 Feature Services：
  - `Roman_Cities_and_Settlements`（地图项 id `d4c8dd4dc2244c409cfadbf8537e1360`）
  - `DARMC_Roman_World`（地图项 id `5d033d4bfa844f9091c701557769b350`）
  - `DARMC_Medieval_World`（地图项 id `48a6a8b1ff6648c48c3526836c63eeae`，68 图层）

## License

- **CC BY-NC-SA 4.0**（Attribution-NonCommercial-ShareAlike 4.0 International），
  出处：官网 Data Availability 页脚
  <http://creativecommons.org/licenses/by-nc-sa/4.0/>。
  原文要点：可自由取用、改编、再发布派生作品，须署名 MAPS 及原始内容作者，
  非商业使用，相同方式共享；任何情况下不得对该数据收费。
- 注意：MAPS 的各 Scholarly Data Series 系列要求引用各自的原始出版物
  （本 loader 未纳入这些独立系列，只用主图谱层）。

## 为什么用 ArcGIS Feature Service 而不是官网下载包

官网正式下载方式是 Google Drive 上的打包 geodatabase/shapefile（老式
`docs.google.com/file/d/0B4...` 链接，不适合脚本化复现）；而官网交互地图本身
由 Harvard CGA 的 ArcGIS Online Hosted Feature Services 提供服务，图层与官网
Map Sources 页一一对应，可匿名分页查询 GeoJSON。两者是同一数据的不同分发通道；
本 loader 用服务通道（URL 全部记录在 manifest 的 `download_urls`）。
查询固定 `outSR=4326&f=geojson`，服务端直接输出 WGS84，故无需 proj4/shapefile 解析。

## 使用方法

```bash
npm run darmc                      # download -> normalize -> validate
npm run darmc -- download [--force]
npm run darmc -- normalize
npm run darmc -- validate
```

- 产物：`data/processed/darmc/places.geojson`、`regions.geojson`、`manifest.json`
- 幂等：raw 文件已存在则跳过下载（`--force` 重下）；normalize/validate 全量重写。

## 选用的图层（17 个服务图层，5 个家族）

### places.geojson（点，18,887 个）

| 家族 | 图层（服务/图层 id） | 要素数 | 时间语义 |
|---|---|---|---|
| cities | `Roman_Cities_and_Settlements/0` "Cities and Settlements"（Barrington Atlas / Tabula Imperii Byzantini） | 13,626 | 逐要素 TIMEPERIOD 编码，未换算（见 open issues） |
| towns | `DARMC_Medieval_World/4,7,10,13` "Major Towns (ca. AD814/1000/1200/1450)" | 402+549+584+448 | 快照 814/1000/1200/1450 |
| bishoprics | `DARMC_Medieval_World/52,53,54,55,56` "Bishoprics ca. 600/900/1000/1200/1450" | 2359+270+337+184+128 | 快照 600/900/1000/1200/1450 |

### regions.geojson（面，378 个，真实原始多边形，未做任何点缓冲伪造）

| 家族 | 图层（服务/图层 id） | 要素数 | 时间语义 |
|---|---|---|---|
| provinces | `DARMC_Roman_World/14,15,16` "Boundaries: Provinces, ca. 117 / 303-324 / 500 CE"（Barrington Atlas） | 78+97+64 | 快照 117、500；303-324 为范围型（start=303, end=324） |
| kingdoms | `DARMC_Medieval_World/5,8,11,14` "Boundaries: Kingdoms, ca. 814/1000/1200/1450 CE" | 22+34+40+43 | 快照 814/1000/1200/1450 |

## 字段映射

- `source_id`：cities / bishoprics600 有原生 `DARMCID`，用 `<layer>:<DARMCID>`；
  其余图层无原生业务 id，用 `<layer>:<OBJECTID>`（README 说明的生成规则）。
- `place_code` / `region_code`：`darmc:<layer>_<name-slug>_<OBJECTID>`，
  确定性唯一（同一地点在不同快照图层是不同要素）。
- `name_en`：原始名照录（拉丁名原样）；空白串视为 null。来源字段：
  cities/bishoprics 用 `NAME`（缺失时 `ALTERN`/`Altern`），towns 用 `CITYNAME`，
  provinces 用 `PROV_NAME`（内嵌换行折叠；`SUBDIVISIO` 兜底），
  kingdoms 用 `KINGDOMNAME`（`REGIONNAME` 兜底）。`name_zh` 一律 null。
- `place_type` 取值全集：
  - `city`（cities.CLASS=City，2,987）
  - `settlement`（cities.CLASS=Settlement，10,628；含 TYPE 为
    "Modern Settlement"/"Settlement traces"/"D" 的点，原值保留在 source_props.TYPE）
  - `urban_area`（cities.CLASS="Urban area"，11）
  - `town`（四个 Major Towns 快照）
  - `bishopric`（五个 Bishoprics 快照）
- `region_type`：provinces / kingdoms 均为 `political_entity`（对齐 SQL 字典）；
  `level`、`parent_code` 为 null（行省的 DIOCESE/SUBDIVISIO 层级未建树）。
- 时间：单年快照图层把年份写进 `source_props.snapshot_year`（契约对快照型数据
  的要求，start/end 留 null）；Provinces ca. 303-324 是范围型快照，用
  `start_year=303` / `end_year=324` 表达文献断代；`TIMEPERIOD`、`Founded`、
  `Bishopby` 等模糊纪年字段不换算、原样保留。
- `source_props`：原始属性键值原样保留，另附三个溯源键：`layer`（图层 key）、
  `layer_title`（服务内官方图层名）、`snapshot_year`（单年快照时）。
- 坐标：查询即输出 EPSG:4326；输出 GeoJSON 不带 `crs` 成员。

## 几何简化（regions）

服务端多边形顶点极密（kingdoms814 原始 864,649 顶点 / 30.5MB），而这些边界本身
是历史图集（Barrington Atlas 等）转绘的近似线。按契约"几何过精时用 turf 简化
并记录"：

- provinces：turf simplify（Douglas-Peucker）tolerance 0.001°（约 111m）
- kingdoms：tolerance 0.002°（约 222m）

简化后顶点 1,425,006 → 339,334，regions.geojson 从 51.7MB 降到约 12.5MB，
与 places 合计约 25.9MB，满足契约 ~30MB 预算。注意：相邻面独立简化可能在共同
边界产生细缝/重叠（对显示用途可接受）。

## 校验摘要（最近一次运行）

- places：18,887 / 18,887 通过，0 错误，0 警告；2,645 个要素 `name_en` 为 null
  （原始数据无名，主要是 cities 层 TIB 来源点）。
- regions：378 / 378 通过，0 错误，0 警告。
- normalize 零丢弃、零修复（所有要素几何/字段齐全）。
- bounds（自定义检查补算，见 open issues）：
  places `[-18.09, -6.66, 93.33, 66.09]`，regions `[-10.67, 12.59, 64.83, 71.15]`。

## 空间与时间覆盖评估

- DARMC 对本项目的核心价值：**点状聚落网络 + 政区多边形快照**，而非连续区域
  边界。点层随 Barrington/TIB 覆盖整个罗马-拜占庭世界（含地中海、北非、近东，
  并有 561 点在印度洋沿岸/中亚，如 Taxila、Palibothra——真实源数据，未删，
  前端可按 bbox 过滤）。
- 王国面层对"族群分布"极有价值：814 快照含 Anglo-Saxon England、Frankish
  Empire、Avars and Croats、West Slavs、Emirate of Cordoba 等族群政体名。
- 明显缺口：东欧/北欧薄（无斯堪的纳维亚族群细节）；快照之间（尤其 500–814）
  无政权边界；图层只有政教归属名，无语言/宗教属性；600 与 900 之间主教区断层。
- 结论：DARMC 是"点状补充 + 政权快照底图"，区域连续演化需 AWMC/NUTS 等互补。

## 可选扩展（本次未纳入）

- 修道院网络：Medieval Monastic Foundations C4-C8（640）、Celtic and Anglo-Saxon
  Monasteries（313）、Cistercian（751）、Cluniac、Praemonstratensian、
  Dominican 1216-1500、Franciscan ca.1300、Regular Canons ca.1250
- 伊斯兰城市（153）与 Islamic boundaries ca. 632-750；十字军城市（65）与诸次
  十字军路线（线要素）
- Viking/Norman 航线与影响范围（Viking Settlements ca.700-1099，面）
- France: Diocese and Archdiocese Boundaries ca. 1000（面，Dataverse/Drive 亦
  有 shapefile：MAPS Scholarly Data Series 2013-4）
- 罗马道路网（线）：Dataverse `doi:10.7910/DVN/TI0KAU`（Roman Road Network
  version 2008），或服务 `RomanRoadsDARMC` 系列
- 古代港口（de Graauw，~2900 点）：Dataverse `doi:10.7910/DVN/3KQFUT`
- 盎格鲁-撒克逊农村定居点（84 点）：Dataverse `doi:10.7910/DVN/24697`
- 加洛林钱币窖藏（点）：Dataverse `doi:10.7910/DVN/23984`
- 大学派生经济/气候/瘟疫/沉船系列：见官网 Data Availability 页

## open issues

1. **TIMEPERIOD 编码未换算**：cities / bishoprics600 的 `TIMEPERIOD` 是
   A/C/H/R/L 字母组合（如 HRL、ACHRL），疑似 Barrington 传统分期
   （Archaic/Classical/Hellenistic/Roman/Late），但未找到官方解码文档，
   按契约"不确定即 null"未换算为整数年。若找到官方文档可回补 start/end_year，
   将显著提升时间轴可用性。
2. **Bishoprics ca. 600 快照语义弱**：2,359 点中 811 点 BISHOPRIC 字段空白、
   TIMEPERIOD 横跨 R/L，实为 TIB 全量主教座堂汇编按 ca.600 呈现；弱于
   900/1000/1200/1450 各期的快照语义。
3. **cities 层混有非古代点**：TYPE="Modern Settlement"（104）、
   "Settlement traces"（100）、"D"（3，含义不明）保留为 settlement。
4. **行省层级未建树**：303-324 层的 DIOCESE、各层的 SUBDIVISIO 可建
   parent_code 层级（教区→行省），本阶段未做。
5. **kingdoms 原始拼写**：kingdoms1000 出现 "Belgium"/"United Kingdom" 等
   现代名与 "Muslin North Africa"（=Muslim，源数据笔误），原样保留。
6. **契约 bug（记录，不改冻结文件）**：`validatePlaces`/`validateRegions` 的
   `checkCoords` 把 geometry 对象传给只递归数组的 `walkPositions`，坐标遍历
   从不触达，通用校验器产出的 `bounds` 恒为 null、坐标越界检查不生效；
   本 loader 在自定义检查中补算了 bounds 与坐标检查（对其他 loader 同样成立，
   建议主会话统一修复契约）。
7. **契约缺口**：`PlaceFeatureProps` 无 region/parent 概念，主教区点无法挂接
   France Dioceses 面层级；如需表达需主会话裁决是否扩展契约。
