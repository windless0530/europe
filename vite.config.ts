import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const REPO = path.dirname(fileURLToPath(import.meta.url));

/**
 * 开发期数据通道（仅 dev server；正式构建走导出脚本产出的静态文件）：
 *   GET /config                        -> atlas.config.json（当前数据源）
 *   GET /data/processed/<src>/<file>   -> data/processed/<src>/<file>（白名单）
 */
function atlasData(): Plugin {
  return {
    name: 'atlas-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
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
        if (url === '/config') {
          sendJson(path.join(REPO, 'atlas.config.json'));
          return;
        }
        if (url.startsWith('/data/')) {
          const rel = decodeURIComponent(url.slice('/data/'.length)).replace(/\\/g, '/');
          if (!/^(processed\/(awmc|darmc|nuts)|export)\/[A-Za-z0-9_.-]+$/.test(rel)) {
            res.statusCode = 403;
            res.end('forbidden');
            return;
          }
          sendJson(path.join(REPO, 'data', rel));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [atlasData()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
  },
});
