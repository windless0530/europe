-- ============================================================
-- 补丁 4：中欧前罗马时代覆盖（2026-10-04）
--
-- 问题：de/at/cz 首覆盖 100 年、sk 与波兰 550 年，公元 0 年
-- 附近及以前整片空白。
-- 方案：补入铁器时代两大集合称族群 + 罗马行省期 + 波兰铁器层，
-- 不动任何区域/几何。近似与断代争议均写入 notes：
--   1) 北德拉登期整体绘凯尔特色（DE 为 L0 整块，无法显南北；
--      Tier 2 细分巴伐利亚后方可精确雷蒂亚前 15/上日耳曼尼亚 74）
--   2) 波兰 5 世纪取中间值：戈多夫斯基「迁徙后空窗」vs 人口
--      连续性两说并存，450 界限低置信
--   3) 斯洛伐克前 45 年达契亚（布雷比斯塔）短暂支配并入注记
-- 幂等，可重复执行。
-- ============================================================

BEGIN;

-- ---------- 1. 新增 peoples（2 集合称） ----------
INSERT INTO people (code, people_type, start_year, end_year, status_code, notes) VALUES
  ('celts',           'ancient',   -500, 100, 'transformed', '凯尔特人（集合称）：哈尔施塔特—拉登铁器时代中欧主体族群，后分化为高卢人、伊比利亚凯尔特人与海岛凯尔特人等。'),
  ('germanic_tribes', 'ancient',   -450, 100, 'transformed', '古日耳曼人（集合称）：亚斯托夫文化铁器时代北欧/中欧族群，前 1 世纪起分化为苏维汇、法兰克、哥特等具体部族。')
ON CONFLICT (code) DO NOTHING;

INSERT INTO people_translation (people_id, lang, name, short_description)
SELECT p.id, v.lang, v.name, v.sd
FROM people p
JOIN (VALUES
  ('celts',           'zh', '凯尔特人',   '哈尔施塔特—拉登铁器时代族群集合称'),
  ('celts',           'en', 'Celts',      'Iron Age peoples of the Hallstatt and La Tène cultures'),
  ('germanic_tribes', 'zh', '古日耳曼人', '亚斯托夫文化部族时代集合称（苏维汇/法兰克等前身）'),
  ('germanic_tribes', 'en', 'Early Germanic peoples', 'Jastorf-culture tribes before the named confederations')
) AS v(code, lang, name, sd) ON v.code = p.code
ON CONFLICT (people_id, lang) DO NOTHING;

-- ---------- 2. taxonomy：historical_people 节点 + language 分类 ----------
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, NULL,
       (SELECT COALESCE(MAX(n2.sort_order), 0) + v.step FROM taxonomy_node n2 WHERE n2.taxonomy_id = t.id)
FROM taxonomy t
JOIN (VALUES ('historical_people', 'celts', 10), ('historical_people', 'germanic_tribes', 20)) AS v(tcode, code, step) ON true
WHERE t.code = v.tcode
ON CONFLICT (taxonomy_id, code) DO NOTHING;

INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, v.lang, v.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id
JOIN (VALUES
  ('historical_people', 'celts',           'zh', '凯尔特人'),
  ('historical_people', 'celts',           'en', 'Celts'),
  ('historical_people', 'germanic_tribes', 'zh', '古日耳曼人'),
  ('historical_people', 'germanic_tribes', 'en', 'Early Germanic peoples')
) AS v(tcode, code, lang, name) ON v.code = n.code AND t.code = v.tcode
ON CONFLICT (taxonomy_node_id, lang) DO NOTHING;

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM (VALUES
  ('celts',           'historical_people', 'celts'),
  ('celts',           'language',           'celtic'),
  ('germanic_tribes', 'historical_people', 'germanic_tribes'),
  ('germanic_tribes', 'language',           'germanic')
) AS v(pcode, tcode, ncode)
JOIN people p ON p.code = v.pcode
JOIN taxonomy t ON t.code = v.tcode
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code = v.ncode
ON CONFLICT (people_id, taxonomy_node_id, relation_code) DO NOTHING;

-- ---------- 3. 族群起年修正：汪达尔人前移至卢吉伊人（普热沃斯克文化） ----------
UPDATE people SET start_year = -100 WHERE code = 'vandals';

-- ---------- 4. 新增 people_region 切片 ----------
INSERT INTO people_region (people_id, region_id, presence_code, start_year, end_year, confidence_code, render_priority, notes)
SELECT p.id, r.id, v.presence, v.sy, v.ey, v.conf, v.pr, v.notes
FROM (VALUES
  -- 德/奥/捷（central_europe）：凯尔特拉登文化 -> 古日耳曼扩张
  ('celts', 'central_europe', 'settlement', -500,  -15, 'medium', 60,
   '拉登文化：波伊人（波希米亚，Boiohaemum）、文德利奇人（巴伐利亚）、诺里库姆诸部；北德同期为亚斯托夫文化（整体近似）'),
  ('germanic_tribes', 'central_europe', 'settlement', -450, 100, 'medium', 50,
   '亚斯托夫文化扩张至中德；前 8 年马科曼尼人入波希米亚、前 6 年夸迪人随进摩拉维亚'),
  -- 奥地利：罗马行省期（诺里库姆 + 福拉尔贝格属雷蒂亚）
  ('romans', 'austria', 'political_control', -15, 476, 'high', 65,
   '诺里库姆王国并入（前 16/15 年，克劳狄乌斯时正式行省化）；多瑙河为北界'),
  -- 斯洛伐克：凯尔特据点 -> 夸迪人
  ('celts', 'slovakia', 'settlement', -400, -50, 'medium', 50,
   '科蒂尼人（采铁，塔西佗记其说高卢语）、布拉迪斯拉发比亚泰克钱币区；前 45 年前后达契亚布雷比斯塔短暂支配（不单列）'),
  ('germanic_tribes', 'slovakia', 'settlement', -50, 500, 'medium', 50,
   '夸迪人（苏维汇系，瓦尼乌斯王国 19–50）+ 多瑙河中游平原伊阿济格斯（萨尔马提亚）'),
  -- 波兰核心：拉登据点 -> 汪达尔（普热沃斯克）-> 哥特（维尔巴克，hover 层）
  ('celts', 'poland', 'settlement', -380, -100, 'low', 45,
   '南境（小波兰/库亚维）拉登文化据点：钱币与输入品，人口规模有限'),
  ('vandals', 'poland', 'settlement', -100, 450, 'medium', 60,
   '卢吉伊人—汪达尔人（普热沃斯克文化，主流比定）；406 年渡莱茵西迁后余部滞留至 5 世纪中期文化消亡'),
  ('goths', 'poland', 'settlement', -100, 250, 'low', 50,
   '维尔巴克文化（主流比定哥特人）：波莫瑞—库亚维—马佐维叶，250 年前后南迁'),
  -- 西里西亚-波美拉尼亚：同波兰铁器层
  ('celts', 'silesia_pomerania', 'settlement', -380, -100, 'low', 45,
   '西里西亚拉登文化据点（新采尔克维亚类型），人口规模有限'),
  ('vandals', 'silesia_pomerania', 'settlement', -100, 450, 'medium', 60,
   '卢吉伊人—汪达尔人（普热沃斯克文化）；406 年渡莱茵西迁后余部滞留至 5 世纪中期'),
  ('goths', 'silesia_pomerania', 'settlement', -100, 250, 'low', 50,
   '维尔巴克文化（哥特人比定）：波美拉尼亚核心区，250 年前后南迁')
) AS v(pcode, rcode, presence, sy, ey, conf, pr, notes)
JOIN people p ON p.code = v.pcode
JOIN region r ON r.code = v.rcode
ON CONFLICT DO NOTHING;

-- ---------- 5. 斯拉夫切片起点前移（断代之争低置信，见补丁头注 2） ----------
UPDATE people_region SET start_year = 450
WHERE start_year = 550
  AND people_id = (SELECT id FROM people WHERE code = 'slavs')
  AND region_id IN (SELECT id FROM region WHERE code IN ('poland', 'silesia_pomerania'));

UPDATE people_region SET start_year = 500
WHERE start_year = 550
  AND people_id = (SELECT id FROM people WHERE code = 'slavs')
  AND region_id IN (SELECT id FROM region WHERE code IN ('slovakia'));

-- ---------- 6. 边界修正：西里西亚凯尔特层止年对齐汪达尔层起点 ----------
UPDATE people_region SET end_year = -100
WHERE start_year = -380 AND end_year = -120
  AND people_id = (SELECT id FROM people WHERE code = 'celts')
  AND region_id = (SELECT id FROM region WHERE code = 'silesia_pomerania');

COMMIT;
