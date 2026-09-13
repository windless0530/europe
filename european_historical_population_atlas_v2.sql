-- ============================================================
-- European Historical Population Atlas — schema + seed (v2)
-- Character set: UTF-8
-- Target dialect: PostgreSQL 14+
--
-- v2 相对 european_historical_population_atlas.sql 的改动：
--   1. 修复 5 处无法执行的 seed 语句：
--      a) taxonomy_node 语言分支插入中别名 t 重复声明（语法错误）；
--      b) people_translation / event_translation 插入中列别名 desc
--         为 SQL 保留字（语法错误），统一改为 brief；
--      c) relation_source 两处逗号连接与 JOIN 混用导致
--         invalid reference（已改为标准 JOIN 链）。
--   2. taxonomy 体系调整：
--      a) language_family 与 language_branch 合并为单一 language 体系
--         （两者本来就是一棵树，原 seed 已出现跨体系挂父节点）；
--      b) 移除空置的 religious_tradition / historical_period 体系
--         （宗教层级由 religion.parent_id 表达，历史时期由新表 period 表达）。
--   3. 新增 period / period_translation 表：时间轴的时代标签。
--   4. event 增加 region_id：事件发生地，供地图标注。
--   5. people_region 增加 render_priority：同一地区同一时刻多个族群
--      并存时，决定该地区色块归属（数值越大越优先）。
--   6. 新增 enum_label 视图：把 enum 字典拉平为
--      (definition_code, value_code, lang, label)，主表 VARCHAR code
--      与字典的 join 约定由此固定（主表不加 FK，靠约定 + 视图）。
--   7. religion seed 拆为两条语句：同一条 INSERT 里的子查询取不到
--      本语句刚插入的行（语句级快照隔离），因此 catholicism 等
--      分支改为第二条语句挂到 christianity 下。
--   8. 补充时间切片索引：people_region(region_id, start_year, end_year) 等。
--   9. 所有按 code join taxonomy_node 的 seed 语句均补充 taxonomy
--      过滤，避免未来不同体系出现同名 code 时互相串数据。
--  10. taxonomy_node 语言分支按树的深度分多条语句插入：
--      同一条 INSERT 的 JOIN 看不到本语句刚插入的行（语句级
--      快照隔离），混在一批会让深层节点静默丢失。
--
-- 明确暂缓（用户决定）：
--   - 地理几何数据（region_shape / GeoJSON / PostGIS）本期不建表。
--     后端按 region.code 与外部几何数据关联即可。
--
-- ============================================================

BEGIN;

-- ============================================================
-- Part I. 基础数据表定义
-- ============================================================

-- ------------------------------------------------------------
-- 1. taxonomy：分类体系
-- ------------------------------------------------------------
CREATE TABLE taxonomy (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(100) NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    notes           TEXT
);

-- taxonomy_node：某一分类体系中的具体节点。
-- parent_id 允许形成树；约定 parent 必须属于同一个 taxonomy
-- （seed 均按此约定写入；如需强制，后续可加触发器）。
CREATE TABLE taxonomy_node (
    id              BIGSERIAL PRIMARY KEY,
    taxonomy_id     BIGINT NOT NULL REFERENCES taxonomy(id),
    parent_id       BIGINT REFERENCES taxonomy_node(id),
    code            VARCHAR(150) NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    UNIQUE (taxonomy_id, code),
    CHECK (parent_id IS NULL OR parent_id <> id)
);

-- taxonomy_node_translation：分类节点的多语言名称/说明。
CREATE TABLE taxonomy_node_translation (
    taxonomy_node_id    BIGINT NOT NULL REFERENCES taxonomy_node(id) ON DELETE CASCADE,
    lang                VARCHAR(10) NOT NULL,
    name                TEXT NOT NULL,
    short_description   TEXT,
    description         TEXT,
    PRIMARY KEY (taxonomy_node_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

-- ------------------------------------------------------------
-- 2. people：人群/民族实体
-- ------------------------------------------------------------
CREATE TABLE people (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(150) NOT NULL UNIQUE,
    people_type     VARCHAR(50) NOT NULL,
    start_year      INTEGER,
    end_year        INTEGER,
    status_code     VARCHAR(50),
    notes           TEXT,
    CHECK (people_type IN ('prehistoric', 'ancient', 'medieval', 'early_modern', 'modern', 'historical')),
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

CREATE TABLE people_translation (
    people_id           BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    lang                VARCHAR(10) NOT NULL,
    name                TEXT NOT NULL,
    short_description   TEXT,
    description         TEXT,
    PRIMARY KEY (people_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

-- people_alias：别名/历史名称/拉丁名称/异写等。
CREATE TABLE people_alias (
    id              BIGSERIAL PRIMARY KEY,
    people_id       BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    lang            VARCHAR(20),
    name            TEXT NOT NULL,
    alias_type      VARCHAR(50) NOT NULL,
    notes           TEXT
);

-- ------------------------------------------------------------
-- 3. people_classification：people 与分类节点的多对多关系
-- ------------------------------------------------------------
CREATE TABLE people_classification (
    id                  BIGSERIAL PRIMARY KEY,
    people_id           BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    taxonomy_node_id    BIGINT NOT NULL REFERENCES taxonomy_node(id) ON DELETE CASCADE,
    relation_code       VARCHAR(50) NOT NULL DEFAULT 'member_of',
    confidence_code     VARCHAR(50) NOT NULL DEFAULT 'high',
    start_year          INTEGER,
    end_year            INTEGER,
    notes               TEXT,
    UNIQUE (people_id, taxonomy_node_id, relation_code),
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

-- ------------------------------------------------------------
-- 4. language：语言实体
-- ------------------------------------------------------------
CREATE TABLE language (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(100) NOT NULL UNIQUE,
    language_type   VARCHAR(50),
    start_year      INTEGER,
    end_year        INTEGER,
    status_code     VARCHAR(50),
    notes           TEXT,
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

CREATE TABLE language_translation (
    language_id         BIGINT NOT NULL REFERENCES language(id) ON DELETE CASCADE,
    lang                VARCHAR(10) NOT NULL,
    name                TEXT NOT NULL,
    short_description   TEXT,
    description         TEXT,
    PRIMARY KEY (language_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

CREATE TABLE people_language (
    id              BIGSERIAL PRIMARY KEY,
    people_id       BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    language_id     BIGINT NOT NULL REFERENCES language(id) ON DELETE CASCADE,
    role_code       VARCHAR(50) NOT NULL,
    start_year      INTEGER,
    end_year        INTEGER,
    confidence_code VARCHAR(50) NOT NULL DEFAULT 'high',
    notes           TEXT,
    UNIQUE (people_id, language_id, role_code),
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

-- ------------------------------------------------------------
-- 5. religion：宗教/宗教传统实体
-- ------------------------------------------------------------
CREATE TABLE religion (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(100) NOT NULL UNIQUE,
    parent_id       BIGINT REFERENCES religion(id),
    notes           TEXT
);

CREATE TABLE religion_translation (
    religion_id         BIGINT NOT NULL REFERENCES religion(id) ON DELETE CASCADE,
    lang                VARCHAR(10) NOT NULL,
    name                TEXT NOT NULL,
    short_description   TEXT,
    description         TEXT,
    PRIMARY KEY (religion_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

CREATE TABLE people_religion (
    id              BIGSERIAL PRIMARY KEY,
    people_id       BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    religion_id     BIGINT NOT NULL REFERENCES religion(id) ON DELETE CASCADE,
    role_code       VARCHAR(50) NOT NULL,
    start_year      INTEGER,
    end_year        INTEGER,
    confidence_code VARCHAR(50) NOT NULL DEFAULT 'high',
    notes           TEXT,
    UNIQUE (people_id, religion_id, role_code),
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

-- ------------------------------------------------------------
-- 6. region：历史/现代地理实体
-- ------------------------------------------------------------
CREATE TABLE region (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(150) NOT NULL UNIQUE,
    region_type     VARCHAR(50) NOT NULL,
    parent_id       BIGINT REFERENCES region(id),
    start_year      INTEGER,
    end_year        INTEGER,
    notes           TEXT,
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

CREATE TABLE region_translation (
    region_id           BIGINT NOT NULL REFERENCES region(id) ON DELETE CASCADE,
    lang                VARCHAR(10) NOT NULL,
    name                TEXT NOT NULL,
    short_description   TEXT,
    description         TEXT,
    PRIMARY KEY (region_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

-- people 在某地区的存在/活动。
-- render_priority：同一地区同一时刻多个族群并存时，决定该地区
-- 色块归属的渲染优先级（数值越大越优先）。语义信息仍以
-- presence_code 为准；render_priority 只是展示层参数，可按行覆盖。
CREATE TABLE people_region (
    id              BIGSERIAL PRIMARY KEY,
    people_id       BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    region_id       BIGINT NOT NULL REFERENCES region(id) ON DELETE CASCADE,
    presence_code   VARCHAR(50) NOT NULL,
    start_year      INTEGER,
    end_year        INTEGER,
    confidence_code VARCHAR(50) NOT NULL DEFAULT 'high',
    render_priority INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    UNIQUE (people_id, region_id, presence_code, start_year),
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

-- ------------------------------------------------------------
-- 7. people_relation：people 与 people 之间的历史关系
-- ------------------------------------------------------------
CREATE TABLE people_relation (
    id              BIGSERIAL PRIMARY KEY,
    people_a_id     BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    relation_code   VARCHAR(50) NOT NULL,
    people_b_id     BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    confidence_code VARCHAR(50) NOT NULL DEFAULT 'high',
    start_year      INTEGER,
    end_year        INTEGER,
    notes           TEXT,
    CHECK (people_a_id <> people_b_id),
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

-- ------------------------------------------------------------
-- 8. event：历史事件
-- region_id 为事件发生地（供地图标注），可空。
-- ------------------------------------------------------------
CREATE TABLE event (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(150) NOT NULL UNIQUE,
    start_year      INTEGER,
    end_year        INTEGER,
    event_type_code VARCHAR(50),
    region_id       BIGINT REFERENCES region(id),
    notes           TEXT,
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

CREATE TABLE event_translation (
    event_id            BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    lang                VARCHAR(10) NOT NULL,
    name                TEXT NOT NULL,
    short_description   TEXT,
    description         TEXT,
    PRIMARY KEY (event_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

CREATE TABLE event_people (
    id              BIGSERIAL PRIMARY KEY,
    event_id        BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    people_id       BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role_code       VARCHAR(50) NOT NULL,
    notes           TEXT,
    UNIQUE (event_id, people_id, role_code)
);

-- ------------------------------------------------------------
-- 8b. period：历史时期（时间轴的时代标签）
-- 时期之间允许重叠（如 late_antiquity 与 migration_period）；
-- 年份均为惯用近似值。
-- ------------------------------------------------------------
CREATE TABLE period (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(100) NOT NULL UNIQUE,
    start_year      INTEGER,
    end_year        INTEGER,
    notes           TEXT,
    CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year)
);

CREATE TABLE period_translation (
    period_id           BIGINT NOT NULL REFERENCES period(id) ON DELETE CASCADE,
    lang                VARCHAR(10) NOT NULL,
    name                TEXT NOT NULL,
    short_description   TEXT,
    description         TEXT,
    PRIMARY KEY (period_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

-- ------------------------------------------------------------
-- 9. source：资料来源
-- ------------------------------------------------------------
CREATE TABLE source (
    id              BIGSERIAL PRIMARY KEY,
    source_type     VARCHAR(50) NOT NULL,
    title           TEXT NOT NULL,
    author          TEXT,
    publisher       TEXT,
    publication_year INTEGER,
    url             TEXT,
    isbn            TEXT,
    notes           TEXT
);

CREATE TABLE relation_source (
    relation_id     BIGINT NOT NULL REFERENCES people_relation(id) ON DELETE CASCADE,
    source_id       BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    evidence_type   VARCHAR(50),
    quote           TEXT,
    notes           TEXT,
    PRIMARY KEY (relation_id, source_id)
);

-- ------------------------------------------------------------
-- 10. claim：更细粒度的“事实主张”（预留，MVP 不填）
-- ------------------------------------------------------------
CREATE TABLE claim (
    id              BIGSERIAL PRIMARY KEY,
    subject_type    VARCHAR(50) NOT NULL,
    subject_id      BIGINT NOT NULL,
    predicate_code  VARCHAR(100) NOT NULL,
    object_type     VARCHAR(50),
    object_id       BIGINT,
    literal_value   TEXT,
    confidence_code VARCHAR(50) NOT NULL DEFAULT 'medium',
    notes           TEXT,
    CHECK (object_id IS NOT NULL OR literal_value IS NOT NULL)
);

CREATE TABLE claim_source (
    claim_id        BIGINT NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
    source_id       BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    evidence_type   VARCHAR(50),
    quote           TEXT,
    notes           TEXT,
    PRIMARY KEY (claim_id, source_id)
);

-- ============================================================
-- Part II. 多语言枚举/字典
-- 主表使用 VARCHAR code（如 presence_code = 'political_control'），
-- 不加外键；code 与字典的对应关系通过下面的 enum_label 视图固定。
-- ============================================================

CREATE TABLE enum_definition (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(100) NOT NULL UNIQUE,
    notes           TEXT
);

CREATE TABLE enum_value (
    id                  BIGSERIAL PRIMARY KEY,
    enum_definition_id  BIGINT NOT NULL REFERENCES enum_definition(id) ON DELETE CASCADE,
    code                VARCHAR(100) NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    UNIQUE (enum_definition_id, code)
);

CREATE TABLE enum_value_translation (
    enum_value_id   BIGINT NOT NULL REFERENCES enum_value(id) ON DELETE CASCADE,
    lang            VARCHAR(10) NOT NULL,
    label           TEXT NOT NULL,
    description     TEXT,
    PRIMARY KEY (enum_value_id, lang),
    CHECK (lang IN ('en', 'zh'))
);

-- enum_label：拉平后的字典视图。
-- 用法示例（取 presence_code 的中文标签）：
--   SELECT label FROM enum_label
--   WHERE definition_code = 'presence_type'
--     AND value_code = 'political_control' AND lang = 'zh';
-- LEFT JOIN 保证缺翻译的 code 也能查到（label 为 NULL，
-- 前端据此回退 fallback 语言）。
CREATE VIEW enum_label AS
SELECT ed.code        AS definition_code,
       ev.code        AS value_code,
       ev.sort_order  AS sort_order,
       t.lang         AS lang,
       t.label        AS label,
       t.description  AS description
FROM enum_definition ed
JOIN enum_value ev ON ev.enum_definition_id = ed.id
LEFT JOIN enum_value_translation t ON t.enum_value_id = ev.id;

-- ============================================================
-- Part III. 索引
-- ============================================================

CREATE INDEX idx_taxonomy_node_taxonomy
    ON taxonomy_node(taxonomy_id);

CREATE INDEX idx_taxonomy_node_parent
    ON taxonomy_node(parent_id);

CREATE INDEX idx_people_classification_people
    ON people_classification(people_id);

CREATE INDEX idx_people_classification_node
    ON people_classification(taxonomy_node_id);

CREATE INDEX idx_people_language_people
    ON people_language(people_id);

CREATE INDEX idx_people_language_language
    ON people_language(language_id);

CREATE INDEX idx_people_religion_people
    ON people_religion(people_id);

CREATE INDEX idx_people_region_people
    ON people_region(people_id);

CREATE INDEX idx_people_region_region
    ON people_region(region_id);

-- 时间切片查询（“T 年时哪些人群在该地区”）专用：
-- WHERE region_id = ? AND start_year <= T AND (end_year IS NULL OR end_year >= T)
CREATE INDEX idx_people_region_region_time
    ON people_region(region_id, start_year, end_year);

CREATE INDEX idx_people_relation_a
    ON people_relation(people_a_id);

CREATE INDEX idx_people_relation_b
    ON people_relation(people_b_id);

CREATE INDEX idx_event_people_event
    ON event_people(event_id);

CREATE INDEX idx_event_people_people
    ON event_people(people_id);

CREATE INDEX idx_event_region
    ON event(region_id);

CREATE INDEX idx_period_years
    ON period(start_year, end_year);

CREATE INDEX idx_enum_value_definition
    ON enum_value(enum_definition_id);

-- ============================================================
-- Part IV. Seed data：枚举定义与翻译
-- ============================================================

INSERT INTO enum_definition (code, notes) VALUES
('people_type', 'people 的时代/性质类型'),
('relation_type', 'people_relation 使用的关系类型'),
('confidence_level', '数据/判断的可信度等级'),
('classification_relation', 'people 与 taxonomy_node 的关系'),
('language_role', 'people 与 language 的关系'),
('religion_role', 'people 与 religion 的关系'),
('presence_type', 'people 在 region 中的存在方式'),
('event_role', 'people 在 event 中的角色'),
('event_type', '历史事件类型'),
('region_type', '地理实体类型'),
('language_type', '语言类型'),
('status', '实体状态');

INSERT INTO enum_value (enum_definition_id, code, sort_order)
SELECT id, v.code, v.sort_order
FROM enum_definition d
JOIN (VALUES
    ('people_type','prehistoric',10),
    ('people_type','ancient',20),
    ('people_type','medieval',30),
    ('people_type','early_modern',40),
    ('people_type','modern',50),
    ('people_type','historical',60),

    ('relation_type','subgroup_of',10),
    ('relation_type','part_of',20),
    ('relation_type','descended_from',30),
    ('relation_type','merged_into',40),
    ('relation_type','split_from',50),
    ('relation_type','related_to',60),
    ('relation_type','influenced',70),
    ('relation_type','conquered',80),
    ('relation_type','migrated_to',90),
    ('relation_type','ruled',100),
    ('relation_type','allied_with',110),
    ('relation_type','enemy_of',120),

    ('confidence_level','very_high',10),
    ('confidence_level','high',20),
    ('confidence_level','medium',30),
    ('confidence_level','low',40),
    ('confidence_level','disputed',50),

    ('classification_relation','member_of',10),
    ('classification_relation','associated_with',20),
    ('classification_relation','descendant_of',30),

    ('language_role','native',10),
    ('language_role','ancestral',20),
    ('language_role','administrative',30),
    ('language_role','liturgical',40),
    ('language_role','historical',50),

    ('religion_role','traditional',10),
    ('religion_role','dominant',20),
    ('religion_role','minority',30),
    ('religion_role','historical',40),

    ('presence_type','homeland',10),
    ('presence_type','settlement',20),
    ('presence_type','migration',30),
    ('presence_type','political_control',40),
    ('presence_type','minority',50),
    ('presence_type','temporary_presence',60),

    ('event_role','attacker',10),
    ('event_role','target',20),
    ('event_role','participant',30),
    ('event_role','ruler',40),
    ('event_role','migrating_group',50),
    ('event_role','founder',60),

    ('event_type','conquest',10),
    ('event_type','migration',20),
    ('event_type','battle',30),
    ('event_type','political_change',40),
    ('event_type','religious_change',50),
    ('event_type','settlement',60),

    ('region_type','continent',10),
    ('region_type','historical_region',20),
    ('region_type','political_entity',30),
    ('region_type','modern_country',40),
    ('region_type','cultural_region',50),

    ('language_type','ancient',10),
    ('language_type','medieval',20),
    ('language_type','modern',30),
    ('language_type','liturgical',40),

    ('status','extant',10),
    ('status','extinct',20),
    ('status','transformed',30),
    ('status','merged',40)
) AS v(definition_code, code, sort_order)
ON d.code = v.definition_code;

INSERT INTO enum_value_translation (enum_value_id, lang, label, description)
SELECT ev.id, x.lang, x.label, x.description
FROM enum_value ev
JOIN enum_definition ed ON ed.id = ev.enum_definition_id
JOIN (VALUES
('people_type','prehistoric','en','Prehistoric',NULL),
('people_type','prehistoric','zh','史前',NULL),
('people_type','ancient','en','Ancient',NULL),
('people_type','ancient','zh','古代',NULL),
('people_type','medieval','en','Medieval',NULL),
('people_type','medieval','zh','中世纪',NULL),
('people_type','early_modern','en','Early modern',NULL),
('people_type','early_modern','zh','近代早期',NULL),
('people_type','modern','en','Modern',NULL),
('people_type','modern','zh','现代',NULL),
('people_type','historical','en','Historical',NULL),
('people_type','historical','zh','历史时期',NULL),

('relation_type','subgroup_of','en','Subgroup of','A historical or social subgroup of another people.'),
('relation_type','subgroup_of','zh','分支','某人群是另一人群的历史或社会分支。'),
('relation_type','part_of','en','Part of',NULL),
('relation_type','part_of','zh','组成部分',NULL),
('relation_type','descended_from','en','Descended from',NULL),
('relation_type','descended_from','zh','源自',NULL),
('relation_type','merged_into','en','Merged into',NULL),
('relation_type','merged_into','zh','融入 / 合并为',NULL),
('relation_type','split_from','en','Split from',NULL),
('relation_type','split_from','zh','分化自',NULL),
('relation_type','related_to','en','Related to',NULL),
('relation_type','related_to','zh','相关于',NULL),
('relation_type','influenced','en','Influenced',NULL),
('relation_type','influenced','zh','影响了',NULL),
('relation_type','conquered','en','Conquered',NULL),
('relation_type','conquered','zh','征服了',NULL),
('relation_type','migrated_to','en','Migrated to',NULL),
('relation_type','migrated_to','zh','迁徙至',NULL),
('relation_type','ruled','en','Ruled',NULL),
('relation_type','ruled','zh','统治了',NULL),
('relation_type','allied_with','en','Allied with',NULL),
('relation_type','allied_with','zh','与……结盟',NULL),
('relation_type','enemy_of','en','Enemy of',NULL),
('relation_type','enemy_of','zh','敌对方',NULL),

('confidence_level','very_high','en','Very high',NULL),
('confidence_level','very_high','zh','非常高',NULL),
('confidence_level','high','en','High',NULL),
('confidence_level','high','zh','高',NULL),
('confidence_level','medium','en','Medium',NULL),
('confidence_level','medium','zh','中',NULL),
('confidence_level','low','en','Low',NULL),
('confidence_level','low','zh','低',NULL),
('confidence_level','disputed','en','Disputed','The interpretation is disputed or substantially debated.'),
('confidence_level','disputed','zh','存在争议','该判断存在明显史学争议。'),

('classification_relation','member_of','en','Member of',NULL),
('classification_relation','member_of','zh','属于',NULL),
('classification_relation','associated_with','en','Associated with',NULL),
('classification_relation','associated_with','zh','相关于',NULL),
('classification_relation','descendant_of','en','Descendant of',NULL),
('classification_relation','descendant_of','zh','后裔 / 后续人群',NULL),

('language_role','native','en','Native language',NULL),
('language_role','native','zh','母语',NULL),
('language_role','ancestral','en','Ancestral language',NULL),
('language_role','ancestral','zh','祖语 / 祖先语言',NULL),
('language_role','administrative','en','Administrative language',NULL),
('language_role','administrative','zh','行政语言',NULL),
('language_role','liturgical','en','Liturgical language',NULL),
('language_role','liturgical','zh','礼仪语言',NULL),
('language_role','historical','en','Historical language',NULL),
('language_role','historical','zh','历史语言',NULL),

('religion_role','traditional','en','Traditional religion',NULL),
('religion_role','traditional','zh','传统宗教',NULL),
('religion_role','dominant','en','Dominant religion',NULL),
('religion_role','dominant','zh','主要宗教',NULL),
('religion_role','minority','en','Minority religion',NULL),
('religion_role','minority','zh','少数宗教',NULL),
('religion_role','historical','en','Historical religion',NULL),
('religion_role','historical','zh','历史宗教',NULL),

('presence_type','homeland','en','Homeland',NULL),
('presence_type','homeland','zh','核心故地',NULL),
('presence_type','settlement','en','Settlement',NULL),
('presence_type','settlement','zh','定居地',NULL),
('presence_type','migration','en','Migration',NULL),
('presence_type','migration','zh','迁徙',NULL),
('presence_type','political_control','en','Political control',NULL),
('presence_type','political_control','zh','政治控制',NULL),
('presence_type','minority','en','Minority presence',NULL),
('presence_type','minority','zh','少数族群存在',NULL),
('presence_type','temporary_presence','en','Temporary presence',NULL),
('presence_type','temporary_presence','zh','短期存在',NULL),

('event_role','attacker','en','Attacker',NULL),
('event_role','attacker','zh','进攻方',NULL),
('event_role','target','en','Target',NULL),
('event_role','target','zh','目标 / 被攻击方',NULL),
('event_role','participant','en','Participant',NULL),
('event_role','participant','zh','参与方',NULL),
('event_role','ruler','en','Ruler',NULL),
('event_role','ruler','zh','统治方',NULL),
('event_role','migrating_group','en','Migrating group',NULL),
('event_role','migrating_group','zh','迁徙人群',NULL),
('event_role','founder','en','Founder',NULL),
('event_role','founder','zh','建立者',NULL),

('event_type','conquest','en','Conquest',NULL),
('event_type','conquest','zh','征服',NULL),
('event_type','migration','en','Migration',NULL),
('event_type','migration','zh','迁徙',NULL),
('event_type','battle','en','Battle',NULL),
('event_type','battle','zh','战役',NULL),
('event_type','political_change','en','Political change',NULL),
('event_type','political_change','zh','政治变迁',NULL),
('event_type','religious_change','en','Religious change',NULL),
('event_type','religious_change','zh','宗教变迁',NULL),
('event_type','settlement','en','Settlement',NULL),
('event_type','settlement','zh','定居',NULL),

('region_type','continent','en','Continent',NULL),
('region_type','continent','zh','洲',NULL),
('region_type','historical_region','en','Historical region',NULL),
('region_type','historical_region','zh','历史地区',NULL),
('region_type','political_entity','en','Political entity',NULL),
('region_type','political_entity','zh','政治实体',NULL),
('region_type','modern_country','en','Modern country',NULL),
('region_type','modern_country','zh','现代国家',NULL),
('region_type','cultural_region','en','Cultural region',NULL),
('region_type','cultural_region','zh','文化区域',NULL),

('language_type','ancient','en','Ancient language',NULL),
('language_type','ancient','zh','古代语言',NULL),
('language_type','medieval','en','Medieval language',NULL),
('language_type','medieval','zh','中世纪语言',NULL),
('language_type','modern','en','Modern language',NULL),
('language_type','modern','zh','现代语言',NULL),
('language_type','liturgical','en','Liturgical language',NULL),
('language_type','liturgical','zh','礼仪语言',NULL),

('status','extant','en','Extant',NULL),
('status','extant','zh','现存',NULL),
('status','extinct','en','Extinct',NULL),
('status','extinct','zh','已消亡',NULL),
('status','transformed','en','Transformed',NULL),
('status','transformed','zh','演变 / 转化',NULL),
('status','merged','en','Merged',NULL),
('status','merged','zh','融合 / 合并',NULL)
) AS x(definition_code, code, lang, label, description)
ON ed.code = x.definition_code
AND ev.code = x.code;

-- ============================================================
-- Part V. Seed data：分类体系（taxonomy）
-- v2：language_family + language_branch 合并为单一 language 体系，
--      语系为根节点，语族/语支逐级下挂（修复原文件一挂错树、
--      原文件二语法错误两方面的历史问题）。
-- ============================================================

INSERT INTO taxonomy (code, sort_order, notes) VALUES
('language', 10, '语言分类（语系/语族/语支，一棵树）'),
('historical_people', 30, '历史民族/历史人群'),
('modern_ethnicity', 40, '现代族群');

-- 语言体系：根节点（独立语系）
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, NULL, v.sort_order
FROM taxonomy t
JOIN (VALUES
('indo_european',10),
('uralic',20),
('kartvelian',30),
('turkic',40)
) v(code,sort_order)
ON t.code='language';

-- 语言体系：分支节点。注意必须按树的深度分批插入：
-- 同一条 INSERT 的 JOIN 看不到本语句刚插入的行（语句级快照隔离），
-- 混在一批会导致深层节点静默丢失。
-- 第一批：印欧语系下的一级分支（父节点为上条语句插入的根节点）
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, p.id, v.sort_order
FROM taxonomy t
JOIN (VALUES
('germanic','indo_european',10),
('celtic','indo_european',20),
('italic','indo_european',30),
('slavic','indo_european',40),
('baltic','indo_european',50),
('hellenic','indo_european',60),
('albanian','indo_european',70)
) v(code,parent_code,sort_order)
ON t.code='language'
JOIN taxonomy_node p ON p.taxonomy_id = t.id AND p.code = v.parent_code;

-- 第二批：二级分支（父节点为第一批及根节点，均已落库）
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, p.id, v.sort_order
FROM taxonomy t
JOIN (VALUES
('germanic_north','germanic',10),
('germanic_west','germanic',20),
('germanic_east','germanic',30),
('romance','italic',10),
('west_slavic','slavic',10),
('east_slavic','slavic',20),
('south_slavic','slavic',30),
('finnic','uralic',10),
('kartvelian_core','kartvelian',10),
('oghuz','turkic',10),
('kipchak','turkic',20)
) v(code,parent_code,sort_order)
ON t.code='language'
JOIN taxonomy_node p ON p.taxonomy_id = t.id AND p.code = v.parent_code;

-- 第三批：三级分支
INSERT INTO taxonomy_node (taxonomy_id, code, parent_id, sort_order)
SELECT t.id, v.code, p.id, v.sort_order
FROM taxonomy t
JOIN (VALUES
('gothic','germanic_east',10)
) v(code,parent_code,sort_order)
ON t.code='language'
JOIN taxonomy_node p ON p.taxonomy_id = t.id AND p.code = v.parent_code;

-- 历史民族节点
INSERT INTO taxonomy_node (taxonomy_id, code, sort_order)
SELECT t.id, v.code, v.sort_order
FROM taxonomy t
JOIN (VALUES
('goths',10),('franks',20),('angles',30),('saxons',40),('jutes',50),
('gauls',60),('britons',70),('gaels',80),('vandals',90),
('burgundians',100),('lombards',110),('suebi',120),
('visigoths',130),('ostrogoths',140),('romans',150),('latins',160),
('iberians',170),('celtiberians',180),('lusitanians',190),
('dacians',200),('illyrians',210),('thracians',220),
('slavs',230),('magyars',240)
) v(code,sort_order)
ON t.code='historical_people';

-- 现代族群节点
INSERT INTO taxonomy_node (taxonomy_id, code, sort_order)
SELECT t.id, v.code, v.sort_order
FROM taxonomy t
JOIN (VALUES
('english',10),('scots',20),('welsh',30),('irish',40),
('french',50),('germans',60),('dutch',70),
('danes',80),('swedes',90),('norwegians',100),
('italians',110),('spaniards',120),('portuguese',130),('romanians',140),
('poles',150),('czechs',160),('slovaks',170),
('serbs',180),('croats',190),('slovenes',200),('bulgarians',210),
('greeks',220),('albanians',230),('hungarians',240),
('ukrainians',250),('belarusians',260),('russians',270),
('latvians',280),('lithuanians',290),('estonian',300),
('finns',310),('georgians',320),('armenians',330),('azerbaijanis',340)
) v(code,sort_order)
ON t.code='modern_ethnicity';

-- 语言节点翻译（join 限定 taxonomy，防止跨体系同名 code 串数据）
INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, x.lang, x.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id AND t.code = 'language'
JOIN (VALUES
('indo_european','en','Indo-European'),
('indo_european','zh','印欧语系'),
('uralic','en','Uralic'),
('uralic','zh','乌拉尔语系'),
('kartvelian','en','Kartvelian'),
('kartvelian','zh','卡特维尔语系'),
('turkic','en','Turkic'),
('turkic','zh','突厥语系'),
('germanic','en','Germanic'),
('germanic','zh','日耳曼语族'),
('celtic','en','Celtic'),
('celtic','zh','凯尔特语族'),
('italic','en','Italic'),
('italic','zh','意大利语族'),
('slavic','en','Slavic'),
('slavic','zh','斯拉夫语族'),
('baltic','en','Baltic'),
('baltic','zh','波罗的语族'),
('hellenic','en','Hellenic'),
('hellenic','zh','希腊语族'),
('albanian','en','Albanian'),
('albanian','zh','阿尔巴尼亚语支'),
('germanic_north','en','North Germanic'),
('germanic_north','zh','北日耳曼'),
('germanic_west','en','West Germanic'),
('germanic_west','zh','西日耳曼'),
('germanic_east','en','East Germanic'),
('germanic_east','zh','东日耳曼'),
('gothic','en','Gothic'),
('gothic','zh','哥特语支'),
('romance','en','Romance'),
('romance','zh','罗曼语族'),
('west_slavic','en','West Slavic'),
('west_slavic','zh','西斯拉夫'),
('east_slavic','en','East Slavic'),
('east_slavic','zh','东斯拉夫'),
('south_slavic','en','South Slavic'),
('south_slavic','zh','南斯拉夫'),
('finnic','en','Finnic'),
('finnic','zh','芬兰语支'),
('kartvelian_core','en','Kartvelian core'),
('kartvelian_core','zh','卡特维尔语支核心'),
('oghuz','en','Oghuz'),
('oghuz','zh','乌古斯'),
('kipchak','en','Kipchak'),
('kipchak','zh','钦察')
) x(code,lang,name)
ON n.code=x.code;

-- 历史民族节点翻译
INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, x.lang, x.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id AND t.code = 'historical_people'
JOIN (VALUES
('goths','en','Goths'),('goths','zh','哥特人'),
('franks','en','Franks'),('franks','zh','法兰克人'),
('angles','en','Angles'),('angles','zh','盎格鲁人'),
('saxons','en','Saxons'),('saxons','zh','撒克逊人'),
('jutes','en','Jutes'),('jutes','zh','朱特人'),
('gauls','en','Gauls'),('gauls','zh','高卢人'),
('britons','en','Britons'),('britons','zh','不列颠人'),
('gaels','en','Gaels'),('gaels','zh','盖尔人'),
('vandals','en','Vandals'),('vandals','zh','汪达尔人'),
('burgundians','en','Burgundians'),('burgundians','zh','勃艮第人'),
('lombards','en','Lombards'),('lombards','zh','伦巴第人'),
('suebi','en','Suebi'),('suebi','zh','苏维汇人'),
('visigoths','en','Visigoths'),('visigoths','zh','西哥特人'),
('ostrogoths','en','Ostrogoths'),('ostrogoths','zh','东哥特人'),
('romans','en','Romans'),('romans','zh','罗马人'),
('latins','en','Latins'),('latins','zh','拉丁人'),
('iberians','en','Iberians'),('iberians','zh','伊比利亚人'),
('celtiberians','en','Celtiberians'),('celtiberians','zh','凯尔特伊比利亚人'),
('lusitanians','en','Lusitanians'),('lusitanians','zh','卢西塔尼亚人'),
('dacians','en','Dacians'),('dacians','zh','达契亚人'),
('illyrians','en','Illyrians'),('illyrians','zh','伊利里亚人'),
('thracians','en','Thracians'),('thracians','zh','色雷斯人'),
('slavs','en','Slavs'),('slavs','zh','斯拉夫人'),
('magyars','en','Magyars'),('magyars','zh','马扎尔人')
) x(code,lang,name)
ON n.code=x.code;

-- 现代族群节点翻译
INSERT INTO taxonomy_node_translation (taxonomy_node_id, lang, name)
SELECT n.id, x.lang, x.name
FROM taxonomy_node n
JOIN taxonomy t ON t.id = n.taxonomy_id AND t.code = 'modern_ethnicity'
JOIN (VALUES
('english','en','English'),('english','zh','英格兰人'),
('scots','en','Scots'),('scots','zh','苏格兰人'),
('welsh','en','Welsh'),('welsh','zh','威尔士人'),
('irish','en','Irish'),('irish','zh','爱尔兰人'),
('french','en','French'),('french','zh','法国人'),
('germans','en','Germans'),('germans','zh','德国人'),
('dutch','en','Dutch'),('dutch','zh','荷兰人'),
('danes','en','Danes'),('danes','zh','丹麦人'),
('swedes','en','Swedes'),('swedes','zh','瑞典人'),
('norwegians','en','Norwegians'),('norwegians','zh','挪威人'),
('italians','en','Italians'),('italians','zh','意大利人'),
('spaniards','en','Spaniards'),('spaniards','zh','西班牙人'),
('portuguese','en','Portuguese'),('portuguese','zh','葡萄牙人'),
('romanians','en','Romanians'),('romanians','zh','罗马尼亚人'),
('poles','en','Poles'),('poles','zh','波兰人'),
('czechs','en','Czechs'),('czechs','zh','捷克人'),
('slovaks','en','Slovaks'),('slovaks','zh','斯洛伐克人'),
('serbs','en','Serbs'),('serbs','zh','塞尔维亚人'),
('croats','en','Croats'),('croats','zh','克罗地亚人'),
('slovenes','en','Slovenes'),('slovenes','zh','斯洛文尼亚人'),
('bulgarians','en','Bulgarians'),('bulgarians','zh','保加利亚人'),
('greeks','en','Greeks'),('greeks','zh','希腊人'),
('albanians','en','Albanians'),('albanians','zh','阿尔巴尼亚人'),
('hungarians','en','Hungarians'),('hungarians','zh','匈牙利人'),
('ukrainians','en','Ukrainians'),('ukrainians','zh','乌克兰人'),
('belarusians','en','Belarusians'),('belarusians','zh','白俄罗斯人'),
('russians','en','Russians'),('russians','zh','俄罗斯人'),
('latvians','en','Latvians'),('latvians','zh','拉脱维亚人'),
('lithuanians','en','Lithuanians'),('lithuanians','zh','立陶宛人'),
('estonian','en','Estonians'),('estonian','zh','爱沙尼亚人'),
('finns','en','Finns'),('finns','zh','芬兰人'),
('georgians','en','Georgians'),('georgians','zh','格鲁吉亚人'),
('armenians','en','Armenians'),('armenians','zh','亚美尼亚人'),
('azerbaijanis','en','Azerbaijanis'),('azerbaijanis','zh','阿塞拜疆人')
) x(code,lang,name)
ON n.code=x.code;

-- ============================================================
-- Part VI. Seed data：people
-- ============================================================

INSERT INTO people (code, people_type, start_year, end_year, status_code, notes) VALUES
('goths','historical',100,700,'transformed','古代及晚期罗马时期的哥特人总称；具体分支与名称在不同史料中存在争议。'),
('visigoths','historical',300,700,'transformed','西哥特人，晚期罗马帝国及中世纪早期重要日耳曼人群。'),
('ostrogoths','historical',300,550,'transformed','东哥特人，6世纪在意大利建立东哥特王国。'),
('vandals','historical',200,550,'transformed','汪达尔人，后建立以北非为核心的汪达尔王国。'),
('franks','historical',200,900,'transformed','法兰克人联盟及其后继政治共同体。'),
('angles','historical',300,900,'transformed','盎格鲁人，参与英格兰早期族群形成。'),
('saxons','historical',300,1000,'transformed','撒克逊人，分布于北海沿岸并参与英格兰形成。'),
('jutes','historical',300,800,'transformed','朱特人，传统上与英格兰早期定居相关。'),
('gauls','ancient',-500,500,'transformed','罗马征服前后高卢地区的凯尔特人群统称。'),
('britons','historical',-100,800,'transformed','不列颠岛的布立吞语凯尔特人群。'),
('gaels','historical',-100,1500,'transformed','爱尔兰及苏格兰盖尔语凯尔特人群。'),
('burgundians','historical',200,600,'transformed','勃艮第人。'),
('lombards','historical',200,1000,'transformed','伦巴第人，后在意大利建立伦巴第王国。'),
('suebi','historical',100,600,'transformed','苏维汇人，晚期罗马时期进入伊比利亚半岛。'),
('romans','historical',-500,600,'transformed','罗马人的历史共同体。'),
('latins','ancient',-800,500,'transformed','古代拉丁人群。'),
('iberians','ancient',-1000,100,'transformed','伊比利亚半岛东部和南部的古代伊比利亚人群。'),
('celtiberians','ancient',-500,100,'transformed','伊比利亚半岛中部的凯尔特-伊比利亚人群。'),
('lusitanians','ancient',-500,100,'transformed','卢西塔尼亚人，主要见于伊比利亚西部。'),
('dacians','ancient',-500,300,'transformed','达契亚人。'),
('illyrians','ancient',-1000,100,'transformed','古代巴尔干西部相关人群的统称。'),
('thracians','ancient',-1000,500,'transformed','古代巴尔干东部及周边色雷斯人群。'),
('slavs','historical',400,1000,'transformed','早期斯拉夫人及其扩散形成的多个人群。'),
('magyars','historical',800,1100,'transformed','马扎尔人，匈牙利民族形成的重要历史人群。'),

('english','modern',1000,NULL,'extant','现代英格兰族群；其形成包含多个历史人群的长期融合。'),
('scots','modern',1000,NULL,'extant','现代苏格兰族群。'),
('welsh','modern',700,NULL,'extant','现代威尔士族群，与布立吞语凯尔特传统密切相关。'),
('irish','modern',700,NULL,'extant','现代爱尔兰族群。'),
('french','modern',1000,NULL,'extant','现代法国族群；形成过程涉及高卢、罗马化及法兰克等多重因素。'),
('germans','modern',1000,NULL,'extant','现代德意志族群。'),
('dutch','modern',1000,NULL,'extant','现代荷兰族群。'),
('danes','modern',900,NULL,'extant','现代丹麦族群。'),
('swedes','modern',900,NULL,'extant','现代瑞典族群。'),
('norwegians','modern',900,NULL,'extant','现代挪威族群。'),
('italians','modern',1200,NULL,'extant','现代意大利族群。'),
('spaniards','modern',1200,NULL,'extant','现代西班牙族群的总称；地区内部存在显著语言和族群差异。'),
('portuguese','modern',1200,NULL,'extant','现代葡萄牙族群。'),
('romanians','modern',1000,NULL,'extant','现代罗马尼亚族群。'),
('poles','modern',1000,NULL,'extant','现代波兰族群。'),
('czechs','modern',1000,NULL,'extant','现代捷克族群。'),
('slovaks','modern',1000,NULL,'extant','现代斯洛伐克族群。'),
('serbs','modern',700,NULL,'extant','现代塞尔维亚族群。'),
('croats','modern',700,NULL,'extant','现代克罗地亚族群。'),
('slovenes','modern',700,NULL,'extant','现代斯洛文尼亚族群。'),
('bulgarians','modern',700,NULL,'extant','现代保加利亚族群。'),
('greeks','modern',700,NULL,'extant','现代希腊族群。'),
('albanians','modern',1000,NULL,'extant','现代阿尔巴尼亚族群。'),
('hungarians','modern',1000,NULL,'extant','现代匈牙利族群。'),
('ukrainians','modern',1000,NULL,'extant','现代乌克兰族群。'),
('belarusians','modern',1000,NULL,'extant','现代白俄罗斯族群。'),
('russians','modern',1000,NULL,'extant','现代俄罗斯族群。'),
('latvians','modern',1000,NULL,'extant','现代拉脱维亚族群。'),
('lithuanians','modern',1000,NULL,'extant','现代立陶宛族群。'),
('estonian','modern',1000,NULL,'extant','现代爱沙尼亚族群。'),
('finns','modern',1000,NULL,'extant','现代芬兰族群。'),
('georgians','modern',1000,NULL,'extant','现代格鲁吉亚族群。'),
('armenians','modern',500,NULL,'extant','现代亚美尼亚族群。'),
('azerbaijanis','modern',1000,NULL,'extant','现代阿塞拜疆族群。');

-- v2 修复：原文件列别名 desc 是 SQL 保留字，已改为 brief。
INSERT INTO people_translation (people_id, lang, name, short_description)
SELECT p.id, x.lang, x.name, x.brief
FROM people p
JOIN (VALUES
('goths','en','Goths','A historical Germanic people associated with the Gothic tradition.'),
('goths','zh','哥特人','与哥特传统相关的历史日耳曼人群。'),
('visigoths','en','Visigoths','A branch of the Goths prominent in late Roman Gaul and Iberia.'),
('visigoths','zh','西哥特人','哥特人的一个分支，在晚期罗马高卢和伊比利亚历史中非常重要。'),
('ostrogoths','en','Ostrogoths','A Gothic people that established a kingdom in Italy in the 5th-6th centuries.'),
('ostrogoths','zh','东哥特人','哥特人的一个分支，5-6世纪在意大利建立东哥特王国。'),
('vandals','en','Vandals','A Germanic people that established a kingdom centered in North Africa.'),
('vandals','zh','汪达尔人','建立过以北非为核心王国的日耳曼人群。'),
('franks','en','Franks','A confederation of Germanic peoples that became central to Frankish Gaul.'),
('franks','zh','法兰克人','日耳曼人群联盟，后来成为法兰克高卢的重要政治力量。'),
('angles','en','Angles','A Germanic people associated with the early formation of England.'),
('angles','zh','盎格鲁人','与早期英格兰形成密切相关的日耳曼人群。'),
('saxons','en','Saxons','A Germanic people associated with northern Germany and early England.'),
('saxons','zh','撒克逊人','与北德意志及早期英格兰历史相关的日耳曼人群。'),
('jutes','en','Jutes','A Germanic people traditionally associated with settlement in Kent and Wessex.'),
('jutes','zh','朱特人','传统上与英格兰肯特及威塞克斯早期定居有关的日耳曼人群。'),
('gauls','en','Gauls','Celtic peoples of ancient Gaul.'),
('gauls','zh','高卢人','古代高卢地区的凯尔特人群总称。'),
('britons','en','Britons','Brittonic-speaking peoples of ancient and early medieval Britain.'),
('britons','zh','不列颠人','古代及中世纪早期不列颠岛的布立吞语人群。'),
('gaels','en','Gaels','Celtic peoples associated with Ireland and Gaelic Scotland.'),
('gaels','zh','盖尔人','与爱尔兰和盖尔语苏格兰相关的凯尔特人群。'),
('burgundians','en','Burgundians','A historical Germanic people associated with Burgundy.'),
('burgundians','zh','勃艮第人','与勃艮第地区历史相关的日耳曼人群。'),
('lombards','en','Lombards','A Germanic people that established a kingdom in Italy.'),
('lombards','zh','伦巴第人','在意大利建立伦巴第王国的日耳曼人群。'),
('suebi','en','Suebi','A Germanic people that established a kingdom in northwestern Iberia.'),
('suebi','zh','苏维汇人','在伊比利亚西北部建立王国的日耳曼人群。'),
('romans','en','Romans','The historical people associated with Rome and the Roman state.'),
('romans','zh','罗马人','与罗马及罗马国家相关的历史人群。'),
('latins','en','Latins','An ancient Italic people of Latium.'),
('latins','zh','拉丁人','古代意大利拉丁姆地区的人群。'),
('iberians','en','Iberians','Ancient peoples of parts of the Iberian Peninsula.'),
('iberians','zh','伊比利亚人','伊比利亚半岛部分地区的古代人群。'),
('celtiberians','en','Celtiberians','Celtic-influenced peoples of central Iberia.'),
('celtiberians','zh','凯尔特伊比利亚人','伊比利亚中部受凯尔特文化影响的古代人群。'),
('lusitanians','en','Lusitanians','An ancient people of western Iberia.'),
('lusitanians','zh','卢西塔尼亚人','伊比利亚西部的古代人群。'),
('dacians','en','Dacians','Ancient peoples of the lower Danube and Carpathian region.'),
('dacians','zh','达契亚人','多瑙河下游及喀尔巴阡地区的古代人群。'),
('illyrians','en','Illyrians','A broad ancient designation for peoples of the western Balkans.'),
('illyrians','zh','伊利里亚人','古代巴尔干西部若干人群的宽泛称呼。'),
('thracians','en','Thracians','Ancient peoples of Thrace and adjacent regions.'),
('thracians','zh','色雷斯人','古代色雷斯及周边地区的人群。'),
('slavs','en','Slavs','Early Slavic peoples whose expansion shaped much of eastern and southeastern Europe.'),
('slavs','zh','斯拉夫人','早期斯拉夫人群，其扩散深刻影响东欧和东南欧。'),
('magyars','en','Magyars','The historical Hungarian-speaking people associated with the Hungarian conquest of the Carpathian Basin.'),
('magyars','zh','马扎尔人','与征服喀尔巴阡盆地及匈牙利民族形成相关的历史匈牙利语人群。'),
('english','en','English','The modern ethnic and cultural population of England.'),
('english','zh','英格兰人','现代英格兰的族群与文化共同体。'),
('scots','en','Scots','The modern people of Scotland.'),
('scots','zh','苏格兰人','现代苏格兰族群。'),
('welsh','en','Welsh','The modern people of Wales.'),
('welsh','zh','威尔士人','现代威尔士族群。'),
('irish','en','Irish','The modern people of Ireland.'),
('irish','zh','爱尔兰人','现代爱尔兰族群。'),
('french','en','French','The modern population associated with France.'),
('french','zh','法国人','现代法国相关的族群与国民共同体。'),
('germans','en','Germans','The modern German people.'),
('germans','zh','德国人','现代德国族群。'),
('dutch','en','Dutch','The modern Dutch people.'),
('dutch','zh','荷兰人','现代荷兰族群。'),
('danes','en','Danes','The modern Danish people.'),
('danes','zh','丹麦人','现代丹麦族群。'),
('swedes','en','Swedes','The modern Swedish people.'),
('swedes','zh','瑞典人','现代瑞典族群。'),
('norwegians','en','Norwegians','The modern Norwegian people.'),
('norwegians','zh','挪威人','现代挪威族群。'),
('italians','en','Italians','The modern Italian people.'),
('italians','zh','意大利人','现代意大利族群。'),
('spaniards','en','Spaniards','A broad modern designation for the people of Spain.'),
('spaniards','zh','西班牙人','现代西班牙人的广义称呼；内部具有多样的区域身份。'),
('portuguese','en','Portuguese','The modern Portuguese people.'),
('portuguese','zh','葡萄牙人','现代葡萄牙族群。'),
('romanians','en','Romanians','The modern Romanian people.'),
('romanians','zh','罗马尼亚人','现代罗马尼亚族群。'),
('poles','en','Poles','The modern Polish people.'),
('poles','zh','波兰人','现代波兰族群。'),
('czechs','en','Czechs','The modern Czech people.'),
('czechs','zh','捷克人','现代捷克族群。'),
('slovaks','en','Slovaks','The modern Slovak people.'),
('slovaks','zh','斯洛伐克人','现代斯洛伐克族群。'),
('serbs','en','Serbs','The modern Serbian people.'),
('serbs','zh','塞尔维亚人','现代塞尔维亚族群。'),
('croats','en','Croats','The modern Croatian people.'),
('croats','zh','克罗地亚人','现代克罗地亚族群。'),
('slovenes','en','Slovenes','The modern Slovenian people.'),
('slovenes','zh','斯洛文尼亚人','现代斯洛文尼亚族群。'),
('bulgarians','en','Bulgarians','The modern Bulgarian people.'),
('bulgarians','zh','保加利亚人','现代保加利亚族群。'),
('greeks','en','Greeks','The modern Greek people.'),
('greeks','zh','希腊人','现代希腊族群。'),
('albanians','en','Albanians','The modern Albanian people.'),
('albanians','zh','阿尔巴尼亚人','现代阿尔巴尼亚族群。'),
('hungarians','en','Hungarians','The modern Hungarian people.'),
('hungarians','zh','匈牙利人','现代匈牙利族群。'),
('ukrainians','en','Ukrainians','The modern Ukrainian people.'),
('ukrainians','zh','乌克兰人','现代乌克兰族群。'),
('belarusians','en','Belarusians','The modern Belarusian people.'),
('belarusians','zh','白俄罗斯人','现代白俄罗斯族群。'),
('russians','en','Russians','The modern Russian people.'),
('russians','zh','俄罗斯人','现代俄罗斯族群。'),
('latvians','en','Latvians','The modern Latvian people.'),
('latvians','zh','拉脱维亚人','现代拉脱维亚族群。'),
('lithuanians','en','Lithuanians','The modern Lithuanian people.'),
('lithuanians','zh','立陶宛人','现代立陶宛族群。'),
('estonian','en','Estonians','The modern Estonian people.'),
('estonian','zh','爱沙尼亚人','现代爱沙尼亚族群。'),
('finns','en','Finns','The modern Finnish people.'),
('finns','zh','芬兰人','现代芬兰族群。'),
('georgians','en','Georgians','The modern Georgian people.'),
('georgians','zh','格鲁吉亚人','现代格鲁吉亚族群。'),
('armenians','en','Armenians','The modern Armenian people.'),
('armenians','zh','亚美尼亚人','现代亚美尼亚族群。'),
('azerbaijanis','en','Azerbaijanis','The modern Azerbaijani people.'),
('azerbaijanis','zh','阿塞拜疆人','现代阿塞拜疆族群。')
) x(code,lang,name,brief)
ON p.code=x.code;

-- ============================================================
-- Part VII. Seed data：people_classification
-- （v2：所有 join 均限定 taxonomy，原文件因分支节点插入失败
--   而静默丢失的行现在都能真正写入。）
-- ============================================================

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id
WHERE p.code IN ('goths','visigoths','ostrogoths')
  AND n.code IN ('germanic','germanic_east','gothic');

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', CASE WHEN p.code='vandals' THEN 'medium' ELSE 'high' END
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code IN ('germanic','germanic_east')
WHERE p.code='vandals';

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code='germanic'
WHERE p.code IN ('franks','angles','saxons','jutes','burgundians','lombards','suebi');

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code='celtic'
WHERE p.code IN ('gauls','britons','gaels','celtiberians');

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code='italic'
WHERE p.code IN ('latins','romans');

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code='romance'
WHERE p.code IN ('romans');

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code='slavic'
WHERE p.code='slavs';

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code='albanian'
WHERE p.code='albanians';

INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'language'
JOIN taxonomy_node n ON n.taxonomy_id = t.id AND n.code='hellenic'
WHERE p.code='greeks';

-- 现代族群的分类
INSERT INTO people_classification (people_id, taxonomy_node_id, relation_code, confidence_code)
SELECT p.id, n.id, 'member_of', 'high'
FROM people p
JOIN taxonomy t ON t.code = 'modern_ethnicity'
JOIN taxonomy_node n ON n.taxonomy_id = t.id
WHERE p.code = n.code;

-- ============================================================
-- Part VIII. Seed data：语言
-- ============================================================

INSERT INTO language (code, language_type, start_year, end_year, status_code, notes) VALUES
('gothic','ancient',300,800,'extinct','哥特语，东日耳曼语支的重要历史语言。'),
('latin','ancient',-700,1000,'transformed','拉丁语；后续发展出罗曼语族诸语言。'),
('old_english','medieval',450,1150,'transformed','古英语。'),
('old_norse','medieval',800,1400,'transformed','古诺斯语。'),
('french','modern',800,NULL,'extant','法语。'),
('german','modern',800,NULL,'extant','德语。'),
('dutch','modern',1000,NULL,'extant','荷兰语。'),
('spanish','modern',900,NULL,'extant','西班牙语。'),
('portuguese','modern',900,NULL,'extant','葡萄牙语。'),
('italian','modern',1000,NULL,'extant','意大利语。'),
('romanian','modern',1000,NULL,'extant','罗马尼亚语。'),
('polish','modern',1000,NULL,'extant','波兰语。'),
('czech','modern',1000,NULL,'extant','捷克语。'),
('russian','modern',1000,NULL,'extant','俄语。'),
('ukrainian','modern',1000,NULL,'extant','乌克兰语。'),
('greek','modern',-1400,NULL,'extant','希腊语及其历史阶段。'),
('albanian','modern',1000,NULL,'extant','阿尔巴尼亚语。'),
('irish','modern',700,NULL,'extant','爱尔兰语。'),
('welsh','modern',700,NULL,'extant','威尔士语。'),
('swedish','modern',1000,NULL,'extant','瑞典语。'),
('danish','modern',1000,NULL,'extant','丹麦语。'),
('norwegian','modern',1000,NULL,'extant','挪威语。'),
('finnish','modern',1000,NULL,'extant','芬兰语。'),
('estonian','modern',1000,NULL,'extant','爱沙尼亚语。'),
('latvian','modern',1000,NULL,'extant','拉脱维亚语。'),
('lithuanian','modern',1000,NULL,'extant','立陶宛语。'),
('georgian','modern',1000,NULL,'extant','格鲁吉亚语。'),
('armenian','modern',500,NULL,'extant','亚美尼亚语。'),
('azerbaijani','modern',1000,NULL,'extant','阿塞拜疆语。'),
('hungarian','modern',1000,NULL,'extant','匈牙利语。');

INSERT INTO language_translation (language_id, lang, name)
SELECT l.id, x.lang, x.name
FROM language l
JOIN (VALUES
('gothic','en','Gothic'),('gothic','zh','哥特语'),
('latin','en','Latin'),('latin','zh','拉丁语'),
('old_english','en','Old English'),('old_english','zh','古英语'),
('old_norse','en','Old Norse'),('old_norse','zh','古诺斯语'),
('french','en','French'),('french','zh','法语'),
('german','en','German'),('german','zh','德语'),
('dutch','en','Dutch'),('dutch','zh','荷兰语'),
('spanish','en','Spanish'),('spanish','zh','西班牙语'),
('portuguese','en','Portuguese'),('portuguese','zh','葡萄牙语'),
('italian','en','Italian'),('italian','zh','意大利语'),
('romanian','en','Romanian'),('romanian','zh','罗马尼亚语'),
('polish','en','Polish'),('polish','zh','波兰语'),
('czech','en','Czech'),('czech','zh','捷克语'),
('russian','en','Russian'),('russian','zh','俄语'),
('ukrainian','en','Ukrainian'),('ukrainian','zh','乌克兰语'),
('greek','en','Greek'),('greek','zh','希腊语'),
('albanian','en','Albanian'),('albanian','zh','阿尔巴尼亚语'),
('irish','en','Irish'),('irish','zh','爱尔兰语'),
('welsh','en','Welsh'),('welsh','zh','威尔士语'),
('swedish','en','Swedish'),('swedish','zh','瑞典语'),
('danish','en','Danish'),('danish','zh','丹麦语'),
('norwegian','en','Norwegian'),('norwegian','zh','挪威语'),
('finnish','en','Finnish'),('finnish','zh','芬兰语'),
('estonian','en','Estonian'),('estonian','zh','爱沙尼亚语'),
('latvian','en','Latvian'),('latvian','zh','拉脱维亚语'),
('lithuanian','en','Lithuanian'),('lithuanian','zh','立陶宛语'),
('georgian','en','Georgian'),('georgian','zh','格鲁吉亚语'),
('armenian','en','Armenian'),('armenian','zh','亚美尼亚语'),
('azerbaijani','en','Azerbaijani'),('azerbaijani','zh','阿塞拜疆语'),
('hungarian','en','Hungarian'),('hungarian','zh','匈牙利语')
) x(code,lang,name)
ON l.code=x.code;

-- 人群-语言关系
INSERT INTO people_language (people_id, language_id, role_code, confidence_code)
SELECT p.id, l.id, v.role, v.conf
FROM (VALUES
('goths','gothic','historical','high'),
('visigoths','gothic','historical','high'),
('ostrogoths','gothic','historical','high'),
('romans','latin','historical','high'),
('latins','latin','historical','high'),
('angles','old_english','historical','high'),
('saxons','old_english','historical','high'),
('jutes','old_english','historical','high'),
('english','old_english','ancestral','medium'),
('english','french','native','high'),
('french','french','native','high'),
('germans','german','native','high'),
('dutch','dutch','native','high'),
('danes','danish','native','high'),
('swedes','swedish','native','high'),
('norwegians','norwegian','native','high'),
('italians','italian','native','high'),
('spaniards','spanish','native','high'),
('portuguese','portuguese','native','high'),
('romanians','romanian','native','high'),
('poles','polish','native','high'),
('czechs','czech','native','high'),
('russians','russian','native','high'),
('ukrainians','ukrainian','native','high'),
('greeks','greek','native','high'),
('albanians','albanian','native','high'),
('irish','irish','native','high'),
('welsh','welsh','native','high'),
('finns','finnish','native','high'),
('estonian','estonian','native','high'),
('latvians','latvian','native','high'),
('lithuanians','lithuanian','native','high'),
('georgians','georgian','native','high'),
('armenians','armenian','native','high'),
('azerbaijanis','azerbaijani','native','high'),
('hungarians','hungarian','native','high')
) v(people_code, language_code, role, conf)
JOIN people p ON p.code = v.people_code
JOIN language l ON l.code = v.language_code;

-- ============================================================
-- Part IX. Seed data：宗教
-- v2 修复：子节点挂父节点拆为第二条语句（同语句子查询
-- 受语句级快照隔离，取不到本语句刚插入的行）。
-- ============================================================

INSERT INTO religion (code, parent_id, notes) VALUES
('paganism',NULL,'泛称；具体传统需要继续细分。'),
('christianity',NULL,'基督教'),
('islam',NULL,'伊斯兰教'),
('judaism',NULL,'犹太教');

INSERT INTO religion (code, parent_id, notes)
SELECT v.code, c.id, v.notes
FROM (VALUES
('catholicism','天主教传统'),
('eastern_orthodoxy','东正教传统'),
('protestantism','新教传统')
) v(code,notes)
JOIN religion c ON c.code='christianity';

INSERT INTO religion_translation (religion_id, lang, name)
SELECT r.id, x.lang, x.name
FROM religion r
JOIN (VALUES
('paganism','en','Paganism'),('paganism','zh','多神教 / 异教传统'),
('christianity','en','Christianity'),('christianity','zh','基督教'),
('catholicism','en','Catholicism'),('catholicism','zh','天主教'),
('eastern_orthodoxy','en','Eastern Orthodoxy'),('eastern_orthodoxy','zh','东正教'),
('protestantism','en','Protestantism'),('protestantism','zh','新教'),
('islam','en','Islam'),('islam','zh','伊斯兰教'),
('judaism','en','Judaism'),('judaism','zh','犹太教')
) x(code,lang,name)
ON r.code=x.code;

-- 仅放少量代表性关系，避免把复杂宗教史简化成绝对判断。
INSERT INTO people_religion (people_id, religion_id, role_code, start_year, end_year, confidence_code)
SELECT p.id, r.id, 'traditional', 0, 900, 'medium'
FROM people p, religion r
WHERE p.code IN ('goths','visigoths','ostrogoths','vandals') AND r.code='paganism';

INSERT INTO people_religion (people_id, religion_id, role_code, start_year, end_year, confidence_code)
SELECT p.id, r.id, 'historical', 300, 600, 'high'
FROM people p, religion r
WHERE p.code IN ('visigoths','ostrogoths','vandals') AND r.code='christianity';

INSERT INTO people_religion (people_id, religion_id, role_code, start_year, end_year, confidence_code)
SELECT p.id, r.id, 'historical', 300, 600, 'high'
FROM people p, religion r
WHERE p.code IN ('franks') AND r.code='christianity';

-- ============================================================
-- Part X. Seed data：region 与人群分布
-- ============================================================

INSERT INTO region (code, region_type, start_year, end_year, notes) VALUES
('europe','continent',NULL,NULL,'欧洲'),
('gaul','historical_region',-500,500,'古代高卢地区'),
('britannia','historical_region',-100,800,'古代及早期中世纪不列颠'),
('iberian_peninsula','historical_region',-1000,NULL,'伊比利亚半岛'),
('italy','historical_region',-500,NULL,'意大利半岛及相关历史地区'),
('balkans','historical_region',-1000,NULL,'巴尔干半岛'),
('north_africa','historical_region',-1000,NULL,'北非'),
('carpathian_basin','historical_region',NULL,NULL,'喀尔巴阡盆地'),
('frankish_gaul','political_entity',400,900,'法兰克时期高卢及其相关政治实体'),
('visigothic_kingdom','political_entity',418,721,'西哥特王国'),
('ostrogothic_kingdom','political_entity',493,553,'东哥特王国'),
('vandal_kingdom','political_entity',435,534,'汪达尔王国'),
('roman_empire','political_entity',-27,476,'西部帝国灭亡前的罗马帝国框架；此处用于示例。');

INSERT INTO region_translation (region_id, lang, name)
SELECT r.id, x.lang, x.name
FROM region r
JOIN (VALUES
('europe','en','Europe'),('europe','zh','欧洲'),
('gaul','en','Gaul'),('gaul','zh','高卢'),
('britannia','en','Britannia'),('britannia','zh','不列颠'),
('iberian_peninsula','en','Iberian Peninsula'),('iberian_peninsula','zh','伊比利亚半岛'),
('italy','en','Italy'),('italy','zh','意大利'),
('balkans','en','Balkans'),('balkans','zh','巴尔干半岛'),
('north_africa','en','North Africa'),('north_africa','zh','北非'),
('carpathian_basin','en','Carpathian Basin'),('carpathian_basin','zh','喀尔巴阡盆地'),
('frankish_gaul','en','Frankish Gaul'),('frankish_gaul','zh','法兰克高卢'),
('visigothic_kingdom','en','Visigothic Kingdom'),('visigothic_kingdom','zh','西哥特王国'),
('ostrogothic_kingdom','en','Ostrogothic Kingdom'),('ostrogothic_kingdom','zh','东哥特王国'),
('vandal_kingdom','en','Vandal Kingdom'),('vandal_kingdom','zh','汪达尔王国'),
('roman_empire','en','Roman Empire'),('roman_empire','zh','罗马帝国')
) x(code,lang,name)
ON r.code=x.code;

-- 人群分布（v2：新增 render_priority，默认按 presence 语义取值：
--   political_control=90, homeland=60, settlement=50, migration=40,
--   minority=20, temporary_presence=10；可按行覆盖）
INSERT INTO people_region
(people_id, region_id, presence_code, start_year, end_year, confidence_code, render_priority)
SELECT p.id, r.id, v.presence, v.sy, v.ey, v.conf, v.rp
FROM (VALUES
('visigoths','balkans','homeland',200,400,'medium',60),
('visigoths','iberian_peninsula','settlement',400,700,'high',50),
('visigoths','gaul','settlement',400,500,'high',50),
('ostrogoths','italy','political_control',493,553,'high',90),
('vandals','north_africa','political_control',435,534,'high',90),
('franks','gaul','settlement',400,900,'medium',50),
('angles','britannia','settlement',450,900,'high',50),
('saxons','britannia','settlement',450,900,'high',50),
('jutes','britannia','settlement',450,900,'high',50)
) v(people_code, region_code, presence, sy, ey, conf, rp)
JOIN people p ON p.code = v.people_code
JOIN region r ON r.code = v.region_code;

-- ============================================================
-- Part XI. Seed data：people_relation
-- ============================================================

INSERT INTO people_relation
(people_a_id, relation_code, people_b_id, confidence_code, start_year, end_year, notes)
SELECT a.id,'subgroup_of',b.id,'high',NULL,NULL,'Visigoths are conventionally treated as a branch/group of the Goths.'
FROM people a, people b
WHERE a.code='visigoths' AND b.code='goths';

INSERT INTO people_relation
(people_a_id, relation_code, people_b_id, confidence_code, notes)
SELECT a.id,'subgroup_of',b.id,'high','Ostrogoths are conventionally treated as a Gothic group.'
FROM people a, people b
WHERE a.code='ostrogoths' AND b.code='goths';

INSERT INTO people_relation
(people_a_id, relation_code, people_b_id, confidence_code, notes)
SELECT a.id,'related_to',b.id,'medium','Vandals are conventionally classified within East Germanic in many modern reference works, but details of their linguistic/historical classification are debated.'
FROM people a, people b
WHERE a.code='vandals' AND b.code='goths';

INSERT INTO people_relation
(people_a_id, relation_code, people_b_id, confidence_code, notes)
SELECT a.id,'related_to',b.id,'high','Angles, Saxons and Jutes are among the principal Germanic groups traditionally associated with early Anglo-Saxon England.'
FROM people a, people b
WHERE a.code='angles' AND b.code='saxons';

INSERT INTO people_relation
(people_a_id, relation_code, people_b_id, confidence_code, notes)
SELECT a.id,'related_to',b.id,'high','Gauls were predominantly Celtic-speaking peoples of ancient Gaul; later populations were heavily Romanized.'
FROM people a, people b
WHERE a.code='gauls' AND b.code='romans';

INSERT INTO people_relation
(people_a_id, relation_code, people_b_id, confidence_code, notes)
SELECT a.id,'related_to',b.id,'medium','Modern French ethnogenesis involved Gallo-Roman populations, Frankish elites and later regional populations; it should not be modeled as a simple one-to-one descent.'
FROM people a, people b
WHERE a.code='french' AND b.code='franks';

INSERT INTO people_relation
(people_a_id, relation_code, people_b_id, confidence_code, notes)
SELECT a.id,'related_to',b.id,'medium','Modern English ethnogenesis involved Brittonic populations, Anglo-Saxon groups, Norse settlement and Norman influence.'
FROM people a, people b
WHERE a.code='english' AND b.code='angles';

-- ============================================================
-- Part XII. Seed data：events（v2：补充 region_id 发生地，
-- 年份统一为整数，不再用字符串字面量）
-- ============================================================

INSERT INTO event (code, start_year, end_year, event_type_code, region_id, notes)
SELECT v.code, v.sy, v.ey, v.event_type, r.id, v.notes
FROM (VALUES
('gothic_migrations',250,400,'migration','balkans','哥特人迁徙/扩散的宽泛时期。'),
('visigothic_sack_of_rome',410,410,'battle','italy','410年西哥特人攻陷罗马。'),
('visigothic_settlement_in_gaul',418,418,'settlement','gaul','西哥特人在高卢获得定居安排。'),
('vandal_crossing_to_north_africa',429,429,'migration','north_africa','汪达尔人进入北非并最终建立王国。'),
('ostrogothic_conquest_of_italy',489,493,'conquest','italy','东哥特人进入并征服意大利。'),
('anglo_saxon_settlement',450,600,'settlement','britannia','盎格鲁-撒克逊等日耳曼人群在不列颠的长期定居过程。'),
('frankish_expansion_in_gaul',400,600,'conquest','gaul','法兰克人在高卢扩张的长期过程。')
) v(code,sy,ey,event_type,region_code,notes)
JOIN region r ON r.code = v.region_code;

-- v2 修复：原文件列别名 desc 是 SQL 保留字，已改为 brief。
INSERT INTO event_translation (event_id, lang, name, short_description)
SELECT e.id, x.lang, x.name, x.brief
FROM event e
JOIN (VALUES
('gothic_migrations','en','Gothic migrations','The broad period of Gothic movements and settlement in Europe.'),
('gothic_migrations','zh','哥特人迁徙','哥特人在欧洲迁徙、扩散与定居的宽泛时期。'),
('visigothic_sack_of_rome','en','Visigothic Sack of Rome','The sack of Rome by the Visigoths in 410.'),
('visigothic_sack_of_rome','zh','西哥特人攻陷罗马','410年西哥特人攻陷罗马。'),
('visigothic_settlement_in_gaul','en','Visigothic Settlement in Gaul','The settlement arrangement of the Visigoths in Gaul in 418.'),
('visigothic_settlement_in_gaul','zh','西哥特人在高卢定居','418年西哥特人在高卢获得定居安排。'),
('vandal_crossing_to_north_africa','en','Vandal Migration to North Africa','The Vandal movement into North Africa beginning in 429.'),
('vandal_crossing_to_north_africa','zh','汪达尔人迁入北非','429年开始的汪达尔人进入北非的迁徙。'),
('ostrogothic_conquest_of_italy','en','Ostrogothic Conquest of Italy','The Ostrogothic conquest and establishment of a kingdom in Italy.'),
('ostrogothic_conquest_of_italy','zh','东哥特征服意大利','东哥特人征服意大利并建立王国。'),
('anglo_saxon_settlement','en','Anglo-Saxon Settlement of Britain','The long process of settlement associated with Angles, Saxons and Jutes in Britain.'),
('anglo_saxon_settlement','zh','盎格鲁-撒克逊人在不列颠的定居','盎格鲁人、撒克逊人和朱特人等在不列颠长期定居的过程。'),
('frankish_expansion_in_gaul','en','Frankish Expansion in Gaul','The long-term expansion of Frankish power in Gaul.'),
('frankish_expansion_in_gaul','zh','法兰克人在高卢的扩张','法兰克势力在高卢长期扩张的过程。')
) x(code,lang,name,brief)
ON e.code=x.code;

INSERT INTO event_people (event_id, people_id, role_code)
SELECT e.id, p.id, v.role
FROM (VALUES
('gothic_migrations','goths','migrating_group'),
('visigothic_sack_of_rome','visigoths','attacker'),
('visigothic_settlement_in_gaul','visigoths','participant'),
('vandal_crossing_to_north_africa','vandals','migrating_group'),
('ostrogothic_conquest_of_italy','ostrogoths','attacker'),
('anglo_saxon_settlement','angles','migrating_group'),
('anglo_saxon_settlement','saxons','migrating_group'),
('anglo_saxon_settlement','jutes','migrating_group'),
('frankish_expansion_in_gaul','franks','participant')
) v(event_code, people_code, role)
JOIN event e ON e.code = v.event_code
JOIN people p ON p.code = v.people_code;

-- ============================================================
-- Part XIIb. Seed data：period（时间轴时代标签，v2 新增）
-- 时期允许与其他时期重叠；年份为惯用近似值。
-- ============================================================

INSERT INTO period (code, start_year, end_year, notes) VALUES
('roman_republic',-509,-27,'罗马共和国；年份为惯用近似。'),
('roman_empire_period',-27,476,'以西部帝国灭亡为断代的罗马帝国时期（东部延续至1453年）。'),
('late_antiquity',284,700,'晚期古代；学界界定不一，与其他时期有意重叠。'),
('migration_period',375,568,'民族大迁徙时期；起讫年份为惯用近似。'),
('early_middle_ages',476,1000,'中世纪早期。'),
('high_middle_ages',1000,1300,'中世纪盛期。'),
('late_middle_ages',1300,1500,'中世纪晚期。'),
('early_modern_period',1500,1800,'近代早期。'),
('modern_period',1800,NULL,'现代。');

INSERT INTO period_translation (period_id, lang, name, short_description)
SELECT p.id, x.lang, x.name, x.brief
FROM period p
JOIN (VALUES
('roman_republic','en','Roman Republic','The Roman state from the overthrow of the monarchy to the accession of Augustus.'),
('roman_republic','zh','罗马共和国','从王政被推翻到奥古斯都掌权之间的罗马国家。'),
('roman_empire_period','en','Roman Empire','The imperial Roman state; the conventional end date marks the fall of the western empire.'),
('roman_empire_period','zh','罗马帝国','罗马帝国时期；惯用断代终点为西罗马帝国灭亡。'),
('late_antiquity','en','Late Antiquity','The transitional era between classical antiquity and the Middle Ages.'),
('late_antiquity','zh','晚期古代','古典古代与中世纪之间的过渡时代。'),
('migration_period','en','Migration Period','The period of large-scale movements of peoples into the Roman world.'),
('migration_period','zh','民族大迁徙时期','各人群大规模迁入罗马世界及其周边的时期。'),
('early_middle_ages','en','Early Middle Ages','Roughly the 5th to 10th centuries.'),
('early_middle_ages','zh','中世纪早期','约5至10世纪。'),
('high_middle_ages','en','High Middle Ages','Roughly the 11th to 13th centuries.'),
('high_middle_ages','zh','中世纪盛期','约11至13世纪。'),
('late_middle_ages','en','Late Middle Ages','Roughly the 14th and 15th centuries.'),
('late_middle_ages','zh','中世纪晚期','约14至15世纪。'),
('early_modern_period','en','Early Modern Period','Roughly 1500 to 1800.'),
('early_modern_period','zh','近代早期','约1500至1800年。'),
('modern_period','en','Modern Period','From around 1800 to the present.'),
('modern_period','zh','现代','约1800年至今。')
) x(code,lang,name,brief)
ON p.code=x.code;

-- ============================================================
-- Part XIII. Seed data：source 与 relation_source
-- v2 修复：原文件两处逗号连接与 JOIN 混用导致
-- invalid reference，已改为标准 JOIN 链。
-- ============================================================

INSERT INTO source (source_type, title, author, publisher, publication_year, url, notes) VALUES
('reference','The Oxford Dictionary of Late Antiquity','Oliver Nicholson (ed.)','Oxford University Press',2018,NULL,'晚期古代欧洲的重要综合参考工具书。'),
('reference','The New Cambridge Medieval History','Various editors','Cambridge University Press',1995,NULL,'中世纪史综合参考。'),
('reference','The Oxford Handbook of the Archaeology of the Barbarian Worlds','Various editors','Oxford University Press',2019,NULL,'迁徙时代与“蛮族世界”考古研究参考。'),
('reference','The Cambridge Ancient History','Various editors','Cambridge University Press',2005,NULL,'古代地中海世界综合参考。');

INSERT INTO relation_source (relation_id, source_id, evidence_type, notes)
SELECT pr.id, s.id, 'general_reference', '示例来源；后续应进一步绑定到具体章节/页码。'
FROM people_relation pr
JOIN people a ON a.id = pr.people_a_id
JOIN people b ON b.id = pr.people_b_id
JOIN source s ON s.title = 'The Oxford Dictionary of Late Antiquity'
WHERE a.code = 'visigoths' AND b.code = 'goths';

INSERT INTO relation_source (relation_id, source_id, evidence_type, notes)
SELECT pr.id, s.id, 'general_reference', '示例来源；Vandals 的语言分类应保留一定不确定性。'
FROM people_relation pr
JOIN people a ON a.id = pr.people_a_id
JOIN people b ON b.id = pr.people_b_id
JOIN source s ON s.title = 'The Oxford Handbook of the Archaeology of the Barbarian Worlds'
WHERE a.code = 'vandals' AND b.code = 'goths';

-- ============================================================
-- Part XIV. 示例 claim（预留层，MVP 不要求填充）
-- ============================================================

INSERT INTO claim
(subject_type, subject_id, predicate_code, object_type, object_id, confidence_code, notes)
SELECT 'people', a.id, 'descended_from', 'people', b.id, 'medium',
       '这里表达的是现代法国族群形成中的历史来源之一，而不是单线血缘继承。'
FROM people a, people b
WHERE a.code='french' AND b.code='franks';

INSERT INTO claim
(subject_type, subject_id, predicate_code, object_type, object_id, confidence_code, notes)
SELECT 'people', a.id, 'historical_ancestor_component', 'people', b.id, 'medium',
       '现代英格兰族群形成包含多个历史成分，此关系不应解释为简单的单一民族血缘。'
FROM people a, people b
WHERE a.code='english' AND b.code='angles';

-- ============================================================
-- Part XV. 使用约定与数据完整性说明
-- ============================================================
-- 1. 主表中的 *_code（relation_code / presence_code / role_code /
--    confidence_code / people_type / region_type / event_type_code /
--    language_type / status_code 等）均为 VARCHAR，不加外键；
--    其合法值与中英文标签通过 enum_label 视图查询：
--      SELECT label FROM enum_label
--      WHERE definition_code = '<字典名>'
--        AND value_code = '<code>' AND lang = 'zh';
--    拼写错误无法被数据库拦截，导入/录入工具应做应用层校验。
-- 2. end_year 为 NULL 表示“延续至今/该关系仍然有效”。
--    时间切片查询模板（T 年时人群 R 在地区 D）：
--      WHERE start_year <= :t AND (end_year IS NULL OR end_year >= :t)
-- 3. 色块渲染规则：同一地区同一时刻取 render_priority 最大的
--    people_region 行作为该地区主色；并列时前端用稳定规则
--    （如 people_id 升序取第一行）打破平局。悬浮提示仍应列出
--    该地区当前所有族群（含低优先级）。
-- 4. bilingual 不是数据库中的 lang：
--      display_mode = 'en'        -> 只取 en
--      display_mode = 'zh'        -> 只取 zh，缺失时回退 en
--      display_mode = 'bilingual' -> 同时取 en + zh
-- 5. claim / claim_source 为史学证据层预留，MVP 阶段不要求填充。
-- 6. 地理几何（region_shape）按当前决定暂缓；
--    前端渲染所需形状数据按 region.code 与外部数据关联。
--
-- ============================================================

COMMIT;
