# NUTS（Eurostat GISCO 2024）+ GADM 4.1 补齐 —— 现代 EU 边界

现代次国家级行政边界的基准数据源：作为时间轴"现代端"的固定网格，
也为历史族群分布图层提供今地名/今边界的对照底图。

## 产物

| 文件 | 内容 |
|---|---|
| `data/processed/nuts/regions.geojson` | 1935 个多边形要素（12.2 MB），层级 0-3 |
| `data/processed/nuts/normalize_stats.json` | normalize 阶段丢弃/修复明细（manifest 引用） |
| `data/processed/nuts/manifest.json` | 元数据 + 校验报告 + license + 决策记录 |

层级分布：L0 = 48（39 NUTS 国家 + 9 GADM 补齐国家），L1 = 254，L2 = 294，L3 = 1339。
来源构成：NUTS 1786 + GADM 149（以 `source_props.origin` 区分：`nuts` / `gadm`）。

```bash
npm run nuts                                    # download + normalize + validate（幂等）
npx tsx src/datasources/nuts/index.ts download --force
npx tsx src/datasources/nuts/index.ts normalize
npx tsx src/datasources/nuts/index.ts validate
```

## 数据出处与 license

**主体：Eurostat GISCO — NUTS 2024**
- 入口：https://gisco-services.ec.europa.eu/distribution/v2/nuts/
- 实际下载（RG 边界 / 1:20M / EPSG:4326）：
  `.../geojson/NUTS_RG_20M_2024_4326_LEVL_{0,1,2,3}.geojson`
- License：欧盟委员会再利用政策（Commission Decision 2011/833/EU），
  注明出处即可自由再利用（https://ec.europa.eu/eurostat/web/main/about/policies/copyright）

**补齐：GADM 4.1**（仅用于 NUTS 未覆盖的国家，要素 `source_props.origin='gadm'`）
- 入口：https://gadm.org/download_country.html
- 实际下载：`https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_{ISO3}_{0,1}.json.zip`
  （国家：GBR / MDA / BLR / RUS / AND / MCO / SMR / VAT / FRO / UKR）
- License：**学术与非商业使用免费；禁止再分发与商业使用**
  （https://gadm.org/license.html）——本仓库为个人非商业项目；若网站公开
  分发需先移除 GADM 派生要素或取得授权（已记入 open_issues，选源时注意）

## 字段映射

| 契约字段 | NUTS | GADM |
|---|---|---|
| `source_id` | `NUTS_ID` | `GID_1`（admin1）/ `GID_0`（国家级） |
| `region_code` | `nuts:${slugify(NUTS_ID)}`，如 `nuts:de71` | `nuts:${slugify(GID_x)}`，如 `nuts:gbr_2_1` |
| `name_en` | `NAME_LATN`（缺失时 `NUTS_NAME`） | `NAME_1` / `COUNTRY`（空格恢复后） |
| `level` | `LEVL_CODE`（0-3） | 国家级 0 / admin1 = 1 |
| `parent_code` | NUTS 编码前缀（L1←前 2 字符…L3←前 4 字符） | admin1 → 该国 L0（乌克兰指向 NUTS 的 `nuts:ua`） |
| `region_type` | null | null |
| `start_year` / `end_year` | null | null |
| `source_props` | 原属性 + `origin:'nuts'` + `vintage:2024` | 原属性 + `origin:'gadm'` + `gadm_version:'4.1'` |

**重要语义说明**
- `name_en` 来自 `NAME_LATN`，是**拉丁转写/国语名**而非英文译名
  （如 "Crna Gora"、"İstanbul"、"Ukraina"）。NUTS 的 `NAME_ENGL` 字段在
  子层级存的是**国名**而非区域名，故不采用；英文规范化留给后续统一阶段。
- 时间语义：版本型数据，vintage 在 `source_props.vintage`（GADM 无官方
  年代标注，仅记版本号 4.1），`start_year`/`end_year` 一律 null。
- `region_type` 全为 null：建议 SQL 的 region_type 字典增加
  `modern_subdivision`（现代行政/统计分区），否则该列无法承载本源。

## 覆盖情况

- NUTS 2024 覆盖 39 个国家/地区：EU27 + IS/NO/CH/LI + 候选国
  TR/RS/ME/MK/AL + **BA/XK/UA（2024 版新增）**。层级：UA 仅 L0、BA 至 L2、
  其余至 L3。英国因脱欧自 NUTS 2021 起移除。
- GADM 补齐（`origin='gadm'`）：
  - 缺口国家国家级 + admin1：GBR（4 构成国）、MDA、BLR、RUS（欧洲部分）、AND、SMR、FRO
  - 仅国家级（GADM 无 admin1）：MCO、VAT
  - UA：NUTS 有 L0（`nuts:ua`），GADM 补 27 个州级 admin1 挂其下
    （含克里米亚与塞瓦斯托波尔，系 GADM 口径）
- 明显缺口（记入 manifest coverage_note）：高加索三国、哈萨克斯坦乌拉尔以
  西部分、北塞浦路斯、直布罗陀等英属领地。

## 关键决策

1. **选 2024 版而非 2021**：最新版，且首次纳入 UA/XK/BA；20M 精度 4 个层级
   原始共约 3 MB，远低于 30 MB 预算，LEVL 3 无需舍弃。
2. **欧洲参考 bbox 过滤**（[-31,27,45,73]，顶点判定，对跨反经线几何安全）：
   丢弃法国海外大区 FRY*（瓜德罗普/马提尼克/法属圭亚那/留尼汪/马约特）、
   斯瓦尔巴 NO0B2（74-81N 超出范围）、俄罗斯亚洲部分 40 个州。与 bbox 有
   至少一个顶点相交的要素**整体保留**（如萨拉托夫州延至 50.9E）。
3. **L0 国界不裁剪**：法国 L0 含海外领地、俄罗斯 L0 全境（已验证 GADM 环
   不跨反经线，GeoJSON 合法、渲染安全），由前端视口自行裁剪显示。
4. **GADM 名称空格恢复**：GADM JSON 导出剥掉了名称中的空格
   （"NorthernIreland"），做保守机械恢复（小写→大写边界、句点后补空格），
   原始值保留在 `source_props`。GBR.1_1 的 `NAME_1` 缺失（GADM 已知缺陷），
   按几何/类型判定为 England（`NAME_OVERRIDES` 表，共 16 处修复）。
5. **GADM 丢弃项**：乌克兰 1 个脱敏要素（GID/NAME="?"，战争相关）、
   GBR 1 个全 "NA" 无法识别要素。
6. **几何不做 turf 简化**：产物 12.2 MB 在预算内，保留 GADM 原始精度。

## 校验

`validateRegions`（契约通用校验器）+ 自定义检查：parent 引用存在、父级层级
= 子级-1、NUTS 编码前缀规则、层级树完整（L3→L0 全链可达）、origin 标记、
坐标合法性与 bounds 补算。结果：**1935/1935 通过，0 error / 0 warn**，
fixed 16、dropped 54（明细见 normalize_stats.json 与 manifest）。

## 已知问题（open_issues）

- **契约缺口**：`src/lib/contract.ts` 的 `walkPositions` 只遍历数组，
  `validateRegions` 传入 `Feature.geometry` 对象时坐标检查与 bounds 统计不
  生效；本 loader 已在自定义检查中补做并回填 `report.bounds`，建议主会话
  统一修复契约（三个 loader 同步适配）。
- GADM license 禁止再分发，公开上线前需处理（见上）。
- 乌克兰 NUTS 2024 仅 L0；未来若出 L1-3 应替换 GADM 补齐层。
- 建议 SQL region_type 字典增加 `modern_subdivision`。
- GADM 名称空格恢复为启发式，个别结果仍不自然
  （"Sant Juliàde Lòria" 应为 "Sant Julià de Lòria"），建议后续人工校订。
- 摩纳哥/梵蒂冈/圣马力诺无 admin1 细分。
