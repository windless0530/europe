// 调色板构造库：OKLab 色彩数学 + Machado 二色模拟 + 结构化色环网格。
// 被 scripts/palette-tune.ts 引用（构造候选池与初序）；直接运行则打印初序数组。
//
// 构造：HUE_N 色相 × 3 明度全格点（66 色 @22 色相）。抽象全对下限：
// 同色相 ΔL0.14 → ΔE≥14；相邻色相同明度 ≈4（弱）——由 palette-tune.ts 按
// 实际「同年同屏」槽对爬山排序，弱对被排进永不共现的槽位。
// 用法：node scripts/pick-palette.mjs [色相数=22]

// ---------- 色彩数学（sRGB -> OKLab） ----------
const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};
export const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

export function rgbToOklab(rgb) {
  const [lr, lg, lb] = rgb.map(srgbToLinear);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}
export function oklabToRgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToSrgb);
}

// ---------- 二色视觉模拟（Machado et al. 2009，severity 1.0） ----------
const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];
const DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];
const simCvd = (rgb, m) => {
  const lin = rgb.map(srgbToLinear);
  return [
    m[0][0] * lin[0] + m[0][1] * lin[1] + m[0][2] * lin[2],
    m[1][0] * lin[0] + m[1][1] * lin[1] + m[1][2] * lin[2],
    m[2][0] * lin[0] + m[2][1] * lin[1] + m[2][2] * lin[2],
  ].map((v) => Math.min(1, Math.max(0, v))).map(linearToSrgb);
};

const DE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;

export function pairScores(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return {
    normal: DE(rgbToOklab(a), rgbToOklab(b)),
    protan: DE(rgbToOklab(simCvd(a, PROTAN)), rgbToOklab(simCvd(b, PROTAN))),
    deutan: DE(rgbToOklab(simCvd(a, DEUTAN)), rgbToOklab(simCvd(b, DEUTAN))),
  };
}

/** 槽对得分：正常 ΔE 与 CVD ΔE×1.33 取小（与 dataviz 6–8 地板 + 次级编码条款一致） */
export const pairScore = (hexA, hexB) => {
  const p = pairScores(hexA, hexB);
  return Math.min(p.normal, Math.min(p.protan, p.deutan) * 1.33);
};
/** 仅正常视觉距离（池准入用：CVD 相近的色可留给调优器排进不共现槽） */
export const pairScoreNormal = (hexA, hexB) => pairScores(hexA, hexB).normal;

// ---------- 结构化候选池：HUE_N 色相 × 3 明度 × 2 色度，互距过滤 ----------
// 均匀色相采样在暖色低明度区（棕/橄榄）会产生近重复色（ΔE 2-4），
// 故池先按「质量序扫描 + 互距 ≥ FILTER 地板」过滤，再交给 palette-tune 选排。
export const SURFACE_LIGHT = '#ecebe7';
export function buildPool(hueN = 22, filter = 8) {
  const LS = [0.38, 0.48, 0.58, 0.68, 0.78];
  const CS = [0.09, 0.15, 0.21];
  const raw = [];
  for (let i = 0; i < hueN; i++) {
    const deg = (360 / hueN) * i;
    const rad = (deg * Math.PI) / 180;
    for (const L of LS) {
      for (const C of CS) raw.push(rgbToHex(oklabToRgb([L, C * Math.cos(rad), C * Math.sin(rad)])));
    }
  }
  // 锚点：离经典蓝最近，保持既有蓝色主调观感
  let anchor = null, anchorScore = -Infinity;
  for (const c of raw) {
    const s = -pairScoreNormal(c, '#2a78d6');
    if (s > anchorScore) { anchorScore = s; anchor = c; }
  }
  const admitted = [anchor];
  const rest = new Set(raw.filter((c) => c !== anchor));
  // 贪心 max-min 扫描（准入只看正常视觉 ΔE：CVD 相近的色可留给调优器排进不共现槽）
  while (rest.size > 0) {
    let best = null, bestScore = -Infinity;
    for (const c of rest) {
      let worst = Infinity;
      for (const a of [...admitted, SURFACE_LIGHT]) worst = Math.min(worst, pairScoreNormal(c, a));
      if (worst > bestScore) { bestScore = worst; best = c; }
    }
    if (bestScore < filter) break;
    admitted.push(best);
    rest.delete(best);
  }
  return admitted;
}
/** 兼容旧名 */
export const buildWheel = (hueN = 22) => buildPool(hueN);

/** 初序：贪心 max-min（含表面色），锚定经典蓝主调 */
export function initialOrder(wheel) {
  let anchor = null, anchorD = Infinity;
  for (const c of wheel) {
    const d = DE(rgbToOklab(hexToRgb(c)), rgbToOklab(hexToRgb('#2a78d6')));
    if (d < anchorD) { anchorD = d; anchor = c; }
  }
  const ordered = [anchor];
  const rest = new Set(wheel.filter((c) => c !== anchor));
  while (rest.size > 0) {
    let best = null, bestScore = -1;
    for (const c of rest) {
      let worst = Infinity;
      for (const s of [...ordered, SURFACE_LIGHT]) worst = Math.min(worst, pairScore(c, s));
      if (worst > bestScore) { bestScore = worst; best = c; }
    }
    ordered.push(best);
    rest.delete(best);
  }
  return ordered;
}

/** dark 变体：L + 0.06（封顶 0.80），C × 0.92 */
export const darken = (hex) => {
  const lab = rgbToOklab(hexToRgb(hex));
  return rgbToHex(oklabToRgb([Math.min(0.8, lab[0] + 0.06), lab[1] * 0.92, lab[2] * 0.92]));
};

// ---------- CLI：打印初序（实际采用值以 palette-tune.ts 输出为准） ----------
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const hueN = Number(process.argv[2] ?? 22);
  const light = initialOrder(buildWheel(hueN));
  const dark = light.map(darken);
  for (const [name, arr] of [['CATEGORICAL_LIGHT', light], ['CATEGORICAL_DARK', dark]]) {
    console.log(`const ${name} = [`);
    for (let i = 0; i < arr.length; i += 6) console.log('  ' + arr.slice(i, i + 6).map((c) => `'${c}',`).join(' '));
    console.log('];');
  }
  console.error('（初序仅供参照；实际调色板由 scripts/palette-tune.ts 按实际共现槽对调优后写入 atlas.ts）');
}
