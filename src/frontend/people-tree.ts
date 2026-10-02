// 左侧族群谱系树（族群分布模式的图例）：
// 按 SQL taxonomy 层级组织全部族群（印欧语系 → 日耳曼 → 东日耳曼 → 哥特 → 东西哥特人…），
// 当年活动者正常亮度并注记活动区域，未活动者压暗；悬停树叶 → 地图高亮该族群、其余压暗。
// 文本用 ink 色，色点只做身份标识（dataviz 规范）。

import type { AtlasModel, TreeBranch, TreeLeaf } from './atlas';
import { t, type Lang, type StringKey } from './i18n';

const GROUP_KEYS: Record<string, StringKey> = {
  language: 'taxLanguage',
  historical_people: 'taxHistorical',
  modern_ethnicity: 'taxModern',
  unclassified: 'taxUnclassified',
};

export interface PeopleTreeApi {
  /** showInactive=false 时仅渲染当年点亮（活动）的族群，空分支与空分组整体剪枝 */
  render(model: AtlasModel, year: number, lang: Lang, showInactive: boolean): void;
  onHighlight(cb: (peopleCode: string | null) => void): void;
  onToggle(cb: (showInactive: boolean) => void): void;
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

export function createPeopleTree(root: HTMLElement): PeopleTreeApi {
  let highlightCb: ((code: string | null) => void) | null = null;
  let toggleCb: ((showInactive: boolean) => void) | null = null;
  let lastKey = '';

  // 一次性骨架：标题 + 未点亮显隐切换 + 正文容器（重渲染只重建 body，悬停状态不被打断）
  if (!root.querySelector('.ptree-body')) {
    root.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'ptree-title';
    const toggle = document.createElement('label');
    toggle.className = 'ptree-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'ptree-show-inactive';
    cb.checked = true;
    const toggleText = document.createElement('span');
    toggleText.className = 'ptree-toggle-text';
    toggle.append(cb, toggleText);
    const body = document.createElement('div');
    body.className = 'ptree-body';
    root.append(title, toggle, body);
  }
  const titleEl = root.querySelector<HTMLElement>('.ptree-title')!;
  const toggleInput = root.querySelector<HTMLInputElement>('#ptree-show-inactive')!;
  const toggleTextEl = root.querySelector<HTMLElement>('.ptree-toggle-text')!;
  const body = root.querySelector<HTMLElement>('.ptree-body')!;
  toggleInput.addEventListener('change', () => toggleCb?.(toggleInput.checked));

  function leafEl(leaf: TreeLeaf, lang: Lang): HTMLLIElement {
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
    li.addEventListener('pointerenter', () => highlightCb?.(leaf.people.code));
    li.addEventListener('pointerleave', () => highlightCb?.(null));
    return li;
  }

  /** branch 内容：叶子列表 + 子分支；root（node=null）不生成节点行 */
  function branchContent(branch: TreeBranch, lang: Lang, into: HTMLElement): void {
    if (branch.leaves.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'ptree-leaves';
      for (const leaf of branch.leaves) ul.appendChild(leafEl(leaf, lang));
      into.appendChild(ul);
    }
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
      branchContent(child, lang, details);
      li.appendChild(details);
      into.appendChild(li);
    }
  }

  return {
    onHighlight(cb) {
      highlightCb = cb;
    },

    onToggle(cb) {
      toggleCb = cb;
    },

    render(model, year, lang, showInactive) {
      const groups = model.peopleTreeAt(year);
      titleEl.textContent = t('treeTitle', lang);
      toggleTextEl.textContent = t('treeShowInactive', lang);
      toggleInput.checked = showInactive; // 单一数据源：store 状态回填
      const key = `${lang}|${year}|${showInactive ? 'all' : 'active'}`;
      if (key === lastKey) return;
      lastKey = key;

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
        const wrap = document.createElement('ul');
        wrap.className = 'ptree-branches';
        branchContent(rootBranch, lang, wrap);
        details.appendChild(wrap);
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
    },
  };
}
