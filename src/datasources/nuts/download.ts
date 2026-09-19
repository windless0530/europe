// ============================================================
// NUTS loader · download
// 幂等下载：NUTS 2024 20M 4326 LEVL 0-3 + GADM 4.1 补齐文件。
// 已存在且非 --force 时跳过；下载清单与时间戳写入 _meta.json
// 供 normalize/validate 生成 manifest 的 retrieved_at / download_urls。
// ============================================================

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { rawDataDir, REPO_ROOT } from '../../lib/contract';
import {
  NUTS_LEVELS,
  GADM_COUNTRIES,
  nutsFileName,
  nutsUrl,
  gadmFileName,
  gadmUrl,
} from './config';

interface DownloadRecord {
  url: string;
  file: string;
  bytes: number;
  retrieved_at: string;
}

async function fetchToFile(url: string, dest: string): Promise<number> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'europe-atlas-nuts-loader/0.1 (personal research project)' },
  });
  if (!res.ok) {
    throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`下载内容为空: ${url}`);
  await writeFile(dest, buf);
  return buf.length;
}

export async function runDownload(force = false): Promise<void> {
  const rawDir = rawDataDir('nuts');
  const gadmDir = path.join(rawDir, 'gadm');
  await mkdir(gadmDir, { recursive: true });

  const records: DownloadRecord[] = [];
  let skipped = 0;
  let failed = 0;

  const targets: Array<{ url: string; dest: string; label: string }> = [];
  for (const level of NUTS_LEVELS) {
    targets.push({ url: nutsUrl(level), dest: path.join(rawDir, nutsFileName(level)), label: `NUTS LEVL ${level}` });
  }
  for (const spec of GADM_COUNTRIES) {
    for (const level of spec.levels) {
      targets.push({
        url: gadmUrl(spec.iso3, level),
        dest: path.join(gadmDir, gadmFileName(spec.iso3, level)),
        label: `GADM ${spec.iso3} L${level}`,
      });
    }
  }

  for (const t of targets) {
    if (!force && existsSync(t.dest)) {
      skipped++;
      console.log(`  跳过（已存在）: ${path.relative(REPO_ROOT, t.dest)}`);
      records.push({ url: t.url, file: path.relative(REPO_ROOT, t.dest), bytes: 0, retrieved_at: '' });
      continue;
    }
    try {
      const bytes = await fetchToFile(t.url, t.dest);
      console.log(`  下载: ${t.label} -> ${path.relative(REPO_ROOT, t.dest)} (${(bytes / 1024).toFixed(0)} KB)`);
      records.push({
        url: t.url,
        file: path.relative(REPO_ROOT, t.dest),
        bytes,
        retrieved_at: new Date().toISOString(),
      });
    } catch (err) {
      // 单个文件失败不阻塞其余下载；最终汇总非零退出
      failed++;
      console.error(`  失败: ${t.label} — ${err instanceof Error ? err.message : err}`);
    }
  }

  // 已存在（跳过）的文件补上真实 mtime，保证 retrieved_at 总有值
  for (const r of records) {
    if (r.retrieved_at === '' && existsSync(path.join(REPO_ROOT, r.file))) {
      r.retrieved_at = new Date((await import('node:fs')).statSync(path.join(REPO_ROOT, r.file)).mtime).toISOString();
    }
  }

  const metaPath = path.join(rawDir, '_meta.json');
  await writeFile(metaPath, JSON.stringify({ generated_at: new Date().toISOString(), downloads: records }, null, 2));
  console.log(`\n下载完成：${records.length} 个文件（跳过 ${skipped}，失败 ${failed}）；清单见 ${metaPath}`);

  if (failed > 0) process.exitCode = 1;
}
