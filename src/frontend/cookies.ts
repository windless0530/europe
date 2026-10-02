// ============================================================
// Cookie 读写工具：本地 UI 偏好持久化（刷新页面后保留）。
// 只承载界面状态（如谱系树「显示未点亮族群」开关），不承载
// 图谱数据；键名与含义由调用方约定，值一律 URI 编码。
// ============================================================

export interface CookieOptions {
  /** 有效期（天），缺省 365 */
  maxAgeDays?: number;
  /** 作用路径，缺省 '/'（整站） */
  path?: string;
  /** 缺省 'Lax'（本地偏好足够，无需跨站） */
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** 读取单个 cookie；不存在返回 null */
export function getCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const kv = part.trim();
    if (kv.startsWith(prefix)) return decodeURIComponent(kv.slice(prefix.length));
  }
  return null;
}

/** 写入 cookie（覆盖同名旧值）；环境禁用 cookie 时静默失败，读取端回退默认值 */
export function setCookie(name: string, value: string, opts: CookieOptions = {}): void {
  const { maxAgeDays = 365, path = '/', sameSite = 'Lax' } = opts;
  document.cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}` +
    `; max-age=${Math.round(maxAgeDays * 86400)}; path=${path}; samesite=${sameSite}`;
}

/** 删除 cookie（需与写入时的 path 一致） */
export function deleteCookie(name: string, path = '/'): void {
  document.cookie = `${encodeURIComponent(name)}=; max-age=0; path=${path}`;
}
