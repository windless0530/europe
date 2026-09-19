// ============================================================
// 数据源管理 CLI（汇总/切换/对比）
//
//   npm run data -- list                    列出三个数据源与产物就绪状态
//   npm run data -- use <source>            切换当前数据源（写 atlas.config.json）
//   npm run data -- status                  当前数据源 + 产物概况
//   npm run data -- compare                 三源对比表
//   npm run data -- check                   校验各源 manifest 与产物一致性
// ============================================================

import { REGISTRY, activeSource, listSources, loadSource, useSource } from './datasources/registry.js';
import { SOURCES, type SourceCode } from './lib/contract.js';

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, n - 1)}…` : s;
  return t.padEnd(n, ' ');
}

function fmtBounds(b: [number, number, number, number] | null): string {
  if (!b) return '—';
  return `[${b[0].toFixed(1)}, ${b[1].toFixed(1)}, ${b[2].toFixed(1)}, ${b[3].toFixed(1)}]`;
}

function featureCount(fc: { features: unknown[] } | null): number {
  return fc ? fc.features.length : 0;
}

function artifactSummary(source: SourceCode): string {
  try {
    const loaded = loadSource(source);
    const parts: string[] = [];
    if (loaded.regions) parts.push(`regions=${featureCount(loaded.regions)}`);
    if (loaded.places) parts.push(`places=${featureCount(loaded.places)}`);
    if (loaded.lines) parts.push(`lines=${featureCount(loaded.lines)}`);
    return parts.length > 0 ? parts.join(' ') : '（无产物）';
  } catch (err) {
    return `（未生成：${(err as Error).message}）`;
  }
}

function cmdList(): void {
  const active = activeSource();
  console.log('可用数据源（* 为当前）：\n');
  for (const entry of listSources()) {
    const mark = entry.code === active ? '*' : ' ';
    console.log(`${mark} ${pad(entry.code, 6)} ${entry.title}`);
    console.log(`  ${entry.description}`);
    console.log(`  时间：${entry.temporal}`);
    console.log(`  License：${entry.license}`);
    console.log(`  产物：${artifactSummary(entry.code)}   重新生成：${entry.cli}\n`);
  }
}

function cmdStatus(): void {
  const active = activeSource();
  const loaded = loadSource(active);
  console.log(`当前数据源：${active}（${loaded.entry.title}）`);
  console.log(`描述：${loaded.entry.description}`);
  console.log(`时间：${loaded.entry.temporal}`);
  console.log(`License：${loaded.entry.license}`);
  console.log(`产物：regions=${featureCount(loaded.regions)} places=${featureCount(loaded.places)} lines=${featureCount(loaded.lines)}`);
  if (loaded.manifest) {
    const v = loaded.manifest.validation;
    console.log(`校验：${v.map((r) => `${r.file.split('/').pop()} ${r.passed}/${r.total}`).join('，') || '（无报告）'}`);
    console.log(`覆盖：${loaded.manifest.coverage_note}`);
  } else {
    console.log('校验：manifest.json 缺失');
  }
  if (loaded.missing.length > 0) {
    console.log(`缺失产物：${loaded.missing.join('，')}（运行 ${loaded.entry.cli} 生成）`);
  }
}

function cmdCompare(): void {
  console.log('三源对比：\n');
  const header = `${pad('源', 6)}${pad('要素数（regions/places/lines）', 34)}${pad('bounds（regions）', 30)}license`;
  console.log(header);
  console.log('-'.repeat(header.length + 12));
  for (const s of SOURCES) {
    let counts = '—';
    let bounds = '—';
    let license = REGISTRY[s].license;
    try {
      const loaded = loadSource(s);
      counts = `${featureCount(loaded.regions)} / ${featureCount(loaded.places)} / ${featureCount(loaded.lines)}`;
      const rv = loaded.manifest?.validation.find((r) => r.file.endsWith('regions.geojson'));
      bounds = fmtBounds(rv?.bounds ?? null);
      if (loaded.manifest?.license) license = loaded.manifest.license;
    } catch {
      counts = '（未生成）';
    }
    console.log(`${pad(s, 6)}${pad(counts, 34)}${pad(bounds, 30)}${license}`);
  }
  console.log('\n详细对比与选源建议见 docs/data-sources.md');
}

function cmdCheck(): void {
  let bad = 0;
  for (const s of SOURCES) {
    try {
      const loaded = loadSource(s);
      const problems: string[] = [];
      if (loaded.missing.length > 0) problems.push(`缺产物: ${loaded.missing.join('，')}`);
      // manifest 与实际要素数一致性
      for (const f of loaded.manifest?.files ?? []) {
        const name = f.path.split('/').pop();
        const actual =
          name === 'regions.geojson' ? featureCount(loaded.regions) : name === 'places.geojson' ? featureCount(loaded.places) : null;
        if (actual !== null && actual !== f.features) {
          problems.push(`manifest 与实际不一致: ${name} 记录 ${f.features} 实际 ${actual}（重跑 ${loaded.entry.cli}）`);
        }
      }
      if (problems.length === 0) {
        console.log(`✓ ${pad(s, 6)} 一致`);
      } else {
        bad++;
        console.log(`✗ ${pad(s, 6)} ${problems.join('；')}`);
      }
    } catch (err) {
      bad++;
      console.log(`✗ ${pad(s, 6)} ${(err as Error).message}`);
    }
  }
  process.exitCode = bad > 0 ? 1 : 0;
}

// ---- 入口 ----

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case undefined:
  case 'list':
    cmdList();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'compare':
    cmdCompare();
    break;
  case 'check':
    cmdCheck();
    break;
  case 'use': {
    if (!arg || !SOURCES.includes(arg as SourceCode)) {
      console.error(`用法：npm run data -- use <${SOURCES.join('|')}>`);
      process.exitCode = 1;
      break;
    }
    useSource(arg as SourceCode);
    console.log(`已切换当前数据源 -> ${arg}（atlas.config.json）`);
    cmdStatus();
    break;
  }
  default:
    console.error(`未知子命令：${cmd}\n可用：list | status | compare | check | use <source>`);
    process.exitCode = 1;
}
