-- ============================================================
-- 补丁 3：次国家级区域细分（2026-10-03）
--
-- 原则：只在「现代国界内存在贯穿多个时代的族群/语言断层线」处细分，
-- 不按行政区划机械下钻。判据与方案经用户确认（Tier 1）：
--   比利时（弗拉芒/瓦隆）、瑞士（法/德/意语区）、西班牙五分
--   （安达卢西亚/卡斯蒂利亚/加泰罗尼亚/加利西亚/巴斯克）、
--   法国（布列塔尼）、波兰三分（核心/西里西亚-波美拉尼亚/马祖里）、
--   乌克兰三分（核心/加利西亚-沃里尼亚/克里米亚）、罗马尼亚二分
--   （特兰西瓦尼亚）、萨普米（挪/瑞北部萨米）。
--
-- 新增族群 6：bretons/catalans/basques/prussians/crimean_tatars/sami
-- 退役 region：iberian_peninsula（切片迁移至葡萄牙+西语子区域）、spain
-- 中性表述：西里西亚/东普鲁士 1945 人口变迁、克里米亚 1783 年后地位，
-- 仅陈述史学共识，不做评价。幂等，可重复执行。
-- ============================================================

BEGIN;

-- ---------- 1. 新增 peoples ----------
INSERT INTO people (code, people_type, start_year, end_year, status_code, notes) VALUES
  ('bretons',        'modern',     450, NULL, 'extant',     '布列塔尼人：罗马末期自不列颠渡海的凯尔特族群后裔，布列塔尼语存续至今。'),
  ('catalans',       'modern',     900, NULL, 'extant',     '加泰罗尼亚人：加泰卢尼亚语（奥克-罗曼语近亲），阿拉贡王冠核心。'),
  ('basques',        'modern',    -500, NULL, 'extant',     '巴斯克人：欧洲唯一前印欧语言孤岛的承载者，连续定居至今。'),
  ('prussians',      'historical',-500, 1250, 'transformed','古普鲁士人：波罗的语族，条顿骑士团征服（1230–1283）后被同化。'),
  ('crimean_tatars', 'modern',    1441, NULL, 'extant',     '克里米亚鞑靼人：克里米亚汗国（1441–1783）主体，此后为少数族群。'),
  ('sami',           'modern',     500, NULL, 'extant',     '萨米人：乌拉尔语系原住民，分布于萨普米（挪/瑞/芬北部）。')
ON CONFLICT (code) DO NOTHING;

INSERT INTO people_translation (people_id, lang, name, short_description)
SELECT p.id, v.lang, v.name, v.sd
FROM people p
JOIN (VALUES
  ('bretons',        'zh', '布列塔尼人',   '不列颠凯尔特移民后裔（布列塔尼半岛）'),
  ('bretons',        'en', 'Bretons',      'Celtic descendants of British migrants (Brittany)'),
  ('catalans',       'zh', '加泰罗尼亚人', '阿拉贡王冠核心的罗曼族群'),
  ('catalans',       'en', 'Catalans',     'Romance people of the Crown of Aragón'),
  ('basques',        'zh', '巴斯克人',     '前印欧语言孤岛（巴斯克语）'),
  ('basques',        'en', 'Basques',      'Pre-Indo-European language isolate people'),
  ('prussians',      'zh', '古普鲁士人',   '波罗的语族，被条顿骑士团同化'),
  ('prussians',      'en', 'Old Prussians','Baltic people assimilated by the Teutonic Order'),
  ('crimean_tatars', 'zh', '克里米亚鞑靼人','克里米亚汗国（1441–1783）主体'),
  ('crimean_tatars', 'en', 'Crimean Tatars','People of the Crimean Khanate (1441-1783)'),
  ('sami',           'zh', '萨米人',       '萨普米的原住民（驯鹿畜牧）'),
  ('sami',           'en', 'Sami',         'Indigenous people of Sápmi (reindeer herding)')
) AS v(code, lang, name, sd) ON v.code = p.code
ON CONFLICT (people_id, lang) DO NOTHING;

-- ---------- 2. taxonomy 节点 + 翻译 ----------
-- language 树新增巴斯克孤立语系根节点
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, 'basque', NULL, 500
FROM taxonomy t WHERE t.code = 'language'
ON CONFLICT (taxonomy_id, code) DO NOTHING;

INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, v.lang, v.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id AND t.code = 'language'
JOIN (VALUES ('basque', 'zh', '巴斯克语系（孤立）'), ('basque', 'en', 'Basque (isolate)')) AS v(code, lang, name)
  ON v.code = n.code
ON CONFLICT (taxonomy_node_id, lang) DO NOTHING;

-- modern_ethnicity / historical_people 节点（sort 取该树最大值+10，追加在尾部）
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, NULL,
       (SELECT COALESCE(MAX(n2.sort_order), 0) + v.step FROM taxonomy_node n2 WHERE n2.taxonomy_id = t.id)
FROM taxonomy t
JOIN (VALUES ('modern_ethnicity', 'bretons', 10), ('modern_ethnicity', 'catalans', 20),
      ('modern_ethnicity', 'basques', 30), ('modern_ethnicity', 'crimean_tatars', 40),
      ('modern_ethnicity', 'sami', 50), ('historical_people', 'prussians', 10)) AS v(tcode, code, step) ON true
WHERE t.code = v.tcode
ON CONFLICT (taxonomy_id, code) DO NOTHING;

INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, v.lang, v.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id
JOIN (VALUES
  ('modern_ethnicity', 'bretons',        'zh', '布列塔尼人'),   ('modern_ethnicity', 'bretons',        'en', 'Bretons'),
  ('modern_ethnicity', 'catalans',       'zh', '加泰罗尼亚人'), ('modern_ethnicity', 'catalans',       'en', 'Catalans'),
  ('modern_ethnicity', 'basques',        'zh', '巴斯克人'),     ('modern_ethnicity', 'basques',        'en', 'Basques'),
  ('modern_ethnicity', 'crimean_tatars', 'zh', '克里米亚鞑靼人'),('modern_ethnicity', 'crimean_tatars', 'en', 'Crimean Tatars'),
  ('modern_ethnicity', 'sami',           'zh', '萨米人'),       ('modern_ethnicity', 'sami',           'en', 'Sami'),
  ('historical_people','prussians',      'zh', '古普鲁士人'),   ('historical_people','prussians',      'en', 'Old Prussians')
) AS v(tcode, code, lang, name) ON v.code = n.code AND t.code = v.tcode
ON CONFLICT (taxonomy_node_id, lang) DO NOTHING;

-- ---------- 3. 分类：modern_ethnicity + language 双挂 ----------
INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', v.conf
FROM (VALUES
  ('bretons',        'modern_ethnicity', 'bretons',        'high'),
  ('bretons',        'language',         'celtic',         'high'),
  ('catalans',       'modern_ethnicity', 'catalans',       'high'),
  ('catalans',       'language',         'romance',        'high'),
  ('basques',        'modern_ethnicity', 'basques',        'high'),
  ('basques',        'language',         'basque',         'high'),
  ('crimean_tatars', 'modern_ethnicity', 'crimean_tatars', 'high'),
  ('crimean_tatars', 'language',         'turkic',         'high'),
  ('crimean_tatars', 'language',         'kipchak',        'medium'),
  ('sami',           'modern_ethnicity', 'sami',           'high'),
  ('sami',           'language',         'uralic',         'high'),
  ('prussians',      'historical_people','prussians',      'high'),
  ('prussians',      'language',         'baltic',         'high')
) AS v(pcode, tcode, ncode, conf)
JOIN people p ON p.code = v.pcode
JOIN taxonomy t ON t.code = v.tcode
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code = v.ncode
ON CONFLICT (people_id, taxonomy_node_id, relation_code) DO NOTHING;

-- ---------- 4. 新增 region（17）----------
INSERT INTO region (code, region_type, notes) VALUES
  ('flanders',          'cultural_region',  '比利时弗拉芒大区（荷兰语区）'),
  ('wallonia',          'cultural_region',  '比利时瓦隆大区+布鲁塞尔（法语区近似）'),
  ('switzerland_west',  'cultural_region',  '瑞士法语区（莱芒湖区 NUTS CH01 近似）'),
  ('switzerland_east',  'cultural_region',  '瑞士德语区（CH02–06 近似，含罗曼什谷地）'),
  ('ticino',            'cultural_region',  '瑞士意大利语区（提契诺州）'),
  ('andalusia',         'cultural_region',  '安达卢西亚+穆尔西亚（安达卢斯核心）'),
  ('castile',           'cultural_region',  '卡斯蒂利亚（含阿斯图里亚斯/莱昂/马德里/加那利）'),
  ('catalonia',         'cultural_region',  '加泰罗尼亚+阿拉贡+巴伦西亚+巴利阿里（阿拉贡王冠）'),
  ('galicia',           'cultural_region',  '加利西亚（斯维汇王国核心区）'),
  ('basque_country',    'cultural_region',  '巴斯克自治州+纳瓦拉（瓦斯科尼亞）'),
  ('brittany',          'cultural_region',  '布列塔尼（阿莫里卡半岛）'),
  ('silesia_pomerania', 'historical_region','西里西亚+波美拉尼亚（收复领土）'),
  ('masuria',           'historical_region','马祖里（东普鲁士故地南部）'),
  ('galicia_volhynia',  'historical_region','加利西亚-沃里尼亚（乌克兰西部各州近似）'),
  ('crimea',            'historical_region','克里米亚半岛（含塞瓦斯托波尔）'),
  ('transylvania',      'historical_region','特兰西瓦尼亚+克里沙纳（NUTS 西北/中心区近似）'),
  ('samiland',          'cultural_region',  '萨普米（挪威北角+瑞典上/中诺尔兰；芬兰拉普兰暂并入芬兰近似）')
ON CONFLICT (code) DO NOTHING;

INSERT INTO region_translation (region_id, lang, name)
SELECT r.id, v.lang, v.name
FROM region r
JOIN (VALUES
  ('flanders',          'zh', '弗拉芒'),              ('flanders',          'en', 'Flanders'),
  ('wallonia',          'zh', '瓦隆'),                ('wallonia',          'en', 'Wallonia'),
  ('switzerland_west',  'zh', '瑞士法语区'),          ('switzerland_west',  'en', 'French Switzerland'),
  ('switzerland_east',  'zh', '瑞士德语区'),          ('switzerland_east',  'en', 'German Switzerland'),
  ('ticino',            'zh', '提契诺'),              ('ticino',            'en', 'Ticino'),
  ('andalusia',         'zh', '安达卢西亚'),          ('andalusia',         'en', 'Andalusia'),
  ('castile',           'zh', '卡斯蒂利亚'),          ('castile',           'en', 'Castile'),
  ('catalonia',         'zh', '加泰罗尼亚'),          ('catalonia',         'en', 'Catalonia'),
  ('galicia',           'zh', '加利西亚'),            ('galicia',           'en', 'Galicia'),
  ('basque_country',    'zh', '巴斯克地区'),          ('basque_country',    'en', 'Basque Country'),
  ('brittany',          'zh', '布列塔尼'),            ('brittany',          'en', 'Brittany'),
  ('silesia_pomerania', 'zh', '西里西亚-波美拉尼亚'),  ('silesia_pomerania', 'en', 'Silesia-Pomerania'),
  ('masuria',           'zh', '马祖里（东普鲁士）'),   ('masuria',           'en', 'Masuria (East Prussia)'),
  ('galicia_volhynia',  'zh', '加利西亚-沃里尼亚'),    ('galicia_volhynia',  'en', 'Galicia-Volhynia'),
  ('crimea',            'zh', '克里米亚'),            ('crimea',            'en', 'Crimea'),
  ('transylvania',      'zh', '特兰西瓦尼亚'),        ('transylvania',      'en', 'Transylvania'),
  ('samiland',          'zh', '萨普米（拉普兰）'),     ('samiland',          'en', 'Sápmi (Lapland)')
) AS v(code, lang, name) ON v.code = r.code
ON CONFLICT (region_id, lang) DO NOTHING;

-- ---------- 5. 退役 iberian_peninsula / spain（切片已迁移至子区域与 portugal） ----------
DELETE FROM people_region WHERE region_id IN (SELECT id FROM region WHERE code IN ('iberian_peninsula', 'spain'));
DELETE FROM region_translation WHERE region_id IN (SELECT id FROM region WHERE code IN ('iberian_peninsula', 'spain'));
DELETE FROM region WHERE code IN ('iberian_peninsula', 'spain');
UPDATE people SET start_year = 711 WHERE code = 'spaniards';

-- ---------- 6. 新增 people_region 切片 ----------
INSERT INTO people_region (people_id, region_id, presence_code, start_year, end_year, confidence_code, render_priority, notes)
SELECT p.id, r.id, v.presence, v.sy, v.ey, v.conf, v.pr, v.notes
FROM (VALUES
  -- 比利时
  ('gauls',  'flanders', 'homeland',          -500,  500, 'medium', 60, '比利时高卢（门奈皮/贝尔盖人）'),
  ('franks', 'flanders', 'political_control',  450,  900, 'medium', 90, '萨利安法兰克核心区（图尔奈—根特一带）'),
  ('dutch',  'flanders', 'homeland',           900, NULL, 'medium', 70, '弗拉芒（低地法兰克语演化）'),
  ('gauls',  'wallonia', 'homeland',          -500,  500, 'medium', 60, '贝尔盖高卢'),
  ('franks', 'wallonia', 'political_control',  450,  900, 'medium', 90, '里普阿里安法兰克—加洛林'),
  ('french', 'wallonia', 'settlement',         900, NULL, 'low',    50, '瓦隆（奥伊语东渐；布鲁塞尔按法语多数近似归入）'),
  -- 瑞士三分
  ('gauls',       'switzerland_west', 'settlement',        -500,  -50, 'medium', 50, '海尔维蒂人（凯尔特）'),
  ('romans',      'switzerland_west', 'political_control',  -50,  476, 'high',   60, '上日耳曼尼亚—雷蒂亚行省'),
  ('burgundians', 'switzerland_west', 'settlement',         443,  534, 'medium', 50, '勃艮第王国（日内瓦—洛桑一带）'),
  ('franks',      'switzerland_west', 'political_control',  534,  900, 'medium', 90, '法兰克征服勃艮第后统治'),
  ('french',      'switzerland_west', 'settlement',         900, NULL, 'low',    50, '瑞士法语区（沃/日内瓦/纳沙泰尔；语言边界中世纪方定型）'),
  ('gauls',   'switzerland_east', 'settlement',            -500,  -50, 'medium', 50, '拉埃托人/海尔维蒂东境'),
  ('romans',  'switzerland_east', 'political_control',      -50,  476, 'high',   60, '雷蒂亚/诺里库姆行省'),
  ('germans', 'switzerland_east', 'settlement',             476, NULL, 'medium', 70, '阿勒曼尼定居→施瓦本→瑞士德语区（罗曼什谷地并入近似）'),
  ('franks',  'switzerland_east', 'political_control',      534,  900, 'medium', 90, '法兰克（墨洛温—加洛林）统治期叠加层'),
  ('gauls',    'ticino', 'settlement',        -500,  -50, 'medium', 50, '山南高卢（勒蓬蒂人）'),
  ('romans',   'ticino', 'political_control',  -50,  476, 'high',   60, '意大利行省北境'),
  ('ostrogoths','ticino','political_control',  476,  568, 'medium', 90, '奥多亚克—东哥特王国（476 西罗马终结至伦巴第入关）'),
  ('lombards', 'ticino', 'political_control',  568, 1000, 'medium', 90, '伦巴第王国—米兰主教区势力'),
  ('italians', 'ticino', 'settlement',        1000, NULL, 'medium', 50, '提契诺（1515 年后并入瑞士邦联，意大利语区）'),
  -- 伊比利亚五分
  ('iberians',  'andalusia', 'homeland',          -1000,  100, 'high',   60, '塔尔提索斯—伊比利亚诸部（安达卢斯故地）'),
  ('romans',    'andalusia', 'political_control',  -200,  476, 'high',   60, '倍提卡行省'),
  ('visigoths', 'andalusia', 'political_control',   400,  711, 'medium', 90, '西哥特王国（托莱多）'),
  ('moors',     'andalusia', 'political_control',   711, 1492, 'high',   90, '安达卢斯（科尔多瓦哈里发—格拉纳达）'),
  ('spaniards', 'andalusia', 'homeland',           1492, NULL, 'high',   70, '卡斯蒂利亚再征服后（格拉纳达陷落）'),
  ('celtiberians', 'castile', 'homeland',          -500,  100, 'medium', 60, '克尔特伊比利亚/瓦凯伊诸部（含加拉伊克人北境近似）'),
  ('romans',       'castile', 'political_control', -200,  476, 'high',   60, '近西班牙/倍提卡行省'),
  ('visigoths',    'castile', 'political_control',  400,  711, 'medium', 90, '西哥特王国核心'),
  ('spaniards',    'castile', 'homeland',           711, NULL, 'medium', 70, '阿斯图里亚斯抵抗（718 科瓦东加传说）→莱昂—卡斯蒂利亚'),
  ('iberians',  'catalonia', 'homeland',          -1000,  100, 'high',   60, '东北伊比利亚诸部'),
  ('romans',    'catalonia', 'political_control',  -200,  476, 'high',   60, '塔拉科行省'),
  ('visigoths', 'catalonia', 'political_control',   400,  711, 'medium', 90, '西哥特王国（巴塞罗那）'),
  ('moors',     'catalonia', 'political_control',   711,  801, 'medium', 90, '安达卢斯上边区（785/801 年法兰克夺取前）'),
  ('franks',    'catalonia', 'political_control',  801,  987, 'medium', 90, '西班牙边区（马雷斯·希斯帕尼卡）'),
  ('catalans',  'catalonia', 'homeland',           987, NULL, 'medium', 70, '博雷利二世事实独立后加泰卢尼亚；含阿拉贡王冠（1249 后瓦伦西亚/巴利阿里）'),
  ('celtiberians', 'galicia', 'homeland',          -500,  100, 'medium', 60, '加拉伊克人（凯尔特伊比利亚）'),
  ('romans',       'galicia', 'political_control', -200,  476, 'high',   60, '加利西亚行省'),
  ('suebi',        'galicia', 'homeland',           409,  585, 'high',   65, '斯维汇王国（加利西亚核心，定都布拉加）'),
  ('visigoths',    'galicia', 'political_control',  585,  711, 'medium', 90, '西哥特吞并斯维汇王国后'),
  ('spaniards',    'galicia', 'homeland',           711, NULL, 'medium', 70, '并入阿斯图里亚斯—莱昂—卡斯蒂利亚'),
  ('basques', 'basque_country', 'homeland',        -500, NULL, 'high',   65, '瓦斯科尼亞：前印欧语言孤岛，罗马—西哥特—法兰克期保持连续（含纳瓦拉）'),
  -- 葡萄牙补完整时间线（原 iberian_peninsula 切片迁移）
  ('lusitanians', 'portugal', 'homeland',          -500,  100, 'high',   60, '卢西塔尼亚人（维里亚图斯）'),
  ('romans',      'portugal', 'political_control', -200,  476, 'high',   60, '卢西塔尼亚行省'),
  ('suebi',       'portugal', 'homeland',           409,  585, 'high',   60, '斯维汇王国定都布拉加（409–585）'),
  ('visigoths',   'portugal', 'political_control',  585,  711, 'medium', 90, '西哥特王国'),
  ('moors',       'portugal', 'political_control',  711, 1249, 'medium', 90, '加尔卜（安达卢斯西部）；1249 阿尔加维陷落完成再征服'),
  -- 法国：布列塔尼
  ('gauls',   'brittany', 'settlement',         -500,  -50, 'medium', 50, '阿莫里卡半岛凯尔特诸部（文内蒂人）'),
  ('romans',  'brittany', 'political_control',  -50,  450, 'medium', 60, '里昂那行省—阿莫里卡'),
  ('bretons', 'brittany', 'homeland',            450, NULL, 'high',   65, '罗马末期不列颠凯尔特渡海（布列塔尼语存续至今）'),
  -- 波兰三分
  ('slavs',   'poland',            'settlement',         550, 1000, 'low',    60, '西斯拉夫部落（波兰人前身，皮亚斯特兴起于核心区）'),
  ('slavs',   'silesia_pomerania', 'settlement',         550, 1000, 'low',    60, '西斯拉夫部落（西里西亚/波美拉尼亚诸部）'),
  ('poles',   'silesia_pomerania', 'political_control', 1000, 1250, 'medium', 65, '皮亚斯特诸公国（梅什科—波列斯瓦夫）'),
  ('germans', 'silesia_pomerania', 'settlement',        1250, 1945, 'medium', 65, '德意志东进（Ostsiedlung）：波希米亚王冠/勃兰登堡/波美拉尼亚公爵治下德语城市带'),
  ('poles',   'silesia_pomerania', 'homeland',          1945, NULL, 'high',   70, '战后边界西移与人口迁徙（收复领土）'),
  ('prussians', 'masuria', 'homeland',             -500, 1250, 'medium', 60, '古普鲁士人（波罗的语族）：普鲁森诸部'),
  ('germans',  'masuria', 'settlement',            1250, 1945, 'medium', 65, '条顿骑士团国（1230 起）—普鲁士公国—东普鲁士'),
  ('poles',    'masuria', 'homeland',              1945, NULL, 'high',   70, '马祖里划归波兰（战后）'),
  -- 乌克兰三分
  ('goths',      'ukraine',           'settlement',         200,  400, 'medium', 50, '切尔尼亚霍夫文化（哥特—斯基泰混合带近似）'),
  ('slavs',      'ukraine',           'settlement',         400, 1000, 'low',    60, '东斯拉夫部落扩张'),
  ('slavs',      'galicia_volhynia',  'settlement',         550, 1000, 'low',    60, '东斯拉夫部落（杜列伯—沃伦人）'),
  ('ukrainians', 'galicia_volhynia',  'homeland',          1000, NULL, 'medium', 65, '加利西亚—沃里尼亚公国；乌克兰西部（含外喀尔巴阡/布科维纳近似）'),
  ('goths',           'crimea', 'settlement',         250, 1440, 'low',    50, '克里米亚哥特人（存续至晚期中世纪；涵盖可萨/库曼时期近似）'),
  ('crimean_tatars',  'crimea', 'homeland',          1441, NULL, 'medium', 60, '克里米亚汗国（1441–1783）；此后处少数族群地位'),
  ('russians',        'crimea', 'political_control', 1783, NULL, 'medium', 90, '俄罗斯帝国吞并（1783）；现代归属存在争议，此处仅作政治控制层'),
  -- 罗马尼亚二分
  ('dacians',   'transylvania', 'homeland',          -500,  300, 'high',   60, '达契亚核心（奥勒什蒂耶山地）'),
  ('goths',     'transylvania', 'migration',          300,  450, 'medium', 40, '哥特人迁入后罗马达契亚'),
  ('slavs',     'transylvania', 'settlement',         450, 1000, 'low',    60, '斯拉夫部落定居'),
  ('hungarians','transylvania', 'political_control', 1000, 1918, 'high',   90, '匈牙利王国圣伊什特万王冠领（含特兰西瓦尼亚萨克森殖民未单列）'),
  ('romanians', 'transylvania', 'homeland',          1000, NULL, 'high',   60, '罗马尼亚人多数（1918 联合后优先显示）'),
  ('dacians',  'romania', 'homeland',          -500,  300, 'high',   60, '达契亚（巴纳特/蒙特尼亚/摩尔达维亚）'),
  ('goths',    'romania', 'migration',           300,  450, 'medium', 40, '哥特人迁入期'),
  ('slavs',    'romania', 'settlement',          450, 1000, 'low',    60, '斯拉夫部落定居'),
  -- 萨普米
  ('sami', 'samiland', 'homeland', 500, NULL, 'medium', 70, '萨普米：驯鹿畜牧原住民（挪威北角+瑞典诺尔兰；芬兰拉普兰并入芬兰近似）')
) AS v(pcode, rcode, presence, sy, ey, conf, pr, notes)
JOIN people p ON p.code = v.pcode
JOIN region r ON r.code = v.rcode
ON CONFLICT DO NOTHING;

COMMIT;
