// 极简发布/订阅状态：所有 UI 都从这一个对象派生。

import type { Lang } from './i18n';
import type { SourceCode } from '../lib/contract.js';

/** 交互模式：atlas = 族群分布；geo = 几何浏览 */
export type Mode = 'atlas' | 'geo';

export interface AppState {
  lang: Lang;
  mode: Mode;
  source: SourceCode;
  /** 几何模式：当前时间轴索引（对应 view.eras） */
  eraIndex: number;
  /** 族群模式：当前年份（连续） */
  year: number;
  /** NUTS 层级过滤（其他源忽略） */
  nutsLevel: number;
  /** awmc：是否显示未断代实体（波斯/亚历山大等） */
  showUndated: boolean;
  /** 族群谱系树：是否显示当年未点亮（未活动）的族群 */
  showInactive: boolean;
  /** 谱系树单选族群（空 = 未选；单元素 = 已选，地图将该族群当年活动区域改涂其族群色） */
  peopleSel: string[];
  /** hover 中的 region_code */
  hoverCode: string | null;
}

/** 订阅回调：prev = 本次 set 之前的状态，用于按变更字段做增量更新；
 *  首次 set 的 prev 为空对象（所有字段比较均为「已变更」），订阅方借此全量渲染。 */
type Listener = (state: AppState, prev: Readonly<AppState>) => void;

const EMPTY_PREV: Readonly<AppState> = Object.freeze({}) as Readonly<AppState>;

export function createStore(initial: AppState): { get: () => AppState; set: (patch: Partial<AppState>) => void; subscribe: (fn: Listener) => () => void } {
  let state = initial;
  let first = true;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      const emitPrev = first ? EMPTY_PREV : prev;
      first = false;
      for (const fn of listeners) fn(state, emitPrev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
