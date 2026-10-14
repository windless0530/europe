// 拼音检索键（投影期生成进 atlas.json，前端匹配零字典成本、零网络）：
//   name_py      = 全拼小写空格分隔（"dong ge te ren"）
//   name_py_abbr = 各字首字母（"dgtr"）
// 前端匹配时 query 与 name_py 同时去空格比较，"dongge" / "dong ge" 皆可命中。
// 多音字按 pinyin-pro 词组模式取常用读音，个别歧义可接受（检索尽力而为）。

import { pinyin } from 'pinyin-pro';

export interface PinyinKeys {
  name_py: string | null;
  name_py_abbr: string | null;
}

export function pinyinKeys(nameZh: string | null): PinyinKeys {
  if (!nameZh || !/[一-鿿]/.test(nameZh)) return { name_py: null, name_py_abbr: null };
  return {
    name_py: pinyin(nameZh, { toneType: 'none', type: 'array' }).join(' '),
    name_py_abbr: pinyin(nameZh, { pattern: 'first', toneType: 'none', type: 'array' }).join(''),
  };
}
