# europe

欧洲历史族群图谱（个人项目）：带时间轴的欧洲地图，展示各时期各地区（次国家级粒度）的族群分布、语言、宗教与族群关系，中英双语。

- 数据：`data/source/*.json`（5 个手写文件，唯一真实源）→ `npm run project` 投影出前端数据；无数据库、无运行时后端
- 技术方案：文件优先（content-as-code）+ 静态导出 + 纯前端 SPA

## 快速开始

```bash
npm run dev            # http://localhost:5173（默认进入「族群分布」模式）
npm run project        # data/source/*.json -> data/export/atlas.json（校验 + 投影，改数据后重跑）
npm run audit          # 覆盖审计：逐年扫描核心几何「先有族群后空白」断档
npm run collisions     # 调色板碰撞审计：同年同国同色异族群对（目标 0）
npm run favicon        # 由自有 NUTS 几何生成 favicon（SVG + PNG 回退）
npm run smoke          # headless 冒烟：加载/时间轴/hover/零网络验证 + 截图
```

## 数据文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `data/source/peoples.json` | 手写（真实源） | 79 族群全量：双语名/简介/谱系挂点/语言/宗教/空间时间切片（slices），顶层 relations（族群关系+文献出处）与 claims |
| `data/source/regions.json` | 手写（真实源） | 70 地区 + `geometry_rules`（71 条 SQL 地区→几何映射；**数组顺序 = 求值候选优先序**） |
| `data/source/events.json` | 手写（真实源） | 事件 + 参与族群 |
| `data/source/taxonomy.json` | 手写（真实源） | 3 棵谱系树（语言 / 历史人群 / 现代族群） |
| `data/source/reference.json` | 手写（真实源） | 语言 / 宗教 / 时期 / 枚举字典 / 文献来源 |
| `data/export/atlas.json` | 自动生成（勿手改） | 前端投影：中英 join、谱系/事件/语言宗教挂接；前端与审计脚本的唯一图谱输入；多行可读（2 空格缩进） |
| `data/processed/<源>/regions.geojson` | 自动生成 | 三源规范化几何（awmc/darmc/nuts，license 见「数据管线」一节）；全部 processed 产物（geojson/manifest/stats）均为多行可读格式——geojson 坐标行内、每环一行（`src/lib/geojson-format.ts`），其余 2 空格缩进 |

改数据只改 `data/source/`；省写约定（confidence 缺省 high、priority 缺省 0、
classification 字符串项 = member_of）与全部校验规则见 `src/build/source.ts` 头注。
历史沿革：PostgreSQL 时代的 `sql/`、`atlas-seed.json` 及其生成链已于 2026-10
退役（历史见 git log），数据原样迁入源文件。

## 脚本

| 脚本 | 作用 | 输入 | 输出 |
|---|---|---|---|
| `src/build/project.ts` | 校验 + 投影（`npm run project`） | `data/source/*.json` | `data/export/atlas.json` |
| `src/build/source.ts` | 源格式类型 / 装载 / 校验器（被 project 引用，也可单独 import） | `data/source/*.json` | 校验错误列表 |
| `src/datasources/awmc/index.ts` | AWMC 下载/规范化管线（`npm run awmc`） | AWMC 在线服务 | `data/processed/awmc/regions.geojson` |
| `src/datasources/darmc/index.ts` | DARMC 下载/规范化管线（`npm run darmc`） | DARMC 在线服务 | `data/processed/darmc/regions.geojson` |
| `src/datasources/nuts/index.ts` | NUTS 下载/规范化管线（`npm run nuts`） | NUTS 2024 + GADM 下载 | `data/processed/nuts/regions.geojson` |

改数据的完整回路：

```bash
# 编辑器直接改 data/source/*.json
npm run project                  # 校验（错即中止）+ 投影 -> atlas.json
git diff data/source data/export # 审阅本次数据变更（源 + 产物一起）
npm run audit && npm run collisions && npm run smoke   # 门禁
```

最小示例——新增一个族群：在 `data/source/peoples.json` 加一个对象（`code` /
`type` / `name.zh`+`name.en` 必填），`slices` 指向 `regions.json` 既有地区；
需要新地区时先在 `regions.json` 加地区并补 `geometry_rules` 映射。跑
`npm run project`：validator 拦漏翻/坏引用，audit 报覆盖空窗。全程无需数据库。
另见 `AGENTS.md`（编码代理工作规则，人也可读）。

## 前端（两种模式）

**族群分布（默认，源数据驱动）**：启动全量加载 atlas.json + 三源几何（带进度条），
此后**缩放/连续年份时间轴（-509 至今）/hover 全部内存运算、零网络请求**。
着色 = `people_region` 时间切片按 render_priority 取主族群；hover 面板显示
当年全部族群、语言、宗教、族群关系与当期事件（双语名直接来自源文件）。
地区（粗粒度历史地理）→ 几何的近似映射规则存于 `data/source/regions.json`
的 `geometry_rules`（71 条：NUTS L0 国家集 / 要素 id 集 / DARMC 行省名
正则 / AWMC 帝国快照四类），随 atlas.json 的 `region_geometry` 段下发，
求值器在 `src/frontend/region-map.ts`。

图例为左侧「族群谱系」树（`src/frontend/people-tree.ts`）：按 `taxonomy.json`
谱系层级组织全部族群（如 印欧语系 → 日耳曼 → 东日耳曼 → 哥特 → 东/西哥特人），
当年活动者全亮并注记活动区域、未活动者半透明；悬停树叶时地图上该族群
区域之外全部压暗（内存操作）。

当前数据为 79 个族群提供 199 条空间时间片：每个族群在自身生命周期内均有
连续覆盖。**覆盖原则：核心欧洲几何在首次有族群之后的任何年份不得空白**——
由 `npm run audit` 逐年门禁（时间轴最小步长 1 年，并报告从未覆盖的 L0
国家）。历史上由五个补丁（核心覆盖补全 → 瑞士/科索沃 → 次国家级细分
Tier 1 → 前罗马时代中欧 → 德国 Tier 2 四分 + 全面修正）累积达成，现
已全部沉淀在 `data/source/` 源文件中（数据库时代的补丁与 SQL 已退役，
历史见 git log）。
细分以族群断层线为准（比利时/瑞士三分/伊比利亚五分/布列塔尼/波兰三分/
乌克兰三分/德国四分等），非行政区划下钻，细分国家渲染 NUTS L1/L2 或
GADM 州级几何而非 L0。调色板 16 槽（Okabe-Ito + Tol muted 精选，OKLab
+ CVD 校验），`npm run collisions` 以 16 槽回绕做经验扫描：同年同国
同色异族群对为 0。豁免项：`roman_empire` AWMC 快照（帝国消亡即隐没）、
`north_africa` DARMC 行省 551 年后（非欧洲核心）。历史区间和现代国家/
构成国边界是 MVP 可视化代理，不代表精确疆界、排他领土或边界内人口
同质；近似程度记录在 `confidence` 与 `notes` 中。

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

## 项目沿革

1. **MVP**：PostgreSQL 30 表图谱 + 静态导出前端；确立全量加载 / 交互期零网络 / 中英双语
2. **五个数据补丁**累积覆盖：核心补全 → 瑞士/科索沃 → 次国家级 Tier 1 → 前罗马中欧 → 德国 Tier 2 四分；`audit` / `collisions` / `smoke` 门禁随之成型
3. **2026-10 合并**：补丁 SQL 与 `region-map.ts` 硬编码映射全部收进两份幂等 SQL + `region_geometry_rule` 表，空库重放逐表字节一致验收
4. **2026-10 文件优先切换**（当前形态）：PostgreSQL 退役，`data/source/` 五文件成为唯一真实源，`npm run project` 校验 + 投影；以「与旧库导出字节等价」验收迁移（唯一差异 = 修正 `other_name_zh` 误存英文名的旧 bug 14 处）
