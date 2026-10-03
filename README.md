# Europe

欧洲历史族群图谱（个人项目）：带时间轴的欧洲地图，展示各时期各地区（次国家级粒度）的族群分布、语言、宗教与族群关系，中英双语。

- 数据：`data/peoples/source/*.json`（5 个手写文件，唯一真实源）→ `npm run project` 投影出前端数据；无数据库、无运行时后端
- 技术方案：文件优先（content-as-code）+ 静态导出 + 纯前端 SPA

## 快速开始

```bash
npm install            # 首次拉取项目或依赖变化后执行
npm run dev            # http://localhost:5173（默认进入「族群分布」模式）
npm run project        # data/peoples/source/*.json -> data/peoples/export/atlas.json（校验 + 投影，改数据后重跑）
npm run audit          # 覆盖审计：逐年扫描核心几何「先有族群后空白」断档
npm run collisions     # 调色板碰撞审计：同年同国同色异族群对（目标 0）
npm run favicon        # 由自有 NUTS 几何生成 favicon（SVG + PNG 回退）
npm run smoke          # headless 冒烟：加载/时间轴/hover/零网络验证 + 截图；需先在另一终端运行 npm run dev
```

日常启动只需 `npm run dev`；仓库已提交 `data/peoples/export/atlas.json` 和三源
`data/geography/processed/*/regions.geojson`，启动前无需重跑下述数据管线。

## 数据文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `data/peoples/source/peoples.json` | 手写（真实源） | 88 族群全量：双语名/简介/谱系挂点/语言/宗教/空间时间切片（slices，可带双语 `caveat` 标注：`disputed` 争议 / `method` 处理说明，可选 `years` 显示窗口，投影给前端），顶层 relations（族群关系+文献出处）与 claims |
| `data/peoples/source/regions.json` | 手写（真实源） | 80 地区 + `geometry_rules`（81 条地区→几何映射规则；**数组顺序 = 求值候选优先序**） |
| `data/peoples/source/events.json` | 手写（真实源） | 事件 + 参与族群 |
| `data/peoples/source/taxonomy.json` | 手写（真实源） | 3 棵谱系树（语言 / 历史人群 / 现代族群） |
| `data/peoples/source/reference.json` | 手写（真实源） | 语言 / 宗教 / 时期 / 枚举字典 / 文献来源 |
| `data/peoples/export/atlas.json` | 自动生成（勿手改） | 前端投影：双语名称展开、谱系/事件/语言宗教挂接；前端与审计脚本的唯一图谱输入；多行可读（2 空格缩进） |
| `data/geography/raw/<源>/` | 自动下载（不提交） | AWMC / DARMC / NUTS + GADM 的原始文件与下载元数据，作为几何管线输入 |
| `data/geography/processed/<源>/regions.geojson` | 自动生成 | 三源规范化几何（awmc/darmc/nuts，license 见「数据管线」一节）；全部 processed 产物（geojson/manifest/stats）均为多行可读格式——geojson 坐标行内、每环一行（`src/lib/geojson-format.ts`），其余 2 空格缩进 |

改数据只改 `data/peoples/source/`；省写约定（confidence 缺省 high、priority 缺省 0、
classification 字符串项 = member_of）与全部校验规则见 `src/build/source.ts` 头注。
历史沿革：PostgreSQL 时代的 `sql/`、`atlas-seed.json` 及其生成链已于 2026-10
退役（历史见 git log），数据原样迁入源文件。

## 脚本

| 脚本 | 作用 | 输入 | 输出 |
|---|---|---|---|
| `src/build/project.ts` | 校验 + 投影（`npm run project`） | `data/peoples/source/*.json` | `data/peoples/export/atlas.json` |
| `src/build/source.ts` | 源格式类型 / 装载 / 校验器（被 project 引用，也可单独 import） | `data/peoples/source/*.json` | 校验错误列表 |
| `src/datasources/awmc/index.ts` | AWMC 下载/规范化管线（`npm run awmc`） | AWMC GitHub 发布文件 | `data/geography/processed/awmc/regions.geojson` |
| `src/datasources/darmc/index.ts` | DARMC 下载/规范化管线（`npm run darmc`） | DARMC ArcGIS Online Feature Service | `data/geography/processed/darmc/regions.geojson` |
| `src/datasources/nuts/index.ts` | NUTS 下载/规范化管线（`npm run nuts`） | GISCO NUTS 2024 + GADM 发布文件 | `data/geography/processed/nuts/regions.geojson` |

这些命令按以下时机执行，并非都是服务启动命令：

| 命令 | 执行时机 |
|---|---|
| `npm install` | 首次拉取项目或 `package.json` / lockfile 变化后 |
| `npm run dev` | 启动本地开发服务；这是唯一常规启动命令 |
| `npm run project` | 修改 `data/peoples/source/*.json` 后，重新校验并投影 `atlas.json` |
| `npm run awmc` / `darmc` / `nuts` | 对应几何产物缺失、上游数据更新或需要重新规范化时；下载阶段才访问外网，完成后即退出 |
| `npm run data -- list/status/compare/check` | 按需查看数据源、产物状态及一致性 |
| `npm run data -- use <源>` | 需要修改几何浏览的默认数据源时（写 `atlas.config.json`） |
| `npm run audit` / `collisions` | 数据或相关渲染策略变化后执行对应审计 |
| `npm run smoke` | `npm run dev` 已在运行时执行浏览器冒烟测试 |
| `npm run build` / `npx tsc --noEmit` | 发布前或代码变更完成后验证构建与类型 |
| `npm run favicon` | 仅在需要重新生成 favicon 时 |

三条几何管线都是构建期 CLI 入口，流程为“联网下载到 `data/geography/raw/` →
规范化到 `data/geography/processed/` → 校验后退出”，不会启动常驻服务。前端启动时只读取
已经生成的本地静态产物；若相应产物缺失，请运行对应管线，而不是每次启动都重跑。

改数据的完整回路：

```bash
# 编辑器直接改 data/peoples/source/*.json
npm run project                  # 校验（错即中止）+ 投影 -> atlas.json
git diff data/peoples/source data/peoples/export # 审阅本次数据变更（源 + 产物一起）
npm run audit && npm run collisions                     # 数据门禁
npm run smoke                    # 浏览器门禁；另一终端需保持 npm run dev
npm run build && npx tsc --noEmit # 构建与类型门禁
```

最小示例——新增一个族群：在 `data/peoples/source/peoples.json` 加一个对象（`code` /
`type` / `name.zh`+`name.en` 必填），`slices` 指向 `regions.json` 既有地区；
需要新地区时先在 `regions.json` 加地区并补 `geometry_rules` 映射。跑
`npm run project`：validator 拦漏翻/坏引用，audit 报覆盖空窗。全程无需数据库。
另见 `AGENTS.md`（编码代理工作规则，人也可读）。

## 前端（两种模式）

**族群分布（默认，源数据驱动）**：启动全量加载 atlas.json + 三源几何（带进度条），
此后**缩放/连续年份时间轴（-509 至今）/hover 全部内存运算、零网络请求**。
着色 = `people_region` 时间切片按 render_priority 取主族群；hover 面板显示
当年全部族群、语言、宗教、族群关系与当期事件（双语名直接来自源文件）。
地区（粗粒度历史地理）→ 几何的近似映射规则存于 `data/peoples/source/regions.json`
的 `geometry_rules`（112 条：NUTS L0 国家集 / 要素 id 集（NUTS 码可写上级码匹配全部下级单元；含 DARMC 303 年行省 id）/ DARMC 行省名
正则 / AWMC 帝国快照四类），随 atlas.json 的 `region_geometry` 段下发，
求值器在 `src/frontend/region-map.ts`。同国且所属地区完全相同的渲染单元在启动时溶解为
一个要素（`atlasGeometryFeatures` → `dissolveSameRegion`），地图只画有信息的边界（如德国 38 个 L2 单元显示为 4 区）。

图例为左侧「族群谱系」树（`src/frontend/people-tree.ts`）：按 `taxonomy.json`
谱系层级组织全部族群（如 印欧语系 → 日耳曼 → 东日耳曼 → 哥特 → 东/西哥特人），
当年活动者全亮并注记活动区域、未活动者半透明；悬停树叶时地图上该族群
区域之外全部压暗（内存操作）。

**标注**：时间片的 `caveat` 在其显示窗口内以地图纹理提示——交叉斜线 =
争议、细单线 = 处理说明（纹理只覆盖少量面积，不改底色色相）；hover 时
tooltip 提示、右侧面板显示全文。地图左下角固定显示全图着色规则与纹理图例。

当前数据为 100 个族群提供 518 条空间时间片：时间片一律落在族群寿命内
（validator 强制）；寿命内落在图外或史料空白的阶段（如马扎尔人 Etelköz
时期、匈人 454 年后东撤）不画。**覆盖原则：核心欧洲几何在首次有族群之后的任何年份不得空白**——
由 `npm run audit` 逐年门禁（时间轴最小步长 1 年，并报告从未覆盖的 L0
国家）。历史上由多个补丁（核心覆盖补全 → 瑞士/科索沃 → 次国家级细分
Tier 1 → 前罗马时代中欧 → 德国 Tier 2 四分 + 全面修正 → 五国 Tier 3
细分）累积达成，现
已全部沉淀在 `data/peoples/source/` 源文件中（数据库时代的补丁与 SQL 已退役，
历史见 git log）。
细分以族群断层线为准（比利时/瑞士三分/伊比利亚五分/布列塔尼/波兰三分/
乌克兰五分：西部加-沃/中北部/东斯洛博达-顿巴斯/南新俄罗斯/克里米亚，
东部与南部在 1650/1550 年代垦殖前按「荒野」留白/德国四分/奥地利西-东二分/
匈牙利外多瑙-大平原二分/挪威·瑞典·芬兰各分本部与北部（北挪威、上诺尔兰、拉普兰：萨米人底层，
分别于 1300/1600/1700 年转为挪威人/瑞典人/芬兰人）/
法国六分：北法-阿基坦-朗格多克-勃艮第-普罗旺斯-阿尔萨斯·洛林（另布列塔尼、卢森堡）/
意大利本土三分：北-中-南（另两岛）/希腊北-南（含群岛）-克里特-东马其顿·色雷斯/北非七分：埃及-昔兰尼加-的黎波里塔尼亚-
伊夫里基亚-努米底亚-中马格里布-北摩洛哥，几何统一取 DARMC 303 年行省单层/土耳其按
NUTS L2 归为东色雷斯+安纳托利亚十二区（君士坦丁堡、比提尼亚、爱奥尼亚、潘菲利亚、
奇里乞亚、加拉太、吕考尼亚、卡帕多奇亚、帕夫拉戈尼亚、本都、亚美尼亚高原南北、
东南安纳托利亚）/黎凡特五分：叙利亚-腓尼基-巴勒斯坦-阿拉伯行省-贾兹拉，取 DARMC
303 年行省；塞浦路斯等），
非行政区划下钻，细分国家渲染 NUTS L1/L2 或
GADM 州级几何而非 L0；另有部分细分叠加单元（`OVERLAY_UNITS`：芬兰拉普兰
与北卡累利阿、俄罗斯卡累利阿/鞑靼斯坦/巴什科尔托斯坦），
所属国家保留 L0、仅叠加次级单元。调色板 64 槽（构造管线
`scripts/pick-palette.mjs` 色环网格池 + `scripts/palette-tune.ts` 按实际
共现槽对爬山优化，OKLab ΔE + Machado CVD 模拟）——族群→槽位映射写死在
`src/frontend/atlas.ts` 的 `PEOPLE_SLOT`（同一族群颜色跨时间、跨数据版本
一致是硬约束）；同年同屏异族颜色尽量避免冲突（尽力而为：同年 45 团共现
超出全对 CVD 可分上限，弱对由谱系树 + hover 次级编码消歧），新族群运行时
按同年共现贪心补位，`npm run collisions` 逐年复验。
北非/黎凡特 DARMC 行省与 NUTS 核心几何同受零空窗门禁，无豁免项（AWMC 罗马帝国
117 年快照已不再映射：其覆盖范围已由更细地区取代）。地区若带存续年份
（`regions.json` 的 `years`），存续期外其独占几何不绘制、hover 不再落到该地区。历史区间和现代国家/
构成国边界是 MVP 可视化代理，不代表精确疆界、排他领土或边界内人口
同质；近似程度记录在 `confidence` 与 `notes` 中。

**着色原则**：约 1800 年起（有普查数据）按人口多数着色，不涉政治归属
（例：克里米亚 1900 年起为俄族、特兰西瓦尼亚 1800 年起为罗马尼亚人）；
此前缺乏人口数据，按统治者 / 主要人群着色。奥斯曼统治不画政治层，仅以
土耳其裔少数族群层表示（北非、黎凡特的奥斯曼与殖民/委任统治时期同理，以主体人群着色并带 caveat）。中世纪人群以现代族名标示时（如马其顿人、拉脱
维亚人）或存在史学争议时，时间片带 `caveat` 标注说明。

**几何浏览**：三源原始几何 + 快照时间轴（`src/datasources/` 各自 README）。

代码：`src/frontend/`（main/map/timeline/legend/people-tree/panel/load/atlas/region-map/i18n/palette/state）。
开发期数据经 vite 中间件白名单直读 `data/geography/processed/` 与 `data/peoples/export/`。

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
| `data/geography/raw/<源>/` | 原始下载缓存（gitignore） |
| `data/geography/processed/<源>/` | 规范化产物（regions/places/lines + manifest） |
| `docs/data-contract.md` | 管线硬性规范 |
| `docs/data-sources.md` | 三源对比与选源指南 |

原始下载在 `data/geography/raw/`（gitignore）。各源字段映射、license、已知问题见
`src/datasources/<源>/README.md`。

## 项目沿革

1. **MVP**：PostgreSQL 30 表图谱 + 静态导出前端；确立全量加载 / 交互期零网络 / 中英双语
2. **五个数据补丁**累积覆盖：核心补全 → 瑞士/科索沃 → 次国家级 Tier 1 → 前罗马中欧 → 德国 Tier 2 四分；`audit` / `collisions` / `smoke` 门禁随之成型
3. **2026-10 合并**：补丁 SQL 与 `region-map.ts` 硬编码映射全部收进两份幂等 SQL + `region_geometry_rule` 表，空库重放逐表字节一致验收
4. **2026-10 文件优先切换**（当前形态）：PostgreSQL 退役，`data/peoples/source/` 五文件成为唯一真实源，`npm run project` 校验 + 投影；以「与旧库导出字节等价」验收迁移（唯一差异 = 修正 `other_name_zh` 误存英文名的旧 bug 14 处）
