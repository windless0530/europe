# AGENTS.md — 编码代理工作规则

人类读者的项目文档在 [README.md](README.md)；本文件是所有 coding agent 每次开工前必读的规则。

## 架构事实（不要推翻，除非用户明确要求）

- `data/peoples/source/*.json`（peoples / regions / events / taxonomy / reference 共 5 个文件）是图谱数据的**唯一真实源**；`data/peoples/export/atlas.json` 与 `data/peoples/export/atlas-geometry.geojson`（族群分布模式启动加载的几何子集）是投影产物，**勿手改**
- **无数据库、无运行时后端**。前端启动加载 atlas.json + atlas-geometry.geojson（约三源全量的 1/7）；几何浏览的三源全量 `data/geography/processed/*/regions.geojson` 在首次进入该模式 / 首次切到某数据源时按需加载一次并缓存。数据载入后缩放/时间轴/hover 全部内存运算、**零网络请求**——新功能不得引入交互期网络请求（模式/数据源的一次性按需加载除外，不得反复请求或逐帧请求）
- 渲染策略留在代码而非数据：`src/frontend/atlas-subset.ts` 的 `SUBNATIONAL_LEVEL` / `GBR_CONSTITUENTS` / `OVERLAY_UNITS`（部分细分叠加单元，L0 保留、次级单元盖上；鞑靼斯坦/巴什科尔托斯坦经 `GADM_ADMIN1_KEEP` 白名单越过 bbox 过滤），`src/datasources/*/catalog.ts`（后者与数据生成有鸡生蛋关系，属下载配置）
- 中英双语约束：所有面向用户的 name/label 需要 zh + en 两种

## 改数据回路

1. 直接编辑 `data/peoples/source/`。省写约定：`confidence` 缺省 `high`；`slice.priority` 缺省 `0`；classification 字符串项 = `{node, relation: member_of, confidence: high}`；`years: [start, end]` 两端皆空则整体省略
2. `npm run project` —— validator 会拦截坏引用 / 非法枚举 / 年份倒置 / 时间片越出族群寿命 / 谱系成环 / i18n 缺失 / 重复键。**报错必须修数据，不许绕过或放宽校验**
3. `git diff data/peoples/source data/peoples/export` 审阅变更
4. 门禁全绿才算完成：
   ```bash
   npm run audit && npm run collisions && npm run smoke && npm run build && npx tsc --noEmit
   ```
   audit 语义：核心欧洲几何在首次有族群之后的任何年份不得空白（含北非/黎凡特 DARMC 行省；当前无豁免项）

## 顺序语义（易踩坑，改动前先想清楚）

- projector 用 **code-unit 比较**排序（勿引入 `localeCompare`），保证 atlas.json 产物稳定
- `data/peoples/source/regions.json` 的 `geometry_rules` **数组顺序 = 求值候选优先序**，不可按字典序重排
- `people_region` 投影后按 (region, priority DESC, people) 排序
- **族群颜色与族群强绑定（硬约束）**：每个族群的亮/暗两色写死在 `src/frontend/people-colors.ts` 的 `PEOPLE_COLOR`，不随年份、不随其他族群、不随数据版本变化；前端只查表，不做运行时分配。**既有条目冻结**：新增族群、改疆域/谱系、改配色算法都不得改动或重排既有条目；族群删除时条目保留（同码复用即复用原色）
- 新增族群后 `npm run collisions` 会报缺色：运行 `npm run colors`（`scripts/pick-people-colors.ts`，只为缺色族群推荐、对同年同屏族群避让、结果可复现），把输出行按键序插入 `PEOPLE_COLOR`。同年同屏异族撞色是**尽力而为**（只提示不拦截；同年 45 团共现超全对 CVD 上限，弱对由谱系树 + hover 消歧），不得以改动既有族群颜色来消除

## 工作方式

- **只在用户明确要求时才 `git commit`**
- 数据**内容**变更（新增族群/改疆域/改谱系）先提案再动手：分析 → 提案 → 用户确认 → 实施；代码与管线变更可直接做
- 历史沿革见 README「项目沿革」；几何管线硬性规范见 `docs/data-contract.md`；三源对比见 `docs/data-sources.md`
- 历史：本项目 2026-10 前为 PostgreSQL 30 表架构，后切换为文件优先；旧 SQL/补丁/导出链已删除，历史见 git log。不要建议"恢复数据库"或引入 ORM/迁移框架
