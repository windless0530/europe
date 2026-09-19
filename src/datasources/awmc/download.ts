// ============================================================
// AWMC loader · download
// 幂等下载 AWMC geodata 仓库中的选定数据集到 data/raw/awmc/：
//  - 11 个 GeoJSON + 3 个溯源文档（LICENSE / README / 属性说明）
//  - "Cultural Shapefiles Apr 2024.zip"（解压，含 GeoJSON 目录没有的
//    ad_14/ad_69/314 范围、ethnonyms、ba_100 行省线等）
// 已存在且非 --force 时跳过；下载清单写入 _meta.json 供 manifest 使用。
// ============================================================

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { rawDataDir, REPO_ROOT } from '../../lib/contract';
import { GEOJSON_FILES, SHAPEFILES_ZIP } from './config';

interface DownloadRecord {
  url: string;
  file: string;
  bytes: number;
  retrieved_at: string;
}

async function fetchToFile(url: string, dest: string): Promise<number> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'europe-atlas-awmc-loader/0.1 (personal research project)' },
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
  const rawDir = rawDataDir('awmc');
  await mkdir(rawDir, { recursive: true });

  const records: DownloadRecord[] = [];
  let skipped = 0;
  let failed = 0;

  const targets = [
    ...GEOJSON_FILES.map((f) => ({ ...f })),
    { dest: SHAPEFILES_ZIP.dest, url: SHAPEFILES_ZIP.url, label: SHAPEFILES_ZIP.label },
  ];

  for (const t of targets) {
    const dest = path.join(rawDir, t.dest);
    if (!force && existsSync(dest)) {
      skipped++;
      console.log(`  跳过（已存在）: ${t.dest}`);
      records.push({ url: t.url, file: path.relative(REPO_ROOT, dest), bytes: 0, retrieved_at: '' });
      continue;
    }
    try {
      const bytes = await fetchToFile(t.url, dest);
      console.log(`  下载: ${t.label} -> ${t.dest} (${(bytes / 1024).toFixed(0)} KB)`);
      records.push({
        url: t.url,
        file: path.relative(REPO_ROOT, dest),
        bytes,
        retrieved_at: new Date().toISOString(),
      });
    } catch (err) {
      // 单个文件失败不阻塞其余下载；最终汇总非零退出
      failed++;
      console.error(`  失败: ${t.label} — ${err instanceof Error ? err.message : err}`);
    }
  }

  // 解压 shapefile 包（幂等：解压目录已存在则跳过，--force 时重解压）
  const zipPath = path.join(rawDir, SHAPEFILES_ZIP.dest);
  const extractDir = path.join(rawDir, SHAPEFILES_ZIP.extractDir);
  if (existsSync(zipPath)) {
    if (force || !existsSync(extractDir)) {
      console.log('  解压: cultural_shapefiles_apr_2024.zip');
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
    } else {
      console.log('  跳过（已解压）: cultural_shapefiles_apr_2024/');
    }
  } else {
    failed++;
    console.error('  失败: shapefile zip 未下载，无法解压');
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
