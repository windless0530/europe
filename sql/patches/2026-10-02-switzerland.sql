-- ============================================================
-- 补丁 2：瑞士覆盖（2026-10-02）
--
-- 背景：52 个 region 中没有任何一个映射到瑞士（CH），导致瑞士
-- 几何「从未覆盖」而永久空白（审计对从未覆盖几何不可见）。
-- 本补丁可重复执行（幂等）。
--
-- 原则：零新增族群——5 条切片全部复用现有族群，衔接断点取公认纪年：
--   -50 凯撒征服海尔维蒂人 | 443 勃艮第王国（都日内瓦一带）
--   476 西罗马终结 | 534 法兰克征服勃艮第 | 900 加洛林解体
-- 现代段以「德意志人 settlement 900–今」近似（施瓦本/阿勒曼尼区，
-- 瑞士德语区为主体，多语言现实记录于 notes，confidence=medium）。
-- ============================================================

BEGIN;

-- ---------- 1. 新增 region：switzerland ----------
INSERT INTO region (code, region_type, notes)
VALUES ('switzerland', 'modern_country', '瑞士现代国界空间代理')
ON CONFLICT (code) DO NOTHING;

INSERT INTO region_translation (region_id, lang, name)
SELECT r.id, v.lang, v.name FROM region r, (VALUES ('zh','瑞士'), ('en','Switzerland')) AS v(lang, name)
WHERE r.code = 'switzerland'
ON CONFLICT (region_id, lang) DO NOTHING;

-- ---------- 2. people_region 切片（全部为现有族群） ----------
INSERT INTO people_region (people_id, region_id, presence_code, start_year, end_year, confidence_code, render_priority, notes)
SELECT p.id, r.id, v.presence, v.sy, v.ey, v.conf, v.pr, v.notes
FROM (VALUES
  ('gauls',       'switzerland', 'settlement',        -500,  -50, 'medium', 50, '海尔维蒂人（凯尔特/高卢系），至凯撒征服（前 58 年）'),
  ('romans',      'switzerland', 'political_control',  -50,  476, 'high',   60, '罗马行省：比利时其卡/上日耳曼尼亚/雷蒂亚/诺里库姆'),
  ('burgundians', 'switzerland', 'settlement',         443,  534, 'medium', 50, '勃艮第王国（萨伏依—日内瓦一带，覆盖瑞士西部）'),
  ('franks',      'switzerland', 'political_control',  534,  900, 'medium', 90, '法兰克王国征服勃艮第（534）后的墨洛温—加洛林统治'),
  ('germans',     'switzerland', 'settlement',         900, NULL, 'medium', 70, '东法兰克—神圣罗马帝国施瓦本区；瑞士德语区为主体（近似，法语/意大利/罗曼什语区未单列）')
) AS v(pcode, rcode, presence, sy, ey, conf, pr, notes)
JOIN people p ON p.code = v.pcode
JOIN region r ON r.code = v.rcode
ON CONFLICT DO NOTHING;

COMMIT;
