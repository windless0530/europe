// ============================================================
// GeoJSON 人类可读序列化：结构多行（2 空格缩进），坐标保持行内
// （每个环 / 点列一行，纯数字数组单行），体积只增几个百分点。
// writeJson 对 *.geojson 自动使用；重新格式化不改变 JSON 语义，
// JSON.parse 后与紧凑版逐点相等。
// ============================================================

const IND = '  ';

const isNumArray = (v: unknown[]): boolean => typeof v[0] === 'number';
const isPointList = (v: unknown[]): boolean =>
  Array.isArray(v[0]) && typeof (v[0] as unknown[])[0] === 'number';

/** coordinates 专属：环 / LineString 点列 / 点 = 单行；其上线性层级逐层分行 */
function fmtCoords(v: unknown, depth: number): string {
  if (!Array.isArray(v) || v.length === 0) return JSON.stringify(v) ?? 'null';
  if (isNumArray(v) || isPointList(v)) return JSON.stringify(v);
  const pad = IND.repeat(depth + 1);
  const body = v.map((x) => `${pad}${fmtCoords(x, depth + 1)}`).join(',\n');
  return `[\n${body}\n${IND.repeat(depth)}]`;
}

function fmtArray(v: unknown[], depth: number): string {
  if (v.length === 0 || isNumArray(v)) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
  const pad = IND.repeat(depth + 1);
  const body = v.map((x) => `${pad}${fmt(x, depth + 1)}`).join(',\n');
  return `[\n${body}\n${IND.repeat(depth)}]`;
}

function fmt(v: unknown, depth: number): string {
  if (Array.isArray(v)) return fmtArray(v, depth);
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const pad = IND.repeat(depth + 1);
    const body = entries
      .map(([k, val]) => `${pad}${JSON.stringify(k)}: ${k === 'coordinates' ? fmtCoords(val, depth + 1) : fmt(val, depth + 1)}`)
      .join(',\n');
    return `{\n${body}\n${IND.repeat(depth)}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function formatGeoJson(value: unknown): string {
  return fmt(value, 0) + '\n';
}
