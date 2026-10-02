-- ============================================================
-- 补丁 5：德国 Tier 2 细分 + 全图同类问题修正（2026-10-05）
--
-- 起因：500 年「德国=伦巴第」暴露两类问题——
--   1) central_europe（德+奥+捷）一刀切，伦巴第 200–568 家园盖满
--      德境（实际人在易北河下游→摩拉维亚/北潘诺尼亚）；
--   2) 一几何属多区域时后写覆盖（已在 paintAt 修复，本补丁配数据）。
-- 全面体检发现并一并修正（同类=错位/过宽/断代/空白）：
--   德国四分（旧萨克森/施瓦本-法兰克/图林根-劳西茨/巴伐利亚）
--   潘诺尼亚补罗马-匈人-格皮德链（匈牙利 567 前空白）
--   斯堪的纳维亚补古日耳曼-诺斯链（挪/瑞 900 前空白）
--   波罗的人补立/拉 1000 前空白；皮克特人补苏格兰 200–843
--   英格兰/威尔士构成国 450–1000 空白（L0 被构成国覆盖所致）
--   意大利伦巴第止年 774（原 1000）、法兰克人入高卢 358（原 200/450）
--   巴尔干补罗马行省层；波斯尼亚/黑山/马其顿补本国族群层
--   丹麦人 804→500；死区清理（germany/frankish_gaul/switzerland/
--   britannia/visigothic_kingdom/ostrogothic_kingdom）
-- 中性表述：波斯尼亚克族/马其顿人/黑山人的认同边界存在当代争议，
-- 仅作族群分布可视化，notes 记述史学依据。幂等，可重复执行。
-- ============================================================

BEGIN;

-- ---------- 1. 新增 peoples（10） ----------
INSERT INTO people (code, people_type, start_year, end_year, status_code, notes) VALUES
  ('alemanni',     'historical', 200,  506, 'transformed', '阿勒曼尼人：上莱茵-美因日耳曼部落联盟，260 年后占居阿格里德库玛特斯，496/506 年被法兰克臣服，后演化为施瓦本人。'),
  ('thuringians',  'historical', 400,  531, 'transformed', '图林根人：中德意志王国（赫尔蒙德里人后裔传统），531 年被法兰克与萨克森联合吞并。'),
  ('huns',         'historical', 375,  469, 'transformed', '匈人：草原游牧联盟，阿提拉时期（434–453）以潘诺尼亚为政治核心，语言无确切记载。'),
  ('gepids',       'historical', 400,  567, 'transformed', '格皮德人：东日耳曼部族，469 年内道战役击败匈人后据蒂萨河流域建国，567 年被阿瓦尔人灭亡。'),
  ('norse',        'historical', 200,  900, 'transformed', '诺斯人：铁器时代晚期-维京时代北日耳曼人，丹麦/瑞典/挪威人与诺曼人的前身。'),
  ('picts',        'ancient',    200,  843, 'transformed', '皮克特人：苏格兰东部-北部族群联盟，皮克特语归属有争议（凯尔特语系假说为主流），843 年与达尔里雅达合并为阿尔巴。'),
  ('balts',        'ancient',   -500, 1000, 'transformed', '波罗的人：东波罗的铁器时代部落（立陶宛人/拉脱维亚人/古普鲁士人的前身）。'),
  ('bosniaks',     'modern',    1300, NULL, 'extant',     '波斯尼亚克族：中世纪波斯尼亚班国-王国（1154–1463）人口基础，现代认同主要成型于奥斯曼时期。'),
  ('macedonians',  'modern',     900, NULL, 'extant',     '马其顿人：萨穆伊尔帝国（976–1014）以降的马其顿-奥赫里德斯拉夫传统；与保加利亚认同的史学表述差异见 notes，此处取中世纪区域传统。'),
  ('montenegrins', 'modern',    1000, NULL, 'extant',     '黑山人：杜克利亚（泽塔）公国 1043 年以降传统；与塞尔维亚人认同边界存在当代差异，此处按杜克利亚-泽塔传统单列。')
ON CONFLICT (code) DO NOTHING;

INSERT INTO people_translation (people_id, lang, name, short_description)
SELECT p.id, v.lang, v.name, v.sd
FROM people p
JOIN (VALUES
  ('alemanni',     'zh', '阿勒曼尼人', '上莱茵部落联盟，施瓦本人前身'),
  ('alemanni',     'en', 'Alemanni',   'Upper Rhine confederation, ancestors of the Swabians'),
  ('thuringians',  'zh', '图林根人',   '中德意志王国（531 年亡）'),
  ('thuringians',  'en', 'Thuringians','Kingdom of central Germany (fell 531)'),
  ('huns',         'zh', '匈人',       '阿提拉草原联盟（潘诺尼亚核心）'),
  ('huns',         'en', 'Huns',       'Steppe confederation of Attila (Pannonian core)'),
  ('gepids',       'zh', '格皮德人',   '内道战役后据蒂萨河建国'),
  ('gepids',       'en', 'Gepids',     'Tisza kingdom after the Battle of Nedao'),
  ('norse',        'zh', '诺斯人',     '维京时代北日耳曼人'),
  ('norse',        'en', 'Norse',      'North Germanic peoples of the Viking Age'),
  ('picts',        'zh', '皮克特人',   '苏格兰东部-北部族群联盟'),
  ('picts',        'en', 'Picts',      'Confederacy of northern and eastern Scotland'),
  ('balts',        'zh', '波罗的人',   '立陶宛/拉脱维亚人前身'),
  ('balts',        'en', 'Balts',      'Ancestors of Lithuanians and Latvians'),
  ('bosniaks',     'zh', '波斯尼亚克族','中世纪波斯尼亚王国人口基础'),
  ('bosniaks',     'en', 'Bosniaks',   'Population base of medieval Bosnia'),
  ('macedonians',  'zh', '马其顿人',   '萨穆伊尔帝国以降的区域斯拉夫传统'),
  ('macedonians',  'en', 'Macedonians','Slavic tradition since Samuel''s empire'),
  ('montenegrins', 'zh', '黑山人',     '杜克利亚-泽塔公国传统'),
  ('montenegrins', 'en', 'Montenegrins','Tradition of Duklja and Zeta')
) AS v(code, lang, name, sd) ON v.code = p.code
ON CONFLICT (people_id, lang) DO NOTHING;

-- ---------- 2. taxonomy 节点 + 分类 ----------
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, NULL,
       (SELECT COALESCE(MAX(n2.sort_order), 0) + v.step FROM taxonomy_node n2 WHERE n2.taxonomy_id = t.id)
FROM taxonomy t
JOIN (VALUES
  ('historical_people', 'alemanni', 10), ('historical_people', 'thuringians', 20),
  ('historical_people', 'huns', 30), ('historical_people', 'gepids', 40),
  ('historical_people', 'norse', 50), ('historical_people', 'picts', 60),
  ('historical_people', 'balts', 70),
  ('modern_ethnicity', 'bosniaks', 10), ('modern_ethnicity', 'macedonians', 20),
  ('modern_ethnicity', 'montenegrins', 30)
) AS v(tcode, code, step) ON true
WHERE t.code = v.tcode
ON CONFLICT (taxonomy_id, code) DO NOTHING;

INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, v.lang, v.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id
JOIN (VALUES
  ('historical_people', 'alemanni',     'zh', '阿勒曼尼人'),   ('historical_people', 'alemanni',     'en', 'Alemanni'),
  ('historical_people', 'thuringians',  'zh', '图林根人'),     ('historical_people', 'thuringians',  'en', 'Thuringians'),
  ('historical_people', 'huns',         'zh', '匈人'),         ('historical_people', 'huns',         'en', 'Huns'),
  ('historical_people', 'gepids',       'zh', '格皮德人'),     ('historical_people', 'gepids',       'en', 'Gepids'),
  ('historical_people', 'norse',        'zh', '诺斯人'),       ('historical_people', 'norse',        'en', 'Norse'),
  ('historical_people', 'picts',        'zh', '皮克特人'),     ('historical_people', 'picts',        'en', 'Picts'),
  ('historical_people', 'balts',        'zh', '波罗的人'),     ('historical_people', 'balts',        'en', 'Balts'),
  ('modern_ethnicity',  'bosniaks',     'zh', '波斯尼亚克族'), ('modern_ethnicity',  'bosniaks',     'en', 'Bosniaks'),
  ('modern_ethnicity',  'macedonians',  'zh', '马其顿人'),     ('modern_ethnicity',  'macedonians',  'en', 'Macedonians'),
  ('modern_ethnicity',  'montenegrins', 'zh', '黑山人'),       ('modern_ethnicity',  'montenegrins', 'en', 'Montenegrins')
) AS v(tcode, code, lang, name) ON v.code = n.code AND t.code = v.tcode
ON CONFLICT (taxonomy_node_id, lang) DO NOTHING;

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', v.conf
FROM (VALUES
  ('alemanni',     'historical_people', 'alemanni',     'high'),
  ('alemanni',     'language',          'germanic_west','high'),
  ('thuringians',  'historical_people', 'thuringians',  'high'),
  ('thuringians',  'language',          'germanic_west','medium'),
  ('huns',         'historical_people', 'huns',         'high'),
  ('gepids',       'historical_people', 'gepids',       'high'),
  ('gepids',       'language',          'germanic_east','high'),
  ('norse',        'historical_people', 'norse',        'high'),
  ('norse',        'language',          'germanic_north','high'),
  ('picts',        'historical_people', 'picts',        'high'),
  ('balts',        'historical_people', 'balts',        'high'),
  ('balts',        'language',          'baltic',       'high'),
  ('bosniaks',     'modern_ethnicity',  'bosniaks',     'high'),
  ('bosniaks',     'language',          'south_slavic','high'),
  ('macedonians',  'modern_ethnicity',  'macedonians',  'high'),
  ('macedonians',  'language',          'south_slavic','high'),
  ('montenegrins', 'modern_ethnicity',  'montenegrins', 'high'),
  ('montenegrins', 'language',          'south_slavic','high')
) AS v(pcode, tcode, ncode, conf)
JOIN people p ON p.code = v.pcode
JOIN taxonomy t ON t.code = v.tcode
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code = v.ncode
ON CONFLICT (people_id, taxonomy_node_id, relation_code) DO NOTHING;

-- ---------- 3. 新增 region（8） ----------
INSERT INTO region (code, region_type, notes) VALUES
  ('old_saxony',        'cultural_region', '旧萨克森（德国西北）：石荷/下萨克森/不来梅/汉堡/梅克伦堡+威斯特法伦三区，NUTS L2 ×11'),
  ('swabia_francia',    'cultural_region', '施瓦本-法兰克（德国西南）：巴登-符滕堡/黑森/莱法/萨尔+莱茵兰两区，NUTS L2 ×13'),
  ('thuringia_lausitz', 'cultural_region', '图林根-劳西茨（德国中东部）：图林根/萨克森-安哈尔特/萨克森/勃兰登堡/柏林，NUTS L2 ×7；易北-萨勒以东中世纪为索布-卢蒂齐斯拉夫层'),
  ('bavaria',           'cultural_region', '巴伐利亚（德国东南）：拜恩自由州 NUTS L2 ×7'),
  ('pannonia',          'historical_region','潘诺尼亚（现代匈牙利近似）：罗马行省-匈人-格皮德-阿瓦尔链'),
  ('bosnia',            'modern_country', '波斯尼亚和黑塞哥维那'),
  ('macedonia',         'modern_country', '北马其顿'),
  ('montenegro',        'modern_country', '黑山')
ON CONFLICT (code) DO NOTHING;

INSERT INTO region_translation (region_id, lang, name)
SELECT r.id, v.lang, v.name
FROM region r
JOIN (VALUES
  ('old_saxony',        'zh', '旧萨克森（德国西北）'),   ('old_saxony',        'en', 'Old Saxony (NW Germany)'),
  ('swabia_francia',    'zh', '施瓦本-法兰克（德国西南）'),('swabia_francia',    'en', 'Swabia-Francia (SW Germany)'),
  ('thuringia_lausitz', 'zh', '图林根-劳西茨（德国中东）'),('thuringia_lausitz', 'en', 'Thuringia-Lusatia (EC Germany)'),
  ('bavaria',           'zh', '巴伐利亚（德国东南）'),   ('bavaria',           'en', 'Bavaria (SE Germany)'),
  ('pannonia',          'zh', '潘诺尼亚'),               ('pannonia',          'en', 'Pannonia'),
  ('bosnia',            'zh', '波斯尼亚'),               ('bosnia',            'en', 'Bosnia'),
  ('macedonia',         'zh', '马其顿'),                 ('macedonia',         'en', 'Macedonia'),
  ('montenegro',        'zh', '黑山'),                   ('montenegro',        'en', 'Montenegro')
) AS v(code, lang, name) ON v.code = r.code
ON CONFLICT (region_id, lang) DO NOTHING;

-- ---------- 4. 退役死区（切片已迁移/区域已细分；FK 级联删除切片） ----------
UPDATE event SET region_id = (SELECT id FROM region WHERE code = 'england')
 WHERE code = 'anglo_saxon_settlement';                                          -- 事件改挂构成国
DELETE FROM people_region WHERE region_id IN (SELECT id FROM region WHERE code IN ('germany','britannia'));
DELETE FROM region_translation WHERE region_id IN (SELECT id FROM region WHERE code IN ('germany','frankish_gaul','switzerland','britannia','visigothic_kingdom','ostrogothic_kingdom'));
DELETE FROM region WHERE code IN ('germany','frankish_gaul','switzerland','britannia','visigothic_kingdom','ostrogothic_kingdom');

-- ---------- 5. 断代修正（既有切片） ----------
UPDATE people SET end_year = 400 WHERE code = 'germanic_tribes';           -- 斯堪的纳维亚/中德切片至 400
UPDATE people_region SET end_year = 774
 WHERE people_id = (SELECT id FROM people WHERE code='lombards')
   AND region_id = (SELECT id FROM region WHERE code='italy');              -- 伦巴第王国止于查理曼
UPDATE people_region SET start_year = 490, notes = '摩拉维亚-诺里库姆迁徙期（易北河下游→卢吉兰），568 年入意大利'
 WHERE people_id = (SELECT id FROM people WHERE code='lombards')
   AND region_id = (SELECT id FROM region WHERE code='central_europe')
   AND start_year = 200;                                                    -- 伦巴第不再盖满德境
UPDATE people_region SET end_year = 489, notes = '马科曼尼-夸迪（苏维汇系）据波希米亚-摩拉维亚至匈人时代'
 WHERE people_id = (SELECT id FROM people WHERE code='suebi')
   AND region_id = (SELECT id FROM region WHERE code='central_europe')
   AND end_year = 409;                                                      -- 与伦巴第 490 衔接
DELETE FROM people_region WHERE people_id = (SELECT id FROM people WHERE code='vandals')
   AND region_id = (SELECT id FROM region WHERE code='central_europe');     -- 汪达尔层已由波兰切片承载
DELETE FROM people_region WHERE people_id = (SELECT id FROM people WHERE code='burgundians')
   AND region_id = (SELECT id FROM region WHERE code='central_europe');     -- 勃艮第层移至沃尔姆斯（施瓦本-法兰克）
UPDATE people_region SET start_year = 358
 WHERE people_id = (SELECT id FROM people WHERE code='franks')
   AND start_year IN (200, 450)
   AND region_id IN (SELECT id FROM region WHERE code IN ('gaul','flanders','wallonia','netherlands')); -- 托克桑德里亚安置
UPDATE people_region SET start_year = 500
 WHERE people_id = (SELECT id FROM people WHERE code='danes')
   AND region_id = (SELECT id FROM region WHERE code='denmark');             -- 盎格鲁人迁出后丹麦人入居日德兰
UPDATE people_region SET start_year = 843
 WHERE people_id = (SELECT id FROM people WHERE code='scots')
   AND region_id = (SELECT id FROM region WHERE code='scotland')
   AND start_year = 1000;                                                    -- 阿尔巴王国（皮克特-斯科特合并）

-- ---------- 6. 新增 people_region 切片 ----------
INSERT INTO people_region (people_id, region_id, presence_code, start_year, end_year, confidence_code, render_priority, notes)
SELECT p.id, r.id, v.presence, v.sy, v.ey, v.conf, v.pr, v.notes
FROM (VALUES
  -- 德国西北：旧萨克森-弗里西亚
  ('germanic_tribes', 'old_saxony', 'settlement', -450,  300, 'medium', 50, '亚斯托夫文化核心区（萨克森人摇篮）'),
  ('saxons',          'old_saxony', 'homeland',    300,  900, 'medium', 60, '旧萨克森部落联盟—萨克森公国（772–804 萨克森战争后并入法兰克）'),
  ('franks',          'old_saxony', 'political_control', 772, 900, 'high', 65, '查理曼萨克森战争（772–804）：维尔登洗礼与加洛林整合'),
  ('germans',         'old_saxony', 'homeland',    900, NULL, 'medium', 70, '萨克森公国（吕迪格家族—韦尔夫）归入德意志王国'),
  ('lombards',        'old_saxony', 'settlement',  200,  450, 'low',    45, '易北河下游伦巴第家园（第二阶段迁出，hover 层）'),
  ('slavs',           'old_saxony', 'settlement',  600, 1160, 'medium', 45, '梅克伦堡端奥博特里特人（hover 层，斯拉夫-萨克森边界摇摆）'),
  -- 德国西南：凯尔特-罗马边区-阿勒曼尼-法兰克
  ('celts',       'swabia_francia', 'settlement',        -500,   74, 'medium', 60, '拉登文化：沃尔凯人/特雷维里人等'),
  ('romans',      'swabia_francia', 'political_control',   74,  260, 'high',   60, '阿格里德库玛特斯—上日耳曼尼亚-雷蒂亚边区（74 年并入）'),
  ('alemanni',    'swabia_francia', 'homeland',           260,  506, 'high',   60, '260 年罗马弃守后占居；496 托尔比亚克/506 臣服法兰克'),
  ('burgundians', 'swabia_francia', 'political_control',  413,  443, 'medium', 62, '沃尔姆斯王国（413–437），余部迁萨伏依'),
  ('franks',      'swabia_francia', 'political_control',  506,  900, 'high',   65, '克洛维臣服阿勒曼尼后的法兰克-加洛林统治'),
  ('germans',     'swabia_francia', 'homeland',           900, NULL, 'medium', 70, '施瓦本-法兰克尼亚公国（德意志王国）'),
  -- 德国中东部：古日耳曼-图林根-法兰克-德意志
  ('germanic_tribes', 'thuringia_lausitz', 'settlement', -450,  400, 'medium', 50, '日耳曼部落带（赫尔蒙德里人传统）'),
  ('thuringians',     'thuringia_lausitz', 'homeland',    400,  531, 'high',   60, '图林根王国（至易北-萨勒河）'),
  ('franks',          'thuringia_lausitz', 'political_control', 531, 900, 'high', 65, '法兰克-萨克森联合吞并后加洛林东部边区'),
  ('germans',         'thuringia_lausitz', 'homeland',    900, NULL, 'medium', 70, '迈森边区-图林根方伯领（德意志东扩，索布人渐次同化）'),
  ('slavs',           'thuringia_lausitz', 'settlement',  600, 1150, 'medium', 45, '索布-卢蒂齐（易北-萨勒以东斯拉夫层，hover 显示）'),
  -- 德国东南：凯尔特-雷蒂亚-东哥特-巴伐利亚
  ('celts',      'bavaria', 'settlement',        -500,  -15, 'medium', 50, '拉埃托人（雷蒂亚）与波伊人东境'),
  ('romans',     'bavaria', 'political_control',  -15,  476, 'high',   65, '雷蒂亚行省（前 15 年并入）+ 多瑙河-伊恩河界'),
  ('ostrogoths', 'bavaria', 'political_control',  476,  552, 'medium', 60, '后罗马期东哥特王国边区（至 553 拜占庭再征服）'),
  ('bavarians',  'bavaria', 'homeland',           550,  788, 'high',   60, '巴伐利亚公国（阿吉洛尔家族，向法兰克称臣）'),
  ('franks',     'bavaria', 'political_control',  788,  900, 'high',   90, '查理曼废黜塔西洛三世，并入法兰克'),
  ('germans',    'bavaria', 'homeland',           900, NULL, 'medium', 70, '巴伐利亚公国（德意志王国核心诸侯）'),
  -- 奥地利：后罗马衔接（奥多亚克-东哥特统治诺里库姆）
  ('ostrogoths', 'austria', 'political_control', 476, 552, 'medium', 60, '奥多亚克-东哥特王国对诺里库姆的统治（圣塞维利诺时代）'),
  -- 潘诺尼亚：匈牙利 567 年前空白补全
  ('celts',   'pannonia', 'settlement',        -450,    9, 'medium', 50, '埃拉维斯奇人/斯科尔迪斯克人（潘诺尼亚凯尔特）'),
  ('romans',  'pannonia', 'political_control',    9,  433, 'high',   60, '潘诺尼亚行省（9 年大伊利里亚起义后设省）；5 世纪渐失'),
  ('huns',    'pannonia', 'political_control',  425,  469, 'high',   65, '阿提拉帝国政治核心（多瑙河中游洪泛平原为宫廷驻地）'),
  ('gepids',  'pannonia', 'homeland',           469,  567, 'high',   60, '内道战役（454/469）后格皮德王国，567 年被阿瓦尔人所灭'),
  -- 斯堪的纳维亚：诺斯链
  ('germanic_tribes', 'norway', 'settlement', -450, 200, 'medium', 50, '北欧铁器时代（前罗马-罗马时代）日耳曼人群'),
  ('norse',           'norway', 'homeland',    200, 900, 'medium', 60, '迁移时代-维京时代诺斯人（金发哈拉尔 872 统一前夜）'),
  ('germanic_tribes', 'sweden', 'settlement', -450, 200, 'medium', 50, '北欧铁器时代日耳曼人群（文德尔文化前身）'),
  ('norse',           'sweden', 'homeland',    200, 900, 'medium', 60, '迁移时代-维京时代诺斯人（瑞典人前身，伊陶瓦尔王朝）'),
  -- 波罗的海：立陶宛/拉脱维亚 1000 年前
  ('balts', 'lithuania', 'homeland', -500, 1000, 'medium', 60, '波罗的铁器时代部落（高地立陶宛文化圈）'),
  ('balts', 'latvia',    'homeland', -500, 1000, 'medium', 60, '波罗的-芬兰混合带（拉特加列人/谢米加利亚人）'),
  -- 意大利：伦巴第后法兰克期
  ('franks', 'italy', 'political_control', 774, 1000, 'high', 90, '查理曼征服伦巴第—加洛林意大利王国—奥托帝国意大利'),
  -- 巴尔干：罗马行省层
  ('romans', 'balkans', 'political_control', -100, 700, 'high', 60, '伊利里库姆/默西亚/色雷斯诸行省（前 168 起逐步设省，取 -100 近似），查士丁尼后拜占庭统治至斯拉夫定居'),
  -- 不列颠：构成国补覆盖（L0 已停绘，构成国 450–1000 曾空罩）
  ('britons', 'england', 'homeland',   -100, 650, 'medium', 56, '罗马不列颠-后罗马不列颠人（西部王国至 6 世纪中）'),
  ('angles',  'england', 'settlement',  450, 900, 'medium', 50, '盎格鲁人迁入（亨伯河口-东盎格利亚）'),
  ('jutes',   'england', 'settlement',  450, 800, 'low',    50, '朱特人（肯特-怀特岛）'),
  ('saxons',  'england', 'settlement',  450, 1000, 'high',  54, '撒克逊诸王国-韦塞克斯霸权（7 世纪起主导）'),
  ('danes',   'england', 'settlement',  865, 954, 'high',   45, '丹麦法区（异教徒大军-约克末代国王埃里克，hover 层）'),
  ('picts',   'scotland', 'homeland',  200, 843, 'medium', 65, '皮克特王国联盟；500–843 与达尔里雅达盖尔人并立（次级层），843 阿尔巴合并'),
  ('britons', 'wales', 'homeland', -100, 700, 'medium', 52, '罗马-后罗马不列颠人西部山区（坎布里亚）'),
  -- 巴尔干西部：本国族群层（填补 serbs 补底下的 700–1300 单色期）
  ('bosniaks',     'bosnia',     'homeland', 1300, NULL, 'medium', 60, '波斯尼亚班国-王国（1154–1463）人口基础；此前 700–1300 由塞尔维亚补底层过渡'),
  ('montenegrins', 'montenegro', 'homeland', 1043, NULL, 'medium', 60, '杜克利亚公国独立（1043）；泽塔传统'),
  ('macedonians',  'macedonia',  'homeland',  976, NULL, 'medium', 60, '萨穆伊尔帝国（976–1014）-奥赫里德传统')
) AS v(pcode, rcode, presence, sy, ey, conf, pr, notes)
JOIN people p ON p.code = v.pcode
JOIN region r ON r.code = v.rcode
ON CONFLICT DO NOTHING;

-- ---------- 7. 高卢修正：罗马行省期缺失（与 brittany/castile/catalonia 同构） ----------
-- gaul 区 gauls 至 500、franks 仅 50 优先级 -> 罗马征服（前 58–50）后本部仍涂高卢人直至 500，错。
INSERT INTO people_region (people_id, region_id, presence_code, start_year, end_year, confidence_code, render_priority, notes)
SELECT p.id, r.id, 'political_control', -50, 476, 'high', 60, '罗马高卢（恺撒征服前 58–50 取 -50；纳博讷早至前 121）'
FROM people p, region r WHERE p.code = 'romans' AND r.code = 'gaul'
ON CONFLICT DO NOTHING;
UPDATE people_region SET end_year = -51
 WHERE people_id = (SELECT id FROM people WHERE code='gauls')
   AND region_id = (SELECT id FROM region WHERE code='gaul')
   AND end_year IN (500, -50);                                              -- 高卢人止于恺撒征服完成前夜（-50 起罗马明确接管，避免同优先级字典序闪烁）
UPDATE people_region SET start_year = 476, render_priority = 90, notes = '克洛维击败西亚格里乌斯（481 定理姆斯取 476 近似）后的法兰克王国统治'
 WHERE people_id = (SELECT id FROM people WHERE code='franks')
   AND region_id = (SELECT id FROM region WHERE code='gaul')
   AND start_year = 358;                                                    -- 法兰克对高卢本部为政治控制

COMMIT;
