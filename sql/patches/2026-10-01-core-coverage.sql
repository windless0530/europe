-- ============================================================
-- 补丁 1：核心欧洲覆盖空窗修复（2026-10-01）
-- 依据 scripts/coverage-audit.ts 基线审计（16 个核心几何存在
-- 「先有族群后空白」断档）。本补丁可重复执行（幂等）。
--
-- 原则：保守——只用现有族群优先；确需新族群者 3 个
-- （阿瓦尔人 / 巴伐利亚人 / 摩尔人），均为填补空窗不可绕开的
-- 历史主导势力。年份断点取公认纪年：
--   496 克洛维胜阿勒曼尼 | 711 瓜达莱特/格拉纳达陷落终点 1492
--   788 查理曼并巴伐利亚 | 804 撒克逊战争终/丹麦王朝兴起
--   843→900 凡尔登后东/西法兰克过渡 | 900 现代民族起点前移
-- 豁免（不在本补丁范围）：
--   north_africa DARMC 行省 551 后（非欧洲核心，伊斯兰期超出项目范围）
--   awmc roman_empire 快照 477 后（帝国消亡即隐没，属设计）
-- ============================================================

BEGIN;

-- ---------- 1. 新增 region：austria（此前 51 region 中缺失） ----------
INSERT INTO region (code, region_type, notes)
VALUES ('austria', 'modern_country', '奥地利现代国界空间代理')
ON CONFLICT (code) DO NOTHING;

INSERT INTO region_translation (region_id, lang, name)
SELECT r.id, v.lang, v.name FROM region r, (VALUES ('zh','奥地利'), ('en','Austria')) AS v(lang, name)
WHERE r.code = 'austria'
ON CONFLICT (region_id, lang) DO NOTHING;

-- ---------- 2. 新增 peoples：avars / bavarians / moors ----------
INSERT INTO people (code, people_type, start_year, end_year, status_code, notes) VALUES
  ('avars',     'historical', 567,  799, 'transformed', '阿瓦尔人，567 年建汗国统治喀尔巴阡盆地，796–803 年为查理曼与保加尔人所灭。'),
  ('bavarians', 'historical', 550,  788, 'transformed', '巴伐利亚人（阿吉洛尔夫王朝），788 年塔西洛被废，并入法兰克王国。'),
  ('moors',     'historical', 711, 1492, 'transformed', '安达卢斯摩尔人（阿拉伯—柏柏尔），711 年入侵伊比利亚，1492 年格拉纳达陷落。')
ON CONFLICT (code) DO NOTHING;

INSERT INTO people_translation (people_id, lang, name, short_description)
SELECT p.id, v.lang, v.name, v.sd
FROM people p
JOIN (VALUES
  ('avars',     'zh', '阿瓦尔人',        '阿瓦尔汗国（喀尔巴阡盆地）'),
  ('avars',     'en', 'Avars',           'Avar Khaganate (Carpathian Basin)'),
  ('bavarians', 'zh', '巴伐利亚人',      '阿吉洛尔夫王朝巴伐利亚公国'),
  ('bavarians', 'en', 'Bavarians',       'Agilolfing Duchy of Bavaria'),
  ('moors',     'zh', '摩尔人（安达卢斯）', '安达卢斯的阿拉伯—柏柏尔政权'),
  ('moors',     'en', 'Moors (al-Andalus)', 'Arab-Berber polities of al-Andalus')
) AS v(code, lang, name, sd) ON v.code = p.code
ON CONFLICT (people_id, lang) DO NOTHING;

-- ---------- 3. 历史民族 taxonomy 节点 + 翻译 ----------
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, NULL, v.sort
FROM taxonomy t
JOIN (VALUES ('avars', 250), ('bavarians', 260), ('moors', 270)) AS v(code, sort) ON true
WHERE t.code = 'historical_people'
ON CONFLICT (taxonomy_id, code) DO NOTHING;

INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, v.lang, v.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id AND t.code = 'historical_people'
JOIN (VALUES
  ('avars',     'zh', '阿瓦尔人'),
  ('avars',     'en', 'Avars'),
  ('bavarians', 'zh', '巴伐利亚人'),
  ('bavarians', 'en', 'Bavarians'),
  ('moors',     'zh', '摩尔人'),
  ('moors',     'en', 'Moors')
) AS v(code, lang, name) ON v.code = n.code
ON CONFLICT (taxonomy_node_id, lang) DO NOTHING;

-- ---------- 4. 分类：avars→突厥语系；bavarians→日耳曼→西日耳曼；moors→历史摩尔人 ----------
INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', v.conf
FROM people p
JOIN (VALUES
  ('avars',     'avars',         'high'),   -- 历史民族节点
  ('avars',     'turkic',        'low'),    -- 语言归属存争议（乌古尔/蒙古/突厥混合）
  ('bavarians', 'bavarians',     'high'),
  ('bavarians', 'germanic',      'high'),
  ('bavarians', 'germanic_west', 'high'),
  ('moors',     'moors',         'high')
) AS v(pcode, ncode, conf) ON v.pcode = p.code
JOIN taxonomy_node n ON n.code = v.ncode
JOIN taxonomy t ON t.id = n.taxonomy_id AND (
  (v.ncode = 'avars' AND t.code = 'historical_people') OR
  (v.ncode = 'bavarians' AND t.code = 'historical_people') OR
  (v.ncode = 'moors' AND t.code = 'historical_people') OR
  (v.ncode = 'turkic' AND t.code = 'language') OR
  (v.ncode IN ('germanic', 'germanic_west') AND t.code = 'language')
)
ON CONFLICT (people_id, taxonomy_node_id, relation_code) DO NOTHING;

-- ---------- 5. 新增 people_region 切片 ----------
INSERT INTO people_region (people_id, region_id, presence_code, start_year, end_year, confidence_code, render_priority, notes)
SELECT p.id, r.id, v.presence, v.sy, v.ey, v.conf, v.pr, v.notes
FROM (VALUES
  ('franks',     'germany',           'political_control', 496,  900, 'high',   90, '克洛维胜阿勒曼尼后法兰克势力入德意志西南；东向经图林根至萨勒河一线'),
  ('franks',     'netherlands',       'political_control', 450,  900, 'medium', 90, '法兰克核心区（萨利安—里普阿里安法兰克故地）'),
  ('franks',     'austria',           'political_control', 788,  900, 'medium', 90, '788 年查理曼废黜塔西洛，巴伐利亚并入法兰克'),
  ('bavarians',  'austria',           'homeland',          550,  788, 'medium', 58, '阿吉洛尔夫王朝巴伐利亚公国（多瑙河上游）'),
  ('germans',    'austria',           'homeland',          900, NULL, 'medium', 70, '东法兰克—德意志—哈布斯堡奥地利德语区'),
  ('saxons',     'north_sea_coast',   'settlement',        450,  804, 'medium', 50, '大陆撒克逊人留守北德，直至查理曼撒克逊战争结束（804）'),
  ('avars',      'carpathian_basin',  'political_control', 567,  799, 'medium', 65, '阿瓦尔汗国；796–799 年查理曼战役后瓦解'),
  ('slavs',      'czechia',           'settlement',        550, 1000, 'low',    60, '西斯拉夫部落迁入波希米亚盆地（捷克人前身）'),
  ('slavs',      'slovakia',          'settlement',        550, 1000, 'low',    60, '西斯拉夫部落迁入（尼特拉公国前身）'),
  ('serbs',      'balkans',           'settlement',        700, NULL, 'low',    50, '《论帝国治理》所载塞族定居西巴尔干；近似覆盖波斯尼亚/黑山/北马其顿/阿尔巴尼亚一带'),
  ('romans',     'iberian_peninsula', 'political_control', -200, 476, 'medium', 60, '罗马行省希斯帕尼亚（第二次布匿战争后逐步征服）'),
  ('moors',      'iberian_peninsula', 'political_control', 711, 1492, 'high',   90, '安达卢斯（倭马亚—纳斯里）；1492 年格拉纳达陷落'),
  ('english',    'britannia',         'settlement',       1000, NULL, 'medium', 50, '英格兰王国统一后的不列颠岛'),
  ('french',     'gaul',              'settlement',        900, NULL, 'low',    50, '西法兰克—法兰西王国；近似同比利时法语区（瓦隆）与卢森堡')
) AS v(pcode, rcode, presence, sy, ey, conf, pr, notes)
JOIN people p ON p.code = v.pcode
JOIN region r ON r.code = v.rcode
ON CONFLICT DO NOTHING;

-- ---------- 6. 现有切片/族群年份调整（消除断点） ----------
-- 德/荷/法现代民族 1000→900（加洛林解体至千禧年间由本民族衔接）
UPDATE people_region SET start_year = 900
WHERE (people_id, region_id) = ((SELECT id FROM people WHERE code='germans'), (SELECT id FROM region WHERE code='germany'));
UPDATE people_region SET start_year = 900
WHERE (people_id, region_id) = ((SELECT id FROM people WHERE code='dutch'), (SELECT id FROM region WHERE code='netherlands'));
UPDATE people_region SET start_year = 900
WHERE (people_id, region_id) = ((SELECT id FROM people WHERE code='french'), (SELECT id FROM region WHERE code='france'));
-- 意大利人 1200→1000（伦巴第切片止于 1000，衔接首份意大利俗语文献年代）
UPDATE people_region SET start_year = 1000
WHERE (people_id, region_id) = ((SELECT id FROM people WHERE code='italians'), (SELECT id FROM region WHERE code='italy'));
-- 丹麦人 900→804（戈德弗雷丹麦王朝与查理曼同时代）
UPDATE people_region SET start_year = 804
WHERE (people_id, region_id) = ((SELECT id FROM people WHERE code='danes'), (SELECT id FROM region WHERE code='denmark'));
-- 西哥特王国终年 700→711（王国亡于瓜达莱特战役）
UPDATE people_region SET end_year = 711
WHERE (people_id, region_id) = ((SELECT id FROM people WHERE code='visigoths'), (SELECT id FROM region WHERE code='iberian_peninsula'));

UPDATE people SET start_year = 900 WHERE code IN ('germans', 'dutch', 'french');
UPDATE people SET start_year = 1000 WHERE code = 'italians';
UPDATE people SET start_year = 804 WHERE code = 'danes';
UPDATE people SET end_year = 711 WHERE code = 'visigoths';

COMMIT;
