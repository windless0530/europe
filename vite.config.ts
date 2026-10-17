import { cpSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const REPO = path.dirname(fileURLToPath(import.meta.url));

/**
 * 开发期数据通道（dev server；构建产物由下方 closeBundle 拷贝同构静态文件进 dist）：
 *   GET {base}config                              -> atlas.config.json（当前数据源）
 *   GET {base}data/geography/processed/<src>/<file> -> data/geography/processed/<src>/<file>（白名单）
 *
 * 缓存：ETag（mtime+size）+ Cache-Control: no-cache——可缓存但须再验证，文件再生
 * （npm run project 改 mtime）后自动失效；重复访问 304 免全量重下 ~5MB。
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
            const st = statSync(file);
            // 强 ETag；匹配容忍 W/ 前缀（nginx gzip 会把强 ETag 弱化后回传给客户端）
            const etag = `"${Math.floor(st.mtimeMs).toString(16)}-${st.size.toString(16)}"`;
            const inm = req.headers['if-none-match'];
            const hit =
              typeof inm === 'string' && inm.split(',').some((t) => { const v = t.trim(); return v === etag || v === `W/${etag}` || v === '*'; });
            if (hit) {
              res.statusCode = 304;
              res.setHeader('ETag', etag);
              res.setHeader('Cache-Control', 'no-cache');
              res.end();
              return;
            }
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('ETag', etag);
            // 反代默认不为 application/json 开 gzip（nginx 默认 gzip_types 仅 text/html），
            // 这里的数据是首次加载的主体（geojson 4.5MB -> ~1.2MB）；中间件自行 gzip，
            // 上游已带 Content-Encoding 的响应代理会原样透传。gzip 输出确定性，ETag 仍一致。
            if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && body.length >= 1024) {
              const gz = gzipSync(body, { level: 6 });
              res.setHeader('Content-Encoding', 'gzip');
              res.setHeader('Vary', 'Accept-Encoding');
              res.setHeader('Content-Length', String(gz.length));
              res.end(gz);
              return;
            }
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
    // 正式构建自包含：前端启动/按需加载引用的静态数据与 /config 一并拷进 dist，
    // 并为大体量 JSON/GeoJSON 生成 .gz 预压缩伴随文件（nginx gzip_static 直接发送，
    // 免每请求动态压缩 ~4.5MB 的 CPU）。npm run project 后需重新 build 才会反映数据变更。
    closeBundle() {
      const out = path.join(REPO, 'dist');
      const copies: Array<[string, string]> = [
        ['data/peoples/export/atlas.json', 'data/peoples/export/atlas.json'],
        ['data/peoples/export/atlas-geometry.geojson', 'data/peoples/export/atlas-geometry.geojson'],
        ['data/geography/processed/awmc/regions.geojson', 'data/geography/processed/awmc/regions.geojson'],
        ['data/geography/processed/darmc/regions.geojson', 'data/geography/processed/darmc/regions.geojson'],
        ['data/geography/processed/nuts/regions.geojson', 'data/geography/processed/nuts/regions.geojson'],
        ['atlas.config.json', 'config'],
      ];
      for (const [src, dest] of copies) {
        const from = path.join(REPO, src);
        const to = path.join(out, dest);
        cpSync(from, to);
        writeFileSync(`${to}.gz`, gzipSync(readFileSync(from), { level: 9 }));
      }
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
