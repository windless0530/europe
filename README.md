# europe

欧洲历史族群图谱（个人项目）：带时间轴的欧洲地图，展示各时期各地区（次国家级粒度）的族群分布、语言、宗教与族群关系，中英双语。

- 数据库设计：`european_historical_population_atlas_v2.sql`（PostgreSQL 16 已装载，库名 `europe_atlas`）
- 技术方案：静态导出 + 纯前端 SPA

## 快速开始

```bash
npm run dev            # http://localhost:5173（默认进入「族群分布」模式）
npm run export         # PostgreSQL -> data/export/atlas.json（改库后重跑）
npm run audit          # 覆盖审计：逐年扫描核心几何「先有族群后空白」断档
npm run favicon        # 由自有 NUTS 几何生成 favicon（SVG + PNG 回退）
npm run smoke          # headless 冒烟：加载/时间轴/hover/零网络验证 + 截图
```

PostgreSQL（brew postgresql@16，数据目录 `/opt/homebrew/var/postgresql@16`）：

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 start|stop
psql -d europe_atlas -f european_historical_population_atlas_v2.sql   # 重建（主 seed）
psql -d europe_atlas -f sql/patches/*.sql                             # 再按序应用补丁
```

## 前端（两种模式）

**族群分布（默认，SQL 驱动）**：启动全量加载 atlas.json + 三源几何（带进度条），
此后**缩放/连续年份时间轴（-509 至今）/hover 全部内存运算、零网络请求**。
着色 = `people_region` 时间切片按 render_priority 取主族群；hover 面板显示
当年全部族群、语言、宗教、族群关系与当期事件（中文名取自 `*_translation`）。
SQL region（粗粒度历史地理）→ 几何的近似映射见 `src/frontend/region-map.ts`。

图例为左侧「族群谱系」树（`src/frontend/people-tree.ts`）：按 SQL taxonomy
层级组织全部族群（如 印欧语系 → 日耳曼 → 东日耳曼 → 哥特 → 东/西哥特人），
当年活动者全亮并注记活动区域、未活动者半透明；悬停树叶时地图上该族群
区域之外全部压暗（内存操作）。

当前 seed 为 61 个族群提供 91 条空间时间片：每个族群在自身生命周期内均有
连续覆盖。**覆盖原则：核心欧洲几何（现代国家）在首次有族群之后的任何年份
不得空白**——由 `npm run audit` 逐年门禁（时间轴最小步长 1 年，并报告
从未覆盖的 L0 国家），补丁 `sql/patches/2026-10-01-core-coverage.sql`
消除了基线审计发现的 16 处断档（新增阿瓦尔人/巴伐利亚人/摩尔人、
austria region，及法兰克/斯拉夫/撒克逊等衔接切片）；
`sql/patches/2026-10-02-switzerland.sql` 补上瑞士 region 与 5 条切片
（高卢→罗马→勃艮第→法兰克→德意志，零新增族群），科索沃（XK）加入
balkans 映射。豁免项：`roman_empire` AWMC 快照（帝国消亡即隐没）、
`north_africa` DARMC 行省 551 年后（非欧洲核心）。历史区间和现代国家/构成国
边界是 MVP 可视化代理，不代表精确疆界、排他领土或边界内人口同质；
近似程度记录在 `confidence_code` 与 `notes` 中。

**几何浏览**：三源原始几何 + 快照时间轴（`src/datasources/` 各自 README）。

代码：`src/frontend/`（main/map/timeline/legend/people-tree/panel/load/atlas/region-map/i18n/palette/state）。
开发期数据经 vite 中间件白名单直读 `data/processed/` 与 `data/export/`。

## 数据管线

三个免费数据源 → 统一契约的规范化产物，可自由切换：

```bash
npm install
npm run awmc            # 古代：罗马帝国快照 + Strabo 族群领地（ODbL）
npm run darmc           # 罗马-中世纪：行省/王国多边形 + 1.9 万聚落点（CC BY-NC-SA）
npm run nuts            # 现代：NUTS 2024 L0-L3 + GADM 补齐
npm run data -- list    # 总览
npm run data -- use <源>  # 切换当前数据源（写 atlas.config.json）
npm run data -- compare   # 三源对比
```

| 目录 | 内容 |
|---|---|
| `src/lib/contract.ts` | 数据契约（类型 + 通用校验器） |
| `src/datasources/<源>/` | 各源 pipeline（download/normalize/validate） |
| `src/datasources/registry.ts` | 数据源注册与加载入口（前端导出用） |
| `src/cli.ts` | `npm run data` 管理命令 |
| `data/processed/<源>/` | 规范化产物（regions/places/lines + manifest） |
| `docs/data-contract.md` | 管线硬性规范 |
| `docs/data-sources.md` | 三源对比与选源指南 |

原始下载在 `data/raw/`（gitignore）。各源字段映射、license、已知问题见
`src/datasources/<源>/README.md`。
