// 调色板（dataviz 参考实例，已用六项校验器验证通过）：
// - 分类 2 槽（蓝/橙）all-pairs 通过（明/暗）
// - NUTS 层级序数蓝色带（明/暗）
// - 背景层中性灰（不承载系列身份）

import { NUTS_LEVELS } from '../lib/shared.js';
import { FAMILY } from './load';
import type { Family } from './load';

export interface ModePalette {
  series: { blue: string; orange: string };
  ordinalBlue: string[]; // L0..L3
  contextFill: string;
}

// 系列色与 styles.css 的 --series-blue / --series-orange（含暗色覆盖）是同一组值的两处表达，
// 改动须两处同步（此处供地图系列编码，css 供 UI 控件）
export const LIGHT: ModePalette = {
  series: { blue: '#2a78d6', orange: '#eb6834' },
  ordinalBlue: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'],
  contextFill: '#ecebe7',
};

export const DARK: ModePalette = {
  series: { blue: '#3987e5', orange: '#d95926' },
  ordinalBlue: ['#6da7ec', '#3987e5', '#256abf', '#184f95'],
  contextFill: '#262624',
};

export function isDarkMode(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function modePalette(): ModePalette {
  return isDarkMode() ? DARK : LIGHT;
}

export function onModeChange(cb: () => void): void {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}

/** 区域家族 -> 填充色（ nuts 按层级取序数带，其余取分类槽或中性背景色） */
export function familyFill(
  family: Family,
  level: number | null,
  pal: ModePalette = modePalette(),
): string {
  switch (family) {
    case FAMILY.people:
    case FAMILY.provinces:
      return pal.series.blue;
    case FAMILY.empire:
    case FAMILY.kingdoms:
      return pal.series.orange;
    case FAMILY.undated:
      return pal.contextFill;
    case FAMILY.nuts:
      return pal.ordinalBlue[Math.min(Math.max(level ?? 0, 0), NUTS_LEVELS.length - 1)];
    default:
      return pal.contextFill;
  }
}
