// 极简发布/订阅状态：所有 UI 都从这一个对象派生。

import type { Lang } from './i18n';
import type { SourceCode } from '../lib/contract.js';

export interface AppState {
  lang: Lang;
  /** atlas = 族群分布（SQL）；geo = 几何浏览 */
  mode: 'atlas' | 'geo';
  source: SourceCode;
  /** 几何模式：当前时间轴索引（对应 view.eras） */
  eraIndex: number;
  /** 族群模式：当前年份（连续） */
  year: number;
  /** NUTS 层级过滤（其他源忽略） */
  nutsLevel: number;
  /** awmc：是否显示未断代实体（波斯/亚历山大等） */
  showUndated: boolean;
  /** hover 中的 region_code */
  hoverCode: string | null;
}

type Listener = (state: AppState) => void;

export function createStore(initial: AppState): { get: () => AppState; set: (patch: Partial<AppState>) => void; subscribe: (fn: Listener) => () => void } {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
