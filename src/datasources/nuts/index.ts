// ============================================================
// NUTS loader · CLI 入口
//   npx tsx src/datasources/nuts/index.ts download [--force]
//   npx tsx src/datasources/nuts/index.ts normalize
//   npx tsx src/datasources/nuts/index.ts validate
//   npx tsx src/datasources/nuts/index.ts all        (= npm run nuts)
// 全部幂等：download 跳过已存在文件（--force 重下）；
// normalize / validate 每次全量重写 processed 产物。
// ============================================================

import { runDownload } from './download';
import { runNormalize } from './normalize';
import { runValidate } from './validate';

async function main(): Promise<void> {
  const [cmd = 'all', ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');

  switch (cmd) {
    case 'download':
      await runDownload(force);
      break;
    case 'normalize':
      await runNormalize();
      break;
    case 'validate':
      await runValidate();
      break;
    case 'all':
      await runDownload(force);
      await runNormalize();
      await runValidate();
      break;
    default:
      console.error(`未知子命令: ${cmd}（可用: download | normalize | validate | all [--force]）`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
