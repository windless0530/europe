// 调色板（dataviz 参考实例，已用六项校验器验证通过）：
// - 分类 2 槽（蓝/橙）all-pairs 通过（明/暗）
// - NUTS 层级序数蓝色带（明/暗）
// - 背景层中性灰（不承载系列身份）

export interface ModePalette {
  series: { blue: string; orange: string };
  ordinalBlue: string[]; // L0..L3
  contextFill: string;
}

const LIGHT: ModePalette = {
  series: { blue: '#2a78d6', orange: '#eb6834' },
  ordinalBlue: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'],
  contextFill: '#ecebe7',
};

const DARK: ModePalette = {
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
  family: string,
  level: number | null,
  pal: ModePalette = modePalette(),
): string {
  switch (family) {
    case 'people':
    case 'provinces':
      return pal.series.blue;
    case 'empire':
    case 'kingdoms':
      return pal.series.orange;
    case 'undated':
      return pal.contextFill;
    case 'nuts':
      return pal.ordinalBlue[Math.min(Math.max(level ?? 0, 0), 3)];
    default:
      return pal.contextFill;
  }
}
