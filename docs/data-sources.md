# 数据源对比与选源指南

三个免费数据源均已接入统一管线（`npm run <源>`），产物遵守
[数据契约](data-contract.md)，可自由切换（`npm run data -- use <源>`）。

## 总览

| | AWMC | DARMC / MAPS | NUTS 2024 + GADM |
|---|---|---|---|
| 定位 | 古代（罗马世界） | 罗马—中世纪 | 现代 |
| regions | 121（5.8MB） | 378（12.5MB） | 1935（12.2MB） |
| places | 95 | 18,887 | — |
| lines | 446 | — | — |
| 时间语义 | 快照 -60/14/69/117/200/314 CE；Strabo 族群领地（约 7 BCE–23 CE） | 快照 117/303-324/500/814/1000/1200/1450 | vintage 2024 |
| 粒度 | 帝国整体 + 族群领地 | 行省/王国 | NUTS L0-L3 行政统计区 |
| License | ODbL v1.0 | CC BY-NC-SA 4.0 | EU 复用政策；GADM 禁再分发 |
| 重新生成 | `npm run awmc` | `npm run darmc` | `npm run nuts` |

## 各源要点

### AWMC（github.com/AWMC/geodata）

- **核心价值：109 个 Strabo 族群领地多边形**（`cultural_region`，en_name 如
  Artabrians、Callaicians、Vettonians）——伊比利亚/高卢/意大利/巴尔干/黑海北最密，
  与本项目"族群分布"直接对口，但无时间字段（成书约 7 BCE–23 CE，上时间轴需人工核定）。
- 罗马帝国范围 6 个快照（每数据集溶解为 1 个 MultiPolygon）+ 7 套行省边界**线**
  （原始即无名称 arc 线，拓扑未节点化无法重建行省面，如实保留为线）。
- 缺：凯尔特/日耳曼/斯拉夫等罗马以外族群领地面；中世纪早期王国；东欧/北欧覆盖薄。

### DARMC / Mapping Past Societies（哈佛 CGA Feature Services）

- **行省多边形快照**：ca. 117（78）/ 303-324（97，范围型 start=303 end=324）/ 500（64）——补上了 AWMC 缺的带名称行省面。
- **王国多边形快照**：ca. 814/1000/1200/1450（22/34/40/43），814 含 Anglo-Saxon
  England、Frankish Empire、West Slavs、Emirate of Cordoba 等**族群政体名**——
  对民族大迁徙后至中世纪的族群分布极有价值。
- 点网络 18,887：城市/定居点 13,626（TIMEPERIOD 分期码未换算）、重镇快照
  814/1000/1200/1450、主教区快照 600/900/1000/1200/1450。
- 几何已用 turf 简化（provinces 0.001°/kingdoms 0.002°），51.7MB→12.5MB。
- 点层含 561 个印度/中亚点（真实 Barrington 数据，bounds 东至 93.3°E）——**前端需按欧洲视口过滤**。
- 缺：500–814 之间无政权边界；东欧/北欧薄；无语言/宗教属性。

### NUTS 2024（GISCO）+ GADM 4.1

- 现代 L0=48 / L1=254 / L2=294 / L3=1339；NUTS 1786 + GADM 补齐 149
  （GBR/MDA/BLR/RUS 欧洲部分/AND/MCO/SMR/VAT/FRO + UKR 27 州）。
- 用途：时间轴现代端的固定网格；历史图层的今地名/今边界对照底图。
- `name_en` 实为 NAME_LATN 拉丁转写/国语名（NAME_ENGL 子层级是国名不可用），
  英文规范化留给后续统一翻译阶段。
- 缺：高加索三国、哈萨克斯坦乌拉尔以西、北塞浦路斯、直布罗陀等。

## 时间轴上的组合策略（建议）

```
-60 ── 117 ── 314 ── 500 ── 814 ── 1000 ── 1200 ── 1450 ── 现代
AWMC 帝国快照 + 族群领地
      DARMC 行省面          DARMC 王国面                    NUTS
```

- 古代段（至 500）：AWMC 范围 + Strabo 族群领地 + DARMC 行省面（命名政区）；
- 中世纪段（814-1450）：DARMC 王国/行省面 + 主教区/城镇点做密度参考；
- 现代段：NUTS 固定网格；
- 断档（500-814、1450-现代）是数据空窗，前端需中性色/插值策略。

## 切换数据源

```bash
npm run data -- list          # 三个源与产物就绪状态
npm run data -- use darmc     # 切换当前源（写 atlas.config.json）
npm run data -- status        # 当前源详情（含覆盖说明）
npm run data -- compare       # 三源对比表
npm run data -- check         # manifest 与产物一致性校验
```

前端导出阶段读 `atlas.config.json` 的 `source` 字段 + `loadSource()`，
一行切换，无需改代码。

## License 注意（个人使用均可，公开上线前复查）

| 源 | License | 约束 |
|---|---|---|
| AWMC | ODbL v1.0 | 署名 + 同享（衍生数据库需同许可） |
| DARMC | CC BY-NC-SA 4.0 | 非商业 + 署名 + 同享 |
| NUTS | EU Decision 2011/833/EU | 署名即可 |
| GADM（nuts 源内补齐） | 学术/非商业免费 | **禁止再分发**——公开站点需移除 GADM 派生要素或取得授权 |

## 已知共性问题

1. `name_zh` 全部为 null——中文名是下一个统一翻译阶段的任务（配合 SQL 的
   `*_translation` 表）。
2. 快照年份在 `source_props.snapshot_year`，`start_year/end_year` 留 null
   （除 DARMC 303-324 范围型）——导出阶段负责映射到时间轴。
3. 契约 `walkPositions` 的 geometry 对象 bug 已由主会话修复（三个 loader 的
   manifest bounds 均为各自校验器计算的真实值，无需重跑）。
4. SQL 的 region_type 字典建议增加 `modern_subdivision`（NUTS/GADM 层级目前
   region_type=null）。
