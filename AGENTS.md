# AGENTS.md — 编码代理工作规则

人类读者的项目文档在 [README.md](README.md)；本文件是所有 coding agent 每次开工前必读的规则。

## 架构事实（不要推翻，除非用户明确要求）

- `data/source/*.json`（peoples / regions / events / taxonomy / reference 共 5 个文件）是图谱数据的**唯一真实源**；`data/export/atlas.json` 是投影产物，**勿手改**
- **无数据库、无运行时后端**。前端启动全量加载 atlas.json + `data/processed/*/regions.geojson`，此后缩放/时间轴/hover 全部内存运算、**零网络请求**——新功能不得引入交互期网络请求
- 渲染策略留在代码而非数据：`src/frontend/atlas.ts` 的 `SUBNATIONAL_LEVEL` / `GBR_CONSTITUENTS` / `OVERLAY_UNITS`（部分细分叠加单元，L0 保留、次级单元盖上；鞑靼斯坦/巴什科尔托斯坦经 `GADM_ADMIN1_KEEP` 白名单越过 bbox 过滤），`src/datasources/*/catalog.ts`（后者与数据生成有鸡生蛋关系，属下载配置）
- 中英双语约束：所有面向用户的 name/label 需要 zh + en 两种

## 改数据回路

1. 直接编辑 `data/source/`。省写约定：`confidence` 缺省 `high`；`slice.priority` 缺省 `0`；classification 字符串项 = `{node, relation: member_of, confidence: high}`；`years: [start, end]` 两端皆空则整体省略
2. `npm run project` —— validator 会拦截坏引用 / 非法枚举 / 年份倒置 / 谱系成环 / i18n 缺失 / 重复键。**报错必须修数据，不许绕过或放宽校验**
3. `git diff data/source data/export` 审阅变更
4. 门禁全绿才算完成：
   ```bash
   npm run audit && npm run collisions && npm run smoke && npm run build && npx tsc --noEmit
   ```
   audit 语义：核心欧洲几何在首次有族群之后的任何年份不得空白（豁免：`roman_empire` AWMC 快照、`north_africa` 551 年后）

## 顺序语义（易踩坑，改动前先想清楚）

- projector 用 **code-unit 比较**排序（勿引入 `localeCompare`），保证 atlas.json 产物稳定
- `data/source/regions.json` 的 `geometry_rules` **数组顺序 = 求值候选优先序**，不可按字典序重排
- `people_region` 投影后按 (region, priority DESC, people) 排序；族群→调色板槽位写死在 `src/frontend/atlas.ts` 的 `PEOPLE_SLOT`（数据重排/增补不改变既有族群颜色——**同一族群颜色跨时间、跨版本一致是硬约束**），仅无槽位的新族群由 `assignPaletteSlots` 按首现顺序对「同年同屏共现」运行时贪心补位
- 调色板 64 槽（`scripts/pick-palette.mjs` 色环网格池 + `scripts/palette-tune.ts` 按实际共现槽对爬山优化；数据变更后重跑调优器并回填 `CATEGORICAL_LIGHT/DARK` + `PEOPLE_SLOT`）。同年同屏异族颜色避免冲突是**尽力而为**（同年 45 团共现超全对 CVD 上限，弱对由谱系树 + hover 消歧）；`npm run collisions` 逐年复验避让不变量

## 工作方式

- **只在用户明确要求时才 `git commit`**
- 数据**内容**变更（新增族群/改疆域/改谱系）先提案再动手：分析 → 提案 → 用户确认 → 实施；代码与管线变更可直接做
- 历史沿革见 README「项目沿革」；几何管线硬性规范见 `docs/data-contract.md`；三源对比见 `docs/data-sources.md`
- 历史：本项目 2026-10 前为 PostgreSQL 30 表架构，后切换为文件优先；旧 SQL/补丁/导出链已删除，历史见 git log。不要建议"恢复数据库"或引入 ORM/迁移框架
