// ============================================================
// DARMC loader CLI
//
//   npm run darmc                      # = all
//   npm run darmc -- download [--force]
//   npm run darmc -- normalize
//   npm run darmc -- validate
//
// all = download -> normalize -> validate（validate 内含 manifest 生成）
// ============================================================

import { download } from './download';
import { normalize } from './normalize';
import { validate } from './validate';

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'all';
  const force = process.argv.includes('--force');

  switch (cmd) {
    case 'download':
      await download(force);
      break;
    case 'normalize':
      await normalize();
      break;
    case 'validate':
      await validate();
      break;
    case 'all':
      await download(force);
      const norm = await normalize();
      await validate(norm);
      break;
    default:
      console.error(`未知子命令: ${cmd}（可用: download | normalize | validate | all）`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
