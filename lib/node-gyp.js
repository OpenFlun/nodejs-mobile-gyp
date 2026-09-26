import path from 'path';
import nopt from 'nopt';
import * as log from './log.js';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import { build } from './build.js';
import { clean } from './clean.js';
import { configure } from './configure.js';
import { rebuild } from './rebuild.js';
import { install } from './install.js';
import { list } from './list.js';
import { remove } from './remove.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url)),
  // 命令名到实现函数的静态映射（ESM 不支持动态 require）
  commandModules = { build, clean, configure, rebuild, install, list, remove }, commands = Object.keys(commandModules);

/**
 * node-gyp 主类：解析参数、分发命令、生成 usage
 */
class Gyp extends EventEmitter {
  /**
   * 导出 package.json 内容
   */
  package = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))

  /**
   * nopt 配置定义
   */
  configDefs = {
    help: Boolean, // 各处
    arch: String, // 'configure'
    cafile: String, // 'install'
    debug: Boolean, // 'build'
    directory: String, // bin
    make: String, // 'build'
    'msvs-version': String, // 'configure'
    ensure: Boolean, // 'install'
    solution: String, // 'build'（仅 Windows）
    proxy: String, // 'install'
    noproxy: String, // 'install'
    devdir: String, // 各处
    nodedir: String, // 'configure'
    loglevel: String, // 各处
    python: String, // 'configure'
    'dist-url': String, // 'install'
    tarball: String, // 'install'
    jobs: String, // 'build'
    thin: String, // 'configure'
    'force-process-config': Boolean // 'configure'
  }

  /**
   * nopt 简写
   */
  shorthands = {
    release: '--no-debug',
    C: '--directory',
    debug: '--debug',
    j: '--jobs',
    silly: '--loglevel=silly',
    verbose: '--loglevel=verbose',
    silent: '--loglevel=silent'
  }

  /**
   * 暴露命令别名供 bin 文件使用
   */
  aliases = { ls: 'list', rm: 'remove' }
  constructor(...args) {
    super(...args), this.devDir = '';
    this.commands = commands.reduce((acc, command) => {
      acc[command] = (argv) => commandModules[command](this, argv);
      return acc;
    }, {})

    Object.defineProperty(this, 'version', {
      enumerable: true, get() { return this.package.version }
    })
  }

  /**
   * 解析传入的 argv 数组，设置 'opts'、'argv' 和 'command' 属性
   */
  parseArgv(argv) {
    this.opts = nopt(this.configDefs, this.shorthands, argv), this.argv = this.opts.argv.remain.slice();

    const commands = this.todo = [];
    // 创建一份把别名映射后的 argv 副本
    argv = this.argv.map(arg => {
      // 如果当前参数是命令别名（如 ls/rm）,就替换成真实命令名
      if (arg in this.aliases) arg = this.aliases[arg];
      return arg
    })

    // 把映射后的参数处理成 "command" 对象（name 和 args 属性）
    argv.slice().forEach(arg => {
      if (arg in this.commands) {
        const args = argv.splice(0, argv.indexOf(arg));
        argv.shift();
        if (commands.length > 0) commands[commands.length - 1].args = args;
        commands.push({ name: arg, args: [] });
      }
    })
    if (commands.length > 0) commands[commands.length - 1].args = argv.splice(0);

    // 支持从 npm 继承配置环境变量
    const npmConfigPrefix = 'npm_config_';
    Object.keys(process.env).forEach((name) => {
      if (name.indexOf(npmConfigPrefix) !== 0) return;
      const val = process.env[name];
      if (name === npmConfigPrefix + 'loglevel') log.logger.level = val
      else {
        name = name.substring(npmConfigPrefix.length);  // 把用户定义的选项加入配置
        // gyp@741b7f1 遇到零长度选项会死循环，确保过滤掉
        if (name) {
          // 把 force_process_config 这类名字转成 force-process-config
          if (name.includes('_')) name = name.replace(/_/g, '-');
          this.opts[name] = val;
        }
      }
    })

    if (this.opts.loglevel) log.logger.level = this.opts.loglevel;
    log.resume();
  }

  /**
   * 启动子进程并发出 'spawn' 事件
   */
  spawn(command, args, opts) {
    if (!opts) opts = {};
    if (!opts.silent && !opts.stdio) opts.stdio = [0, 1, 2];
    const cp = childProcess.spawn(command, args, opts);
    log.info('spawn', command), log.info('spawn args', args);
    return cp;
  }

  /**
   * 返回 node-gyp 的用法说明
   */
  usage() {
    return [
      '', '  Usage: node-gyp <command> [options]', '', '  where <command> is one of:',
      commands.map((c) => '    - ' + c + ' - ' + commandModules[c].usage).join('\n'), '',
      'node-gyp@' + this.version + '  ' + path.resolve(__dirname, '..'), 'node@' + process.versions.node
    ].join('\n');
  }
}

const createGyp = () => new Gyp();
export default createGyp;
export { Gyp }