// 调色板扩展选择器：以现有 8 色为种子，从候选池贪心补足 16 色，
// 最大化相邻色对的最小距离（正常视觉 OKLab ΔE ×100 + 二色视觉模拟后 ΔE）。
// dataviz 规范：正常 ≥15、CVD ≥8（×100 制）。输出 light/dark 两套。
// 用法：node scripts/pick-palette.mjs

// ---------- 色彩数学（sRGB -> OKLab） ----------
const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

function rgbToOklab(rgb) {
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
function oklabToRgb([L, a, b]) {
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

/** 全色对最小距离：正常 + 两种二色视觉 */
function pairScores(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return {
    normal: DE(rgbToOklab(a), rgbToOklab(b)),
    protan: DE(rgbToOklab(simCvd(a, PROTAN)), rgbToOklab(simCvd(b, PROTAN))),
    deutan: DE(rgbToOklab(simCvd(a, DEUTAN)), rgbToOklab(simCvd(b, DEUTAN))),
  };
}

// ---------- 候选与选择 ----------
const SEED = []; // 旧 8 色含 CVD 3.3 坏对，不作种子
// 地图调色板与图表序列不同：全对可分辨受色度学上限约束（12+ 色无法全对 ΔE≥15）。
// 策略：正常视觉 ΔE 与表面反差优先，CVD 以 1.33 权重放宽到 ~7.5 目标
//（谱系树/hover 提供完整次级标识，符合 6–8 地板 + 次级编码条款），
// 残余同年同色碰撞由槽位周期（palette 长度）经验扫描决定。
const SURFACE_LIGHT = '#ecebe7';
const pool = new Set();
for (let deg = 0; deg < 360; deg += 11.25) {
  for (const L of [0.48, 0.58, 0.68]) {
    for (const C of [0.1, 0.16]) {
      const rad = (deg * Math.PI) / 180;
      pool.add(rgbToHex(oklabToRgb([L, C * Math.cos(rad), C * Math.sin(rad)])));
    }
  }
}

const scoreOf = (cand, set) => {
  let worst = Infinity;
  for (const s of set) {
    const p = pairScores(cand, s);
    worst = Math.min(worst, p.normal, Math.min(p.protan, p.deutan) * 1.33);
  }
  return worst;
};

function pickN(n, surface) {
  const picked = [];
  const hueOf = (hex) => {
    const [L, a, b] = rgbToOklab(hexToRgb(hex));
    return { h: (Math.atan2(b, a) * 180) / Math.PI, L };
  };
  // 锚点：最接近经典蓝的候选，保持既有蓝色主调观感
  let anchor = null, anchorD = Infinity;
  for (const c of pool) {
    const d = DE(rgbToOklab(hexToRgb(c)), rgbToOklab(hexToRgb('#2a78d6')));
    if (d < anchorD) { anchorD = d; anchor = c; }
  }
  picked.push(anchor);
  const localPool = new Set([...pool].filter((c) => c !== anchor));
  while (picked.length < n) {
    let best = null, bestScore = -1;
    for (const c of localPool) {
      const ch = hueOf(c);
      // 扇区约束：每 45° 色相扇区至多 2 色；同扇区第二色须与首色明度差 >= 0.12
      const sector = Math.floor(((ch.h + 360) % 360) / 45);
      const inSector = picked.filter((p) => Math.floor(((hueOf(p).h + 360) % 360) / 45) === sector);
      if (inSector.length >= 2) continue;
      if (inSector.length === 1 && Math.abs(hueOf(inSector[0]).L - ch.L) < 0.12) continue;
      const score = scoreOf(c, [...picked, surface]);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best === null) {
      // 扇区约束无解时退化为无约束最优，保证收敛
      for (const c of localPool) {
        const score = scoreOf(c, [...picked, surface]);
        if (score > bestScore) { bestScore = score; best = c; }
      }
    }
    picked.push(best);
    localPool.delete(best);
  }
  return picked;
}

// ---------- dark 变体：L 提升约 0.06 ----------
const darken = (hex) => {
  const lab = rgbToOklab(hexToRgb(hex));
  return rgbToHex(oklabToRgb([Math.min(0.82, lab[0] + 0.06), lab[1] * 0.92, lab[2] * 0.92]));
};

// ---------- 报告 ----------
const report = (name, arr) => {
  console.log(`\nconst ${name} = ['${arr.join("', '")}'];`);
  const pairs = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const p = pairScores(arr[i], arr[j]);
      pairs.push({ a: arr[i], b: arr[j], ...p, cvd: Math.min(p.protan, p.deutan) });
    }
  }
  pairs.sort((x, y) => x.normal - y.normal);
  console.log(`${name} 最差 5 对（正常ΔE / CVDΔE）: ${pairs.slice(0, 5).map((p) => `${p.a}vs${p.b} ${p.normal.toFixed(1)}/${p.cvd.toFixed(1)}`).join(' | ')}`);
};
// 最终采用：Okabe-Ito + Tol muted（均为 CVD 专业设计）家族手工精选 16 色，
// 相似色相在序列中拉开距离；残余弱对由「同年共现碰撞扫描」把关。
const CURATED = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#332288', '#999933',
  '#88CCEE', '#117733', '#AA4499', '#8C6D31', '#882255', '#5F7C8A'];
const DARK_CURATED = ['#4C93D6', '#F2A950', '#2FAE85', '#D68BB6', '#6FB9E8', '#E07839', '#5A4FA8', '#A6A64A',
  '#B7DDEA', '#2E8B4A', '#BE62AF', '#A08250', '#A5456F', '#7394A2'];
report('CURATED_LIGHT', CURATED);
report('CURATED_DARK', DARK_CURATED);
if (process.argv[2] === 'greedy') {
  report('GREEDY16', pickN(16, SURFACE_LIGHT));
}
