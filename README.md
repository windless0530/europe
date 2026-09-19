# europe

欧洲历史族群图谱（个人项目）：带时间轴的欧洲地图，展示各时期各地区（次国家级粒度）的族群分布、语言、宗教与族群关系，中英双语。

- 数据库设计：`european_historical_population_atlas_v2.sql`（PostgreSQL 14+，含 schema + seed）
- 技术方案：静态导出 + 纯前端 SPA（数据管线见下，前端待建）

## 数据管线（已完成）

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
