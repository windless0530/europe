# 功能清单（以代码为主干）

本文按代码实际行为整理项目全部功能，供人读并与 README 互补；代码变更后随改。
标注「当前」的数字来自当前数据快照（`data/peoples/source/` + 导出产物），会随数据演进。

## 1. 总体形态与硬约束

- 纯静态前端 SPA，**无数据库、无运行时后端**（PostgreSQL 30 表架构已于 2026-10 退役，见 README 项目沿革）。
- 图谱数据唯一真实源 = `data/peoples/source/` 5 个手写 JSON（peoples / regions / events / taxonomy / reference）；
  `npm run project` 校验 + 投影出 `data/peoples/export/atlas.json` 与 `atlas-geometry.geojson`（勿手改）。
- **零网络交互保证**：启动加载 atlas.json + atlas-geometry.geojson（当前 0.4 + 4.6 MB，约为三源全量的 1/7）；
  几何浏览全量 `data/geography/processed/*/regions.geojson`（当前合计 34.8 MB）首次进入该模式 / 首次切源时按需加载一次并缓存。
  加载完成后缩放 / 时间轴 / hover / 过滤 / 点选全部内存运算，不发任何请求（smoke 逐年断言）。
- 中英双语：所有面向用户的文案 zh + en 双份（i18n 字典 `src/frontend/i18n.ts`，当前 66 键；数据侧 name/label 均双语）。
- 站点挂子路径 `/europe/`（`vite.config.ts` base）；dev 中间件白名单直读 `data/geography/processed/` 与 `data/peoples/export/`，
  并为剥前缀的反向代理补回 base。

## 2. 数据管线（`src/datasources/` + `src/lib/contract.ts`）

三条构建期 CLI 管线（下载 → 规范化 → 校验后退出，非常驻服务），产出统一契约的几何：

| 源 | 命令 | 内容 | 特色处理 |
|---|---|---|---|
| AWMC | `npm run awmc` | 罗马帝国快照 + Strabo 族群领地 + 线/地点（ODbL） | 帝国同年多要素 dissolve；ethnonyms 逐要素；下载幂等（`_meta.json`） |
| DARMC | `npm run darmc` | 行省/王国多边形 + 聚落点（当前 18,887 个，CC BY-NC-SA） | ArcGIS 分页下载（f=geojson, outSR=4326）；prov117/303/500 + kingdoms814/1000/1200/1450 七层；行省简化 0.001°、王国 0.002° |
| NUTS | `npm run nuts` | NUTS 2024 L0-L3 + GADM 补齐（GBR/MDA/BLR/RUS/… 13 国） | GADM 补 UKR admin1（parent 覆写 nuts:ua）、微型国、缺失单元；`GADM_ADMIN1_KEEP` 白名单（RUS.6_1 / RUS.68_1）；bbox 顶点过滤；parent_code 层链 |

- 契约（`src/lib/contract.ts`）：region/place 字段、`region_code = source:slug`、环向强制（外环 CW / 洞 CCW，防 d3 补集渲染）、
  通用校验器（几何类型 / 唯一 code / 坐标有限合法）、多行可读写盘（`.geojson` 坐标行内格式 `src/lib/geojson-format.ts`）。
- 各源 validate 附 manifest（license、下载 URL、决策记录、open issues、bounds）。
- 管理 CLI（`src/cli.ts`，`npm run data`）：`list` / `status` / `compare` / `check` / `use <源>`（use 写 `atlas.config.json`，
  当前 nuts = 几何浏览默认源）。
- 渲染策略留在代码：`src/frontend/atlas.ts` 的 `SUBNATIONAL_LEVEL` / `GBR_CONSTITUENTS` / `OVERLAY_UNITS`；
  `src/datasources/*/catalog.ts` 为下载配置。

## 3. 校验与投影（`src/build/`，`npm run project`）

- **源校验**（`src/build/source.ts`，错即中止）：实体 code 唯一；taxonomy 父节点存在且不成环；people 名 i18n / 枚举 / 年份合法；
  时间片 region 存在、presence 枚举、落在族群寿命内（开端开放规则）、caveat 显示窗口落在片内、`(region, presence, start)` 不重复；
  语言/宗教引用存在；classification 节点存在；relations 双方有效且 a≠b；regions 父节点 / 年份；geometry_rules
  引用存在且不重复；events 参与者存在；语言/宗教/时期/枚举 i18n 齐全。
- **投影**（`src/build/project.ts`）：code-unit 比较排序（不用 localeCompare，保证产物字节稳定）；固定排序序——
  regions/peoples/religions 按 code，people_region 按 (region, priority DESC, people)，events/periods 按 start（null 优先）/code，
  taxonomy 按 sort/code，region_geometry 保持源文件顺序；caveat 显示窗口缺省 = 时间片年份；pinyin 检索键生成（pinyin-pro）。
- **几何子集**（`src/build/atlas-geometry.ts`）：选族群分布模式用到的要素（AWMC 快照 → DARMC id/正则 → NUTS L0/次国家级/英国构成国 → 叠加单元）；
  同国同地区集 NUTS 单元构建期溶解为一要素（turf union，`properties.members` 成员表，当前 126 要素，如德国 38 个 L2 → 4 区）；
  Douglas-Peucker 简化 0.002° + 4 位小数量化 + 逐环绕向校正；同输入同字节确定性输出；文件序 = 绘制顺序。

## 4. 界面布局

- 顶部：语言切换（中/EN）、模式切换（族群分布 ↔ 几何浏览）；几何浏览另显示数据源分段控件（AWMC/DARMC/NUTS）与图例+过滤行。
- 左栏：族群谱系树（窄屏 ≤900px 收进左侧抽屉，汉堡按钮呼出）；右栏：信息面板。
- 底部：时间轴（年份滑杆 + 时期名 + 播放钮）；地图左下角固定「着色规则 + 纹理图例」说明（仅族群分布模式）。
- 启动 / 按需加载共用全屏进度层（按字节推进 + 已载/总量 MB）。

## 5. 界面交互一览（触发 → 结果）

以下按 `src/frontend/main.ts` / `map.ts` / `timeline.ts` / `people-tree.ts` / `panel.ts` / `legend.ts` 的实际事件接线整理；
「零网络」指该交互不产生任何 HTTP 请求（进度层可见的例外已注明）。

### 5.1 通用

| 交互 | 结果 |
|---|---|
| 点「中/EN」语言切换 | 全部 UI 文案即时换语：静态文案、时间轴年份/时期名/按钮、谱系树、右侧面板、地图左下角图例、数据源控件；`html lang` 同步。地图不重涂（颜色与语言无关），已选族群/年份/悬停状态全部保持 |
| 点模式切换（↔ 几何浏览） | 切到几何浏览：谱系树抽屉缩回、汉堡钮与地图说明隐藏、图例+过滤行与源分段显示；目标源全量几何**按需加载一次**（复用进度层，显示该源自身进度；此后缓存）。切回族群分布：立即恢复（几何子集常驻内存），连续时间轴重建。悬停状态清空 |
| 点数据源分段（仅几何浏览） | 未加载过 → 按需加载一次（进度层）；已加载 → 直接重建地图几何 + 快照时间轴 + 图例，零网络。快照索引复位到第 0 项 |
| 拖动窗口 resize | 150ms 防抖后就地重投影（不重建 DOM/监听器），族群分布模式随后重涂样式 |
| 滚轮 / 双指缩放、拖动平移 | 1–40 倍缩放自由平移，纯内存；标注纹理随缩放反向缩放（视觉密度恒定）；悬停描边不受影响 |

### 5.2 族群分布模式（默认，450 年起步）

| 交互 | 结果 |
|---|---|
| 拖时间轴（连续年份，当前 -509 至今） | 地图整层重涂为该年「主族群」色（每区域取当年时间片 render_priority 最高者）；时间轴标签显示年份 + 所属时期名；谱系树重新点亮当年活动族群；若正在悬停/选中，面板与改涂同步到新年份。零网络 |
| 点时间轴「播放/暂停」 | 每 1.4s 前进一步（步长 = 跨度/120，至少 1 年），到末年循环；手动拖动滑杆自动停止播放 |
| 悬停地图区域 | 该区域描边高亮（独立 overlay，不重排 DOM）；右侧面板显示：区域名（中文模式附英文名+近似说明）、当年全部族群列表（主族群带 top 标记）、各族语言/宗教/族群关系/标注全文、该区域当年事件；跟随式提示条显示「区域 · 主族群 · 存在类型（+ 标注提示）」。移出后面板回到占位说明。零网络 |
| 悬停无族群数据的区域 | 面板显示几何名 + 「未挂接族群数据」提示 |
| 点击地图区域 | 单选该区域**当前主族群**：其当年活动区域全部改涂该族群固定色（含被更高优先级盖住的区域——按活动而非主色判定），其余区域压暗（fillOpacity 0.25），压暗区不叠纹理；谱系树出现选中条（计数 + ✕ 清除）；改涂区域的纹理换用所选族群自己的标注。同区再点 = 取消。零网络 |
| 点击海洋 / 空白 / 无族群数据区域 | 取消当前选中，恢复全亮主流着色 |
| 拖动年份（选中保持时） | 选中不丢失，地图按新年份重新改涂/压暗（选中是持久聚焦，移开谱系树也不恢复全亮） |
| 悬停谱系树叶子 | 地图上该族群当年活动区之外全部压暗（临时聚焦，与点击同规则）；叶子旁弹固定定位 tooltip（滚动自动隐藏）。已单选时让位于持久聚焦。零网络 |
| 点击谱系树叶子 | 与「点击地图区域」同一入口的单选开关：选中/再点取消；选中条 ✕ 与点空白等效 |
| 谱系树「显示未点亮」开关 | 树在「仅当年活动族群」与「全量族群（未活动半透明）」间切换；选择记入 cookie（`ptree-show-inactive`，365 天），刷新后保持。地图不受影响 |
| 谱系树过滤器输入 | 按中文包含 / 英文（不区分大小写）/ 拼音全拼 / 拼音首字母匹配叶名；命中分支自动展开；无匹配显示占位行；✕ 清空后恢复且展开状态保持。零网络（纳入冒烟门禁） |

### 5.3 几何浏览模式

| 交互 | 结果 |
|---|---|
| 拖时间轴（离散快照年，steps 滑杆） | 地图切换到该快照年的几何家族（people/empire/provinces/kingdoms/nuts 分族配色）；标签显示年份 + 时代名（DARMC 各快照配双语时代名）；图例家族计数更新。DARMC 同年王国层激活时行省层自动隐藏。零网络 |
| 点播放 | 逐快照循环步进 |
| 单一版本源（如 NUTS） | 时间轴禁用并显示「该数据源只有单一现代版本」提示 |
| 悬停区域 | 描边高亮 + 面板显示：名称（附另一语言名）、家族色点徽章、类型/层级/年代/数据集/原始 id 键值表 |
| 点击区域 | 无操作（点选单选仅族群分布模式） |
| NUTS 层级选择器（L0–L3） | 按层级过滤可见几何，图例联动，缓存内即时切换 |
| 「显示未断代」开关（仅 AWMC） | 显示/隐藏波斯、亚历山大等无年代实体 |

### 5.4 移动端（≤900px）

| 交互 | 结果 |
|---|---|
| 点汉堡按钮 | 谱系树抽屉滑出（全高、可滚动），遮罩出现；按钮徽标显示已选族群数（选中时为 1） |
| 点遮罩 / 抽屉头部 ✕ | 抽屉缩回 |
| 轻点地图区域 | 与桌面同构：单选该区域当前主族群（触屏无悬停，选中为粘性状态，面板直接刷新）；移动 <10px 判定为轻点、更大位移判定平移 |
| 轻点海洋 | 取消选中 |
| 切到几何浏览 | 抽屉自动缩回（遮罩不得盖住几何浏览），汉堡钮隐藏 |
| 布局 | 严格无横向滚动（scrollWidth ≤ 视口，冒烟断言）；触屏不弹行内 tooltip |

### 5.5 加载与异常路径

| 场景 | 结果 |
|---|---|
| 启动 | 进度层按字节推进（atlas.json + atlas-geometry.geojson），随后几何分帧构建（~12ms 批次 + MessageChannel 让出主线程，进度持续可动），完成即首渲染 |
| 启动数据加载失败 | 进度层转失败态，显示错误信息，停在此处 |
| 几何浏览某源加载失败 | 进度层转失败态；**点击进度层**返回上一个已加载的数据源（若无则回族群分布模式） |
| 缺色族群（PEOPLE_COLOR 无条目） | 以中性灰 #8a8a8a 绘制并 console.error（`npm run collisions` 门禁拦截上线） |

## 6. 着色与数据语义（读图规则）

- 主族群竞争：每区域取当年满足 yMin ≤ y ≤ yMax 的时间片中 render_priority 最高者（同分按族群 code 字典序）；跨区域同规则。
- **族群颜色硬绑定**：`src/frontend/people-colors.ts` PEOPLE_COLOR（当前 100 条，亮/暗两色）——不随年份、不随其他族群、
  不随数据版本变化；既有条目冻结（族群删除条目保留，同码复用即复用原色）；前端只查表不分配。
- 标注纹理：`disputed` 交叉斜线 / `method` 细单线，仅在 caveat 显示窗口（缺省 = 时间片年份）内出现；纹理只盖薄层不改底色色相；
  溶解要素按成员单元展开。
- 谱系树：3 棵树（语言 / 历史人群 / 现代族群，优先序 0/1/2），族群挂最深层节点、单叶同码提升；当年活动者全亮并注记区域。
- 时间轴范围 = periods + people_region 端点包络，下限兜 -500、上限兜当前年；年份格式化分公元前 / 公元 <1500 / 现代。
- 地区（粗粒度历史地理）→ 几何映射：`regions.json` 的 `geometry_rules`（当前 112 条 = l0_country 30 + source_id 82，
  NUTS 码可写上级码匹配全部下级、含 DARMC 303 年行省 id；求值器另支持 name_regex / awmc_snapshot 两类，当前数据未用），
  数组顺序 = 求值候选优先序，随 atlas.json `region_geometry` 段下发，求值器 `src/frontend/region-map.ts`。
- 地区带存续年份（`years`）时，存续期外其独占几何不绘制、hover 不再落到该地区。

## 7. 跨模块基础设施

- 状态（`src/frontend/state.ts`）：单一 pub/sub store，set 按字段 diff 增量更新（hover 只刷面板/描边、年份只重涂+时间轴+树、
  语言只刷文案），悬停高频路径不做全量渲染。
- i18n（`src/frontend/i18n.ts`）：66 键字典 + fmtYear + familyNames/regionTypes。
- cookies（`src/frontend/cookies.ts`）：仅 UI 偏好持久化（当前唯一 cookie：`ptree-show-inactive`；Lax、365 天）。
- favicon（`npm run favicon`，`scripts/make-favicon.ts`）：自有 NUTS L0 几何 → bbox 裁剪 → union → 简化 → 同旋转 LAEA 64px 芯片造型，
  产出 favicon.svg + favicon-32.png + apple-touch-icon.png。

## 8. 脚本与门禁

| 命令 | 脚本 | 语义 / 失败条件 |
|---|---|---|
| `npm run project` | `src/build/project.ts` | 源校验（见 §3）错即中止；产出 atlas.json + atlas-geometry.geojson |
| `npm run audit` | `scripts/coverage-audit.ts` | 逐年（步长 1）扫描：核心几何（NUTS + DARMC 行省，含北非/黎凡特）首次有族群后任何年份空白即失败；豁免项当前为 0；从未覆盖 L0 仅提示；atlas-geometry 与重投影字节不一致（过期）即失败 |
| `npm run collisions` | `scripts/palette-collisions.ts` | 缺色族群即失败；同年同屏同色异族群对仅提示（尽力而为：45 团共现超 CVD 上限，弱对由谱系树 + hover 消歧）；未引用颜色条目仅提示 |
| `npm run colors` | `scripts/pick-people-colors.ts`（色环数学 `scripts/pick-palette.mjs`） | 只为缺色族群推荐固定色：OKLab ΔE + Machado CVD 模拟、对同年同屏族群避让、结果可复现；`--as-new` 预演 |
| `npm run smoke` | `scripts/smoke-demo.mjs` | headless 浏览器（默认 Edge；SMOKE_EXECUTABLE/SMOKE_CHANNEL/SMOKE_URL 可覆盖）全流程断言（见下），失败置非零退出码 |
| `npm run favicon` | `scripts/make-favicon.ts` | 见 §7 |
| `npm run data -- …` | `src/cli.ts` | 见 §2 |
| `npm run build` / `npx tsc --noEmit` | vite / tsc | 构建与类型门禁 |

`scripts/paint-sim.ts` 为 collisions 复刻前端涂色竞争的共享模块（非命令入口）。

smoke 覆盖要点：启动进度层 → 渲染；**交互期零网络**；谱系树 DOM 嵌套与缩进；树 hover 压暗（fillOpacity 0.25 字面量）；
中英切换；未点亮显隐；拼音过滤（全拼/首字母/无匹配/恢复）；单选改涂（盖尔人@800 三色字面量）+ 地图点选 + 空白取消 + 年份拖动保持；
覆盖回归（740 中欧+瑞士/科索沃、1300/当前 16 个次国家级单元、前 300/公元 0 前罗马、500 德国四分 ≥3 色）；
caveat 纹理窗口（ro11 / ukr_4_1 / lv）；几何浏览按需加载 + DARMC 1450；favicon 200；移动端 390×844 全套抽屉交互。

完成门禁（`AGENTS.md`）：`npm run audit && npm run collisions && npm run smoke && npm run build && npx tsc --noEmit`。

## 9. 当前数据规模快照

- 100 族群 / 518 条空间时间片（117 条带 caveat）/ 112 地区 / 112 条 geometry_rules
- 25 条族群关系、2 条 claims、7 个事件、3 棵谱系树、45 语言、8 宗教、9 时期、13 组枚举
- 导出：atlas.json 0.4 MB + atlas-geometry.geojson 4.6 MB（126 要素）；三源 processed 合计 34.8 MB（awmc 121 / darmc 378 / nuts 1940 要素）
