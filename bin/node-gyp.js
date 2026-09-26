#!/usr/bin/env node

import envPaths from 'env-paths';
import os from 'os';
import fs from 'fs';
import { Gyp } from '../lib/node-gyp.js';
import * as log from '../lib/log.js';

process.title = 'node-gyp';

/**
 * 处理并执行选中的命令。
 */

const prog = new Gyp(), homeDir = os.homedir();
let completed = false;
prog.parseArgv(process.argv), prog.devDir = prog.opts.devdir;

if (prog.devDir) prog.devDir = prog.devDir.replace(/^~/, homeDir);
else if (homeDir) prog.devDir = envPaths('node-gyp', { suffix: '' }).cache;
else {
  throw new Error(
    "node-gyp requires that the user's home directory is specified " +
    'in either of the environmental variables HOME or USERPROFILE. ' +
    'Overide with: --devdir /path/to/.node-gyp');
}

if (prog.todo.length === 0) {
  if (~process.argv.indexOf('-v') || ~process.argv.indexOf('--version')) log.stdout('v%s', prog.version);
  else log.stdout('%s', prog.usage());
  process.exit(0);
}

log.info('it worked if it ends with', 'ok'), log.verbose('cli', process.argv), log.info('using', 'node-gyp@%s', prog.version);
log.info('using', 'node@%s | %s | %s', process.versions.node, process.platform, process.arch);

/**
 * 如果传了 -C/--directory,切换到该目录;
 */
const dir = prog.opts.directory;
if (dir) {
  try {
    const stat = fs.statSync(dir);
    if (stat.isDirectory()) log.info('chdir', dir), process.chdir(dir);
    else log.warn('chdir', dir + ' 不是目录');
  } catch (e) {
    if (e.code === 'ENOENT') log.warn('chdir', dir + ' 不是目录');
    else log.warn('chdir', 'chdir() 出错 "%s"', e.message);
  }
}

/**
 * 打印错误上下文信息
 */
const errorMessage = () => {
  // 复制自 npm 的 lib/utils/error-handler.js
  log.error('System', os.type() + ' ' + os.release());
  log.error('command', process.argv.map(JSON.stringify).join(' ')), log.error('cwd', process.cwd());
  log.error('node -v', process.version), log.error('node-gyp -v', 'v' + prog.package.version);
},
  /**
   * 打印最终诊断信息
   */
  issueMessage = () => {
    errorMessage();
    log.error('', ['node-gyp 构建你的包失败!', '请尝试更新 npm 和/或 node-gyp;若仍无法解决,请向包作者反馈;'].join('\n'));
  },
  /**
   * 依次执行队列中的命令
   */
  run = async () => {
    const command = prog.todo.shift()
    if (!command) {
      // 完成！
      completed = true, log.info('ok');
      return;
    };

    try {
      const args = await prog.commands[command.name](command.args) ?? [];

      if (command.name === 'list') {
        if (args.length) args.forEach((version) => log.stdout(version));
        else log.stdout('尚未安装任何 Node 开发文件;可用 `node-gyp install` 安装指定版本;')
      }
      else if (args.length >= 1) log.stdout(...args.slice(1))
      return run(); // 继续执行队列中的下一条命令
    } catch (err) {
      log.error(command.name + ' error'), log.error('stack', err.stack), errorMessage(), log.error('not ok');
      return process.exit(1);
    }
  };

process.on('exit', code => {
  if (!completed && !code) log.error('完成回调未被调用！'), issueMessage(), process.exit(6);
});
process.on('uncaughtException', err => {
  log.error('未捕获的异常'), log.error('stack', err.stack), issueMessage(), process.exit(7);
});

run(); // 开始执行给定命令！
