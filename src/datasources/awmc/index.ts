// ============================================================
// AWMC loader · CLI 入口
// 用法：
//   npm run awmc                          # all（download+normalize+validate）
//   npm run awmc -- download [--force]    # 仅下载
//   npm run awmc -- normalize             # raw -> processed
//   npm run awmc -- validate              # 校验 + 生成 manifest.json
// ============================================================

import { runDownload } from './download';
import { runNormalize } from './normalize';
import { runValidate } from './validate';

const args = process.argv.slice(2);
const force = args.includes('--force');
const cmd = args.find((a) => !a.startsWith('--')) ?? 'all';

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
    console.error(`未知子命令: ${cmd}（可用: download | normalize | validate | all）`);
    process.exit(2);
}
