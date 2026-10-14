// 左侧族群谱系树（族群分布模式的图例）：
// 按 SQL taxonomy 层级组织全部族群（印欧语系 → 日耳曼 → 东日耳曼 → 哥特 → 东西哥特人…），
// 当年活动者正常亮度并注记活动区域，未活动者压暗；悬停树叶 → 地图高亮该族群、其余压暗。
// 过滤筛选：输入汉字 / 拼音（全拼或首字母）/ 英文匹配族群名与分支名；点击叶行单选该族群
// （仅叶子可选，再点同一叶取消），选中经 store 回流（main.ts 把该族群当年活动区域改涂其族群色）。
// 窄屏（≤900px）整树改为左侧抽屉（CSS 控制）：头部行带关闭钮（onClose），触碰不弹行内 tooltip。
// 文本用 ink 色，色点只做身份标识（dataviz 规范）。

import type { AtlasModel, AtlasTaxonomyNode, TreeBranch, TreeLeaf } from './atlas';
import { t, type Lang, type StringKey } from './i18n';

const GROUP_KEYS: Record<string, StringKey> = {
  language: 'taxLanguage',
  historical_people: 'taxHistorical',
  modern_ethnicity: 'taxModern',
  unclassified: 'taxUnclassified',
};

export interface PeopleTreeApi {
  /** showInactive=false 时仅渲染当年点亮（活动）的族群，空分支与空分组整体剪枝 */
  render(model: AtlasModel, year: number, lang: Lang, showInactive: boolean, selected: ReadonlySet<string>): void;
  /** store 选中回填：就地刷新叶标记与选中条（不重建 DOM，不打断悬停与展开态） */
  setSelected(selected: ReadonlySet<string>): void;
  onHighlight(cb: (peopleCode: string | null) => void): void;
  onToggle(cb: (showInactive: boolean) => void): void;
  onSelect(cb: (codes: string[]) => void): void;
  /** 移动端抽屉关闭钮（桌面端 CSS 隐藏） */
  onClose(cb: () => void): void;
}

/** 仅保留当年活动的叶子；无活动内容的分支返回 null（连同空分组一起剪掉） */
function activeOnly(b: TreeBranch): TreeBranch | null {
  const leaves = b.leaves.filter((l) => l.active);
  const children: TreeBranch[] = [];
  for (const c of b.children) {
    const fc = activeOnly(c);
    if (fc) children.push(fc);
  }
  const totalCount = leaves.length + children.reduce((s, c) => s + c.totalCount, 0);
  if (totalCount === 0) return null;
  return { node: b.node, leaves, children, activeCount: totalCount, totalCount };
}

function groupLabel(key: string, lang: Lang): string {
  const k = GROUP_KEYS[key];
  return k ? t(k, lang) : key;
}

function label(zh: string | null, en: string | null, lang: Lang, fallback: string): string {
  return ((lang === 'zh' ? zh : en) ?? en ?? zh) ?? fallback;
}

/** 过滤匹配文本：zh 原文 / en 小写 / py 去空格全拼 / abbr 首字母串（与投影键 name_py* 对应） */
interface MatchText {
  zh: string | null;
  en: string | null;
  py: string | null;
  abbr: string | null;
}

/** query 已归一（trim + 小写）；py 侧同时去空格，"dongge" 与 "dong ge" 等价 */
function matches(q: string, m: MatchText): boolean {
  const qs = q.replace(/\s+/g, '');
  return (
    (m.zh ?? '').includes(q) ||
    (m.en ?? '').toLowerCase().includes(q) ||
    (m.py ?? '').replace(/\s+/g, '').includes(qs) ||
    (m.abbr ?? '').includes(q)
  );
}

/** 叶行记录（过滤显隐 + 选中标记的寻址） */
interface LeafRec {
  li: HTMLLIElement;
  code: string;
  text: MatchText;
}

/** 分支记录：details 显隐/展开；leaves = 子树全部叶行 */
interface BranchRec {
  li: HTMLElement;
  details: HTMLDetailsElement;
  text: MatchText;
  leaves: LeafRec[];
}

export function createPeopleTree(root: HTMLElement): PeopleTreeApi {
  let highlightCb: ((code: string | null) => void) | null = null;
  let toggleCb: ((showInactive: boolean) => void) | null = null;
  let selectCb: ((codes: string[]) => void) | null = null;
  let closeCb: (() => void) | null = null;
  let lastKey = '';
  let curLang: Lang = 'zh';
  /** 过滤词（组件内部状态：地图不依赖，不进 store；重建后重新应用） */
  let query = '';
  /** 选中集合（store 为单一数据源，setSelected 回填；单选 = 空或恰一个元素） */
  let selected = new Set<string>();
  /** 族群 code -> 名称（跨渲染保留：叶行被「仅显示点亮」剪枝时，选中条仍能显示名称） */
  const nameByCode = new Map<string, { zh: string | null; en: string | null }>();
  let leafRecs: LeafRec[] = [];
  let branchRecs: BranchRec[] = [];
  let neutralEl: HTMLElement | null = null;
  let noMatchEl: HTMLElement | null = null;

  // 一次性骨架：标题行（标题 + 移动端关闭钮）+ 过滤输入 + 未点亮显隐切换 + 选中条 + 正文容器
  // （重渲染只重建 body，悬停状态不被打断）
  if (!root.querySelector('.ptree-body')) {
    root.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ptree-head';
    const title = document.createElement('div');
    title.className = 'ptree-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ptree-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', t('treeClose', curLang));
    close.addEventListener('click', () => closeCb?.());
    head.append(title, close);
    const filterRow = document.createElement('div');
    filterRow.className = 'ptree-filter';
    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.id = 'ptree-filter';
    filterInput.autocomplete = 'off';
    const filterClear = document.createElement('button');
    filterClear.type = 'button';
    filterClear.className = 'ptree-filter-clear';
    filterClear.textContent = '✕';
    filterClear.hidden = true;
    filterRow.append(filterInput, filterClear);
    const toggle = document.createElement('label');
    toggle.className = 'ptree-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'ptree-show-inactive';
    cb.checked = true;
    const toggleText = document.createElement('span');
    toggleText.className = 'ptree-toggle-text';
    toggle.append(cb, toggleText);
    const selbar = document.createElement('div');
    selbar.className = 'ptree-selbar';
    selbar.hidden = true;
    const selCount = document.createElement('span');
    selCount.className = 'ptree-sel-count';
    const selClear = document.createElement('button');
    selClear.type = 'button';
    selClear.className = 'ptree-sel-clear';
    selbar.append(selCount, selClear);
    const body = document.createElement('div');
    body.className = 'ptree-body';
    root.append(head, filterRow, toggle, selbar, body);
  }
  const titleEl = root.querySelector<HTMLElement>('.ptree-title')!;
  const closeBtnEl = root.querySelector<HTMLButtonElement>('.ptree-close')!;
  const filterInput = root.querySelector<HTMLInputElement>('#ptree-filter')!;
  const filterClear = root.querySelector<HTMLButtonElement>('.ptree-filter-clear')!;
  const toggleInput = root.querySelector<HTMLInputElement>('#ptree-show-inactive')!;
  const toggleTextEl = root.querySelector<HTMLElement>('.ptree-toggle-text')!;
  const selbarEl = root.querySelector<HTMLElement>('.ptree-selbar')!;
  const selCountEl = root.querySelector<HTMLElement>('.ptree-sel-count')!;
  const selClearEl = root.querySelector<HTMLButtonElement>('.ptree-sel-clear')!;
  const body = root.querySelector<HTMLElement>('.ptree-body')!;
  toggleInput.addEventListener('change', () => toggleCb?.(toggleInput.checked));
  filterInput.addEventListener('input', () => {
    query = filterInput.value;
    applyFilter();
  });
  filterInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && query !== '') {
      filterInput.value = '';
      query = '';
      applyFilter();
    }
  });
  filterClear.addEventListener('click', () => {
    filterInput.value = '';
    query = '';
    applyFilter();
    filterInput.focus();
  });
  selClearEl.addEventListener('click', () => selectCb?.([]));

  // 悬停树叶的 tooltip：完整族群名 + 当年全部活动区域（行内注记会被省略号截断）。
  // 挂在 body 上、fixed 定位于谱系树右侧，不受谱系树滚动区域裁剪
  const tip = document.createElement('div');
  tip.className = 'ptree-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const tipName = document.createElement('div');
  tipName.className = 'tt-name';
  const tipMeta = document.createElement('div');
  tipMeta.className = 'tt-meta';
  tip.append(tipName, tipMeta);
  document.body.appendChild(tip);
  root.addEventListener('scroll', () => (tip.hidden = true), { passive: true });

  function showTip(li: HTMLElement, leaf: TreeLeaf, lang: Lang): void {
    tipName.textContent = label(leaf.people.name_zh, leaf.people.name_en, lang, leaf.people.code);
    const regions = leaf.active ? leaf.regions.map((r) => label(r.name_zh, r.name_en, lang, r.code)).join('、') : '';
    tipMeta.textContent = regions;
    tipMeta.hidden = regions === '';
    tip.hidden = false;
    const GAP = 8;
    const lr = li.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const left = Math.min(root.getBoundingClientRect().right + GAP, window.innerWidth - tr.width - GAP);
    const top = Math.min(Math.max(GAP, lr.top + lr.height / 2 - tr.height / 2), window.innerHeight - tr.height - GAP);
    tip.style.left = `${Math.max(GAP, left)}px`;
    tip.style.top = `${top}px`;
  }

  /** 点击叶行 → 单选该族群（再点同一叶取消）→ onSelect 上报（store 回流后 setSelected 刷新标记） */
  function pickCode(code: string): void {
    selectCb?.(selected.has(code) ? [] : [code]);
  }

  /** 就地刷新选中标记：叶行类名 + 选中条（单选：显示所选族群名） */
  function refreshSelMarks(): void {
    for (const r of leafRecs) r.li.classList.toggle('selected', selected.has(r.code));
    const code = selected.size > 0 ? [...selected][0]! : null;
    selbarEl.hidden = code === null;
    if (code !== null) {
      const nm = nameByCode.get(code);
      selCountEl.textContent = t('treeSelected', curLang).replace('{name}', label(nm?.zh ?? null, nm?.en ?? null, curLang, code));
    }
  }

  /** 应用当前过滤词：叶/分支就地显隐，命中路径自动展开；空结果提示行 */
  function applyFilter(): void {
    const q = query.trim().toLowerCase();
    filterClear.hidden = q === '';
    const hit = new Set<LeafRec>();
    if (q !== '') {
      for (const r of leafRecs) if (matches(q, r.text)) hit.add(r);
      for (const b of branchRecs) if (matches(q, b.text)) for (const l of b.leaves) hit.add(l);
    }
    const filtering = q !== '';
    for (const r of leafRecs) r.li.style.display = !filtering || hit.has(r) ? '' : 'none';
    for (const b of branchRecs) {
      const any = b.leaves.some((l) => hit.has(l));
      b.li.style.display = !filtering || any ? '' : 'none';
      if (filtering && any) b.details.open = true; // 命中路径展开，其余分支保持用户展开态
    }
    if (neutralEl) neutralEl.style.display = filtering ? 'none' : '';
    if (noMatchEl) noMatchEl.style.display = filtering && hit.size === 0 ? '' : 'none';
  }

  function leafEl(leaf: TreeLeaf, lang: Lang): LeafRec {
    const li = document.createElement('li');
    li.className = 'ptree-leaf' + (leaf.active ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = leaf.color ?? 'var(--context-fill)';
    const name = document.createElement('span');
    name.className = 'ptree-leaf-name';
    name.textContent = label(leaf.people.name_zh, leaf.people.name_en, lang, leaf.people.code);
    li.append(dot, name);
    if (leaf.active && leaf.regions.length > 0) {
      const regs = document.createElement('span');
      regs.className = 'ptree-leaf-regions';
      regs.textContent = leaf.regions.map((r) => label(r.name_zh, r.name_en, lang, r.code)).join('、');
      li.append(regs);
    }
    li.addEventListener('pointerenter', (evt) => {
      highlightCb?.(leaf.people.code);
      // 触屏无悬停语义：tooltip 只跟随鼠标（触屏 tap 的 enter/leave 同拍闪现，不展示）
      if (evt.pointerType !== 'touch') showTip(li, leaf, lang);
    });
    li.addEventListener('pointerleave', () => {
      highlightCb?.(null);
      tip.hidden = true;
    });
    li.addEventListener('click', () => pickCode(leaf.people.code));
    nameByCode.set(leaf.people.code, { zh: leaf.people.name_zh, en: leaf.people.name_en });
    return {
      li,
      code: leaf.people.code,
      text: { zh: leaf.people.name_zh, en: leaf.people.name_en, py: leaf.people.name_py, abbr: leaf.people.name_py_abbr },
    };
  }

  function nodeText(node: AtlasTaxonomyNode | null): MatchText {
    return node
      ? { zh: node.name_zh, en: node.name_en, py: node.name_py, abbr: node.name_py_abbr }
      : { zh: null, en: null, py: null, abbr: null };
  }

  /** 组级标签（语言谱系等 UI 文案）：双语原文匹配；无拼音键（固定 4 个） */
  function groupText(key: string): MatchText {
    const k = GROUP_KEYS[key];
    return k ? { zh: t(k, 'zh'), en: t(k, 'en'), py: null, abbr: null } : { zh: key, en: key, py: null, abbr: null };
  }

  /** branch 内容：叶子列表 + 子分支列表（各层子分支都包进自己的 ul.ptree-branches，逐层缩进）；
   *  root（node=null）不生成节点行。返回该分支子树全部叶行（过滤用）。 */
  function branchContent(branch: TreeBranch, lang: Lang, into: HTMLElement): LeafRec[] {
    const mine: LeafRec[] = [];
    if (branch.leaves.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'ptree-leaves';
      for (const leaf of branch.leaves) {
        const rec = leafEl(leaf, lang);
        ul.appendChild(rec.li);
        mine.push(rec);
      }
      into.appendChild(ul);
    }
    if (branch.children.length === 0) return mine;
    const branches = document.createElement('ul');
    branches.className = 'ptree-branches';
    into.appendChild(branches);
    for (const child of branch.children) {
      const li = document.createElement('li');
      li.className = 'ptree-node';
      const details = document.createElement('details');
      details.open = child.activeCount > 0;
      const summary = document.createElement('summary');
      const nm = document.createElement('span');
      nm.className = 'ptree-node-name';
      nm.textContent = label(child.node?.name_zh ?? null, child.node?.name_en ?? null, lang, child.node?.code ?? '?');
      const cn = document.createElement('span');
      cn.className = 'count';
      cn.textContent = String(child.totalCount);
      summary.append(nm, cn);
      details.appendChild(summary);
      const childLeaves = branchContent(child, lang, details);
      li.appendChild(details);
      branches.appendChild(li);
      const rec: BranchRec = { li, details, text: nodeText(child.node), leaves: childLeaves };
      branchRecs.push(rec);
      mine.push(...childLeaves);
    }
    return mine;
  }

  return {
    onHighlight(cb) {
      highlightCb = cb;
    },

    onToggle(cb) {
      toggleCb = cb;
    },

    onSelect(cb) {
      selectCb = cb;
    },

    onClose(cb) {
      closeCb = cb;
    },

    setSelected(sel) {
      selected = new Set(sel);
      refreshSelMarks();
    },

    render(model, year, lang, showInactive, sel) {
      curLang = lang;
      selected = new Set(sel);
      const groups = model.peopleTreeAt(year);
      titleEl.textContent = t('treeTitle', lang);
      toggleTextEl.textContent = t('treeShowInactive', lang);
      filterInput.placeholder = t('treeFilterPlaceholder', lang);
      filterClear.setAttribute('aria-label', t('treeFilterClear', lang));
      closeBtnEl.setAttribute('aria-label', t('treeClose', lang));
      selClearEl.textContent = t('treeSelClear', lang);
      toggleInput.checked = showInactive; // 单一数据源：store 状态回填
      const key = `${lang}|${year}|${showInactive ? 'all' : 'active'}`;
      refreshSelMarks(); // 早退路径（key 未变）也要刷新（选中集可能与上次不同）
      if (key === lastKey) return;
      lastKey = key;

      tip.hidden = true; // 重建会移除悬停中的树叶（不触发 pointerleave），先收起 tooltip
      leafRecs = [];
      branchRecs = [];
      body.innerHTML = '';
      for (const group of groups) {
        const rootBranch = showInactive ? group.root : activeOnly(group.root);
        if (!rootBranch) continue; // 该分类当年无点亮族群，整组隐藏
        const details = document.createElement('details');
        details.className = 'ptree-group';
        details.open = showInactive ? group.open : true;
        const summary = document.createElement('summary');
        const nm = document.createElement('span');
        nm.className = 'ptree-node-name';
        nm.textContent = groupLabel(group.key, lang);
        const cn = document.createElement('span');
        cn.className = 'count';
        cn.textContent = String(rootBranch.totalCount);
        summary.append(nm, cn);
        details.appendChild(summary);
        const leaves = branchContent(rootBranch, lang, details);
        leafRecs.push(...leaves); // 组件级叶索引：过滤与选中标记遍历用
        branchRecs.push({ li: details, details, text: groupText(group.key), leaves });
        body.appendChild(details);
      }

      // 中性底图图例（不属于任何 taxonomy）
      const neutral = document.createElement('div');
      neutral.className = 'ptree-neutral';
      const nd = document.createElement('span');
      nd.className = 'dot';
      nd.style.background = 'var(--context-fill)';
      neutral.append(nd, document.createTextNode(t('legendNeutral', lang)));
      body.appendChild(neutral);
      neutralEl = neutral;

      // 过滤空结果提示行（重建后由 applyFilter 决定显隐）
      const noMatch = document.createElement('div');
      noMatch.className = 'ptree-nomatch';
      noMatch.textContent = t('treeFilterNone', lang);
      body.appendChild(noMatch);
      noMatchEl = noMatch;

      refreshSelMarks();
      applyFilter(); // 重建 DOM 后恢复当前过滤词的效果
    },
  };
}
