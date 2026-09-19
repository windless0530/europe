# 数据契约（Data Contract）

三个免费数据源的 data loader（`awmc` / `darmc` / `nuts`）共同遵守的规范。
目标：任一数据源的产物可以**自由替换**，前端导出阶段按 `source` 字段切换。

## 目录结构

```
data/
  raw/<source>/        # 原始下载（gitignore，不提交）
  processed/<source>/  # 规范化产物（提交，供前端导出使用）
src/
  lib/contract.ts      # 共享类型 + 工具 + 通用校验器（冻结，禁止修改）
  datasources/<source>/
    index.ts           # CLI 入口
    download.ts        # 原始数据下载（幂等）
    normalize.ts       # raw -> processed 规范化
    validate.ts        # 产物校验（可用 contract.ts 的通用校验器 + 自定义检查）
    README.md          # 正式文档：出处/license/字段映射/决策/已知问题
```

## CLI 约定

```bash
npm run <source>                          # = all
npx tsx src/datasources/<source>/index.ts download   # 下载到 data/raw/<source>/
npx tsx src/datasources/<source>/index.ts normalize  # raw -> processed
npx tsx src/datasources/<source>/index.ts validate   # 校验 processed 产物
npx tsx src/datasources/<source>/index.ts all        # 依次执行三步
```

- 所有命令**幂等**：重复执行不出错；download 遇到已存在文件默认跳过（可支持 `--force`）。
- normalize / validate 每次运行**全量重写** processed 产物。

## 产物文件与 Schema

固定文件名（放在 `data/processed/<source>/`）：

| 文件 | 内容 | 是否必有 |
|---|---|---|
| `regions.geojson` | 多边形区域 FeatureCollection | 尽力产出 |
| `places.geojson` | 点状地点 FeatureCollection | 数据源有点数据时 |
| `manifest.json` | 元数据 + 校验报告 | 必有 |

类型定义见 `src/lib/contract.ts`（`RegionFeatureProps` / `PlaceFeatureProps` / `Manifest`）。要点：

- **坐标**：一律 EPSG:4326（GeoJSON 标准，文件内不写 `crs` 成员）；原始数据是其他投影时用 `proj4` 转换。
- **region_code**：全局唯一，格式 `${source}:${slug}`（slug 用 `slugify()`）。
- **时间语义**：`start_year` / `end_year` 表示该要素真实存在的时间范围；**不确定就填 null**，不要编造。
  - 快照型数据（如"117 CE 的罗马行省"）：快照年份放 `source_props.snapshot_year`，start/end 留 null；
  - 版本型数据（如 NUTS 2021）：vintage 放 `source_props.vintage`。
- **name_zh 本阶段一律 null**（后续统一翻译），不要在 loader 里做机器翻译。
- **source_props** 原样保留原始属性，键名不改。
- 线要素（道路等）如需保留，文件名 `lines.geojson`，manifest 里 kind='lines'。

## manifest.json 必填项

- `url` / `download_urls`：入口与实际下载地址
- `license` / `license_url`：**必须**查证并原样记录（这是选源依据之一）
- `retrieved_at`：ISO 8601
- `files`：每个产物的路径 / 要素数 / 几何类型 / 字节数
- `validation`：每个产物的校验报告（用 `validateRegions` / `validatePlaces`，可追加自定义检查）
- `coverage_note`：空间覆盖评估——覆盖了哪些区域、对"欧洲各族群分布地图"明显缺什么
- `decisions`：关键决策记录
- `open_issues`：遗留问题

## 硬性边界（每个 datasource agent 必须遵守）

1. 只允许写：`src/datasources/<自己的源>/`、`data/raw/<自己的源>/`、`data/processed/<自己的源>/`；
2. 禁止修改：`package.json`、`tsconfig.json`、`src/lib/**`、其他 datasource 目录、`docs/**`；
3. 禁止执行 `git add` / `git commit` / `git push`（由主会话审查后统一提交）；
4. 禁止新增 npm 依赖（已装：`@turf/turf`、`shapefile`、`adm-zip`、`proj4`、`papaparse`、`tsx`）；确需新依赖时记入 open_issues；
5. 下载必须可追溯：URL 写入 manifest；优先选官方/权威入口；
6. 校验必须诚实：丢弃了多少、修复了多少、哪些图层级问题，如实进报告；**禁止为凑格式伪造数据**（如把点数据伪造成多边形）。

## 参考数值

- 欧洲参考范围：经度约 [-31, 45]，纬度约 [27, 73]（不含俄亚洲部分）。
- 数据含地中海/北非/近东边缘（如罗马行省）是**正常且允许**的，在 coverage_note 说明即可。
- processed 目录单个数据源总量控制在 ~30MB 内（几何过精时用 turf 简化并记录）。
