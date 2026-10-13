import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const REPO = path.dirname(fileURLToPath(import.meta.url));

/**
 * 开发期数据通道（仅 dev server；正式构建走导出脚本产出的静态文件）：
 *   GET {base}config                              -> atlas.config.json（当前数据源）
 *   GET {base}data/geography/processed/<src>/<file> -> data/geography/processed/<src>/<file>（白名单）
 *
 * base = '/europe/'：站点挂在 https://<域名>/europe 子路径下（反向代理 -> 本端口）。
 * 反代按「剥前缀」转发（/europe/x -> /x），而 vite 以 base 提供服务，故先补回
 * 被剥掉的前缀再放行；路径保留式转发与浏览器直访 /europe/* 不受影响。
 */
function atlasData(): Plugin {
  return {
    name: 'atlas-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const base = server.config.base; // 形如 '/europe/'，首尾均含斜杠
        if (base !== '/' && !(req.url ?? '/').startsWith(base)) {
          req.url = base.slice(0, -1) + (req.url ?? '/'); // 补回被反代剥掉的前缀（含查询串）
        }
        const url = (req.url ?? '').split('?')[0];
        const rel = url.startsWith(base) ? url.slice(base.length - 1) : url; // 剥 base，保留前导 /
        const sendJson = (file: string): void => {
          try {
            const body = readFileSync(file);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(body);
          } catch {
            res.statusCode = 404;
            res.end('not found');
          }
        };
        if (rel === '/config') {
          sendJson(path.join(REPO, 'atlas.config.json'));
          return;
        }
        if (rel.startsWith('/data/')) {
          const dataRel = decodeURIComponent(rel.slice('/data/'.length)).replace(/\\/g, '/');
          // 白名单里的源码列表 (awmc|darmc|nuts) 与 src/lib/shared.ts 的 SOURCES 保持一致
          if (!/^(geography\/processed\/(awmc|darmc|nuts)|peoples\/export)\/[A-Za-z0-9_.-]+$/.test(dataRel)) {
            res.statusCode = 403;
            res.end('forbidden');
            return;
          }
          sendJson(path.join(REPO, 'data', dataRel));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: '/europe/',
  plugins: [atlasData()],
  server: {
    allowedHosts: ['elio.fans'],
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
  },
});
