import fs from 'fs';
import os from 'os';
import semver from 'semver';
import * as log from './log.js';
import { execFile } from './util.js';

const win = process.platform === 'win32',
  /**
   * 获取当前操作系统用户名(失败时返回 undefined)
   */
  getOsUserInfo = () => {
    try { return os.userInfo().username } catch { }
  },
  systemDrive = process.env.SystemDrive || 'C:',
  username = process.env.USERNAME || process.env.USER || getOsUserInfo(),
  localAppData = process.env.LOCALAPPDATA || `${systemDrive}\\${username}\\AppData\\Local`,
  foundLocalAppData = process.env.LOCALAPPDATA || username,
  programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || `${systemDrive}\\Program Files`,
  programFilesX86 = process.env['ProgramFiles(x86)'] || `${programFiles} (x86)`,
  systemRoot = process.env.SystemRoot || `${systemDrive}\\Windows`,
  /**
   * 动态扫描 Windows 上所有已安装的 Python,不硬编码版本号;
   * 官方安装器目录命名:3.14 -> Python314,3.9 -> Python39,32 位加 -32 后缀;
   */
  scanWindowsPythonLocations = () => {
    const results = [], bases = [foundLocalAppData ? `${localAppData}\\Programs\\Python` : null, `${programFiles}\\Python`,
    `${programFilesX86}\\Python`].filter(Boolean), seen = new Set();

    for (const base of bases) {
      if (seen.has(base)) continue;
      seen.add(base);
      let entries;
      try { entries = fs.readdirSync(base); } catch { continue; }
      for (const name of entries) {
        if (!/^Python\d+/i.test(name)) continue;
        const exe = `${base}\\${name}\\python.exe`;
        try { if (fs.statSync(exe).isFile()) results.push(exe); } catch { }
      }
    }
    return results;
  },
  /**
   * py.exe 启动器候选:先试 PATH 中的,再试常见绝对路径,
   * 避免 Gradle / CI 环境下 PATH 不含 C:\Windows 的情况;
   */
  pyLauncherCandidates = win ? ['py.exe', `${systemRoot}\\py.exe`, `${systemRoot}\\System32\\py.exe`] : [];

/**
 * Python 查找器:按顺序尝试多种途径定位可用的 Python 3.6+
 * >查看定义:@see {@link PythonFinder}
 */
class PythonFinder {
  static findPython = (...args) => new PythonFinder(...args).findPython();

  log = log.withPrefix('查找 Python');
  argsExecutable = ['-c', 'import sys; print(sys.executable);'];
  argsVersion = ['-c', 'import sys; print("%s.%s.%s" % sys.version_info[:3]);'];
  semverRange = '>=3.6.0';

  execFile = execFile;
  env = process.env;
  win = win;
  pyLauncher = 'py.exe';
  winDefaultLocations = win ? scanWindowsPythonLocations() : [];

  constructor(configPython) { this.configPython = configPython, this.errorLog = []; }

  // 以 verbose 级别记录日志,同时保存下来,出错时以 error 级别展示,便于诊断
  addLog(message) { this.log.verbose(message), this.errorLog.push(message); }
  // 依次尝试多种 Python 定位方式;忽略错误,直到找到可用版本
  async findPython() {
    const SKIP = 0, FAIL = 1,
      toCheck = (() => {
        if (this.env.NODE_GYP_FORCE_PYTHON) {
          return [{
            before: () => {
              this.addLog('检查是否通过 NODE_GYP_FORCE_PYTHON 显式指定 Python');
              this.addLog('- process.env.NODE_GYP_FORCE_PYTHON 为 ' + `"${this.env.NODE_GYP_FORCE_PYTHON}"`);
            }, check: () => this.checkCommand(this.env.NODE_GYP_FORCE_PYTHON)
          }];
        }
        const checks = [
          {
            before: () => {
              if (!this.configPython) {
                this.addLog('未从命令行或 npm 配置指定 Python');
                return SKIP;
              }
              this.addLog('检查是否从命令行或 npm 配置显式指定 Python');
              this.addLog('- "--python=" 或 "npm config get python" 的值为 ' + `"${this.configPython}"`);
            }, check: () => this.checkCommand(this.configPython)
          },
          {
            before: () => {
              if (!this.env.PYTHON) {
                this.addLog('未从环境变量 PYTHON 指定 Python');
                return SKIP;
              }
              this.addLog('检查是否从环境变量 PYTHON 显式指定 Python');
              this.addLog(`- process.env.PYTHON 为 "${this.env.PYTHON}"`);
            }, check: () => this.checkCommand(this.env.PYTHON)
          }
        ];

        if (this.win) {
          for (const launcher of pyLauncherCandidates) {
            checks.push({
              before: () => this.addLog(`检查能否用 "${launcher}" 查找 Python 3`),
              check: () => this.checkPyLauncher(launcher)
            });
          }
          checks.push({ before: () => this.addLog('通过 "py -0p" 枚举已安装的 Python'), check: () => this.checkPyList() });
        }

        checks.push(...[
          { before: () => { this.addLog('检查能否使用 "python3"'); }, check: () => this.checkCommand('python3') },
          { before: () => { this.addLog('检查能否使用 "python"'); }, check: () => this.checkCommand('python') }
        ]);

        if (this.win) {
          for (let i = 0; i < this.winDefaultLocations.length; ++i) {
            const location = this.winDefaultLocations[i];
            checks.push({
              before: () => this.addLog(`检查 Python 是否位于 ${location}`), check: () => this.checkExecPath(location)
            });
          }
        }

        return checks;
      })();

    for (const check of toCheck) {
      const before = check.before();
      if (before === SKIP) continue;
      if (before === FAIL) return this.fail();
      try {
        return await check.check();
      } catch (err) {
        this.log.silly('runChecks: err = %j', (err && err.stack) || err);
      }
    }

    return this.fail();
  }

  // 检查命令是否为可用的 Python;
  async checkCommand(command) {
    this.log.verbose(`- 执行 "${command}" 以获取可执行文件路径`);
    try {
      const execPath = await this.run(command, this.argsExecutable, false);
      this.addLog(`- 可执行文件路径为 "${execPath}"`);
      return this.checkExecPath(execPath);
    } catch (err) {
      this.addLog(`- "${command}" 不在 PATH 中或执行出错`);
      throw err;
    }
  }

  // 检查指定 py 启动器是否能找到 Python 3;
  async checkPyLauncher(launcher = this.pyLauncher) {
    this.log.verbose(`- 执行 "${launcher}" 以获取 Python 3 可执行文件路径`);
    try {
      const execPath = await this.run(launcher, ['-3', ...this.argsExecutable], false);
      this.addLog(`- 可执行文件路径为 "${execPath}"`);
      return this.checkExecPath(execPath);
    } catch (err) {
      this.addLog(`- "${launcher}" 不在 PATH 中或执行出错`);
      throw err;
    }
  }

  // 通过 "py -0p" 枚举所有已注册的 Python,覆盖非标准安装位置;
  async checkPyList() {
    this.log.verbose('- 执行 "py -0p" 以列出已注册的 Python');
    let lastErr;
    for (const launcher of pyLauncherCandidates) {
      try {
        const stdout = await this.run(launcher, ['-0p'], false), paths = [];
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.match(/([A-Za-z]:\\[^\s]+)/);
          if (m && /python\.exe$/i.test(m[1])) paths.push(m[1]);
        }
        this.addLog(`- "py -0p" (via ${launcher}) 找到 ${paths.length} 个路径`);
        for (const p of paths) {
          try {
            return await this.checkExecPath(p);
          } catch (err) {
            lastErr = err, this.log.silly('checkPyList: 跳过 %s: %s', p, err.message);
          }
        }
      } catch (err) {
        lastErr = err, this.addLog(`- 经 "${launcher}" 执行 "py -0p" 失败`);
      }
    }
    throw lastErr || new Error('py -0p 未返回可用的 Python');
  }

  // 检查某个 Python 可执行文件版本是否可用;
  async checkExecPath(execPath) {
    this.log.verbose(`- 执行 "${execPath}" 以获取版本`);
    try {
      const version = await this.run(execPath, this.argsVersion, false);
      this.addLog(`- 版本为 "${version}"`);

      const range = new semver.Range(this.semverRange);
      let valid = false;
      try {
        valid = range.test(version);
      } catch (err) {
        this.log.silly('range.test() threw:\n%s', err.stack);
        this.addLog(`- "${execPath}" 的版本无效`), this.addLog('- 它是不是 Python 可执行文件?');
        throw err;
      }
      if (!valid) {
        this.addLog(`- 版本为 ${version},应为 ${this.semverRange}`), this.addLog('- 此版本的 Python 不受支持');
        throw new Error(`不支持的 Python 版本 ${version}`);
      }
      return this.succeed(execPath, version);
    } catch (err) {
      this.addLog(`- "${execPath}" 无法运行`);
      throw err;
    }
  }

  // 执行外部命令;execFile 包装不 reject,通过 [err, stdout, stderr] 返回结果,
  // 必须显式检查 err,否则失败会被当成"成功但空输出",掩盖真实原因;
  async run(exec, args, shell) {
    const env = Object.assign({}, this.env), opts = { env, shell };
    env.TERM = 'dumb';
    this.log.silly('execFile: exec = %j', exec);
    this.log.silly('execFile: args = %j', args);
    this.log.silly('execFile: opts = %j', opts);
    const [err, stdout, stderr] = await this.execFile(exec, args, opts);
    this.log.silly('execFile 结果: 错误 = %j', (err && err.stack) || err);
    this.log.silly('execFile 结果: 标准输出 = %j', stdout);
    this.log.silly('execFile 结果: 标准错误 = %j', stderr);
    if (err) throw err;
    return stdout.trim();
  }

  succeed(execPath, version) {
    this.log.info(`using Python version ${version} found at "${execPath}"`);
    return execPath;
  }

  fail() {
    const errorLog = this.errorLog.join('\n'),
      pathExample = this.win ? 'C:\\Path\\To\\python.exe' : '/path/to/pythonexecutable',
      info = [
        '**********************************************************',
        '需要安装最新版本的 Python;',
        '应能自动找到并使用 Python;若找不到,',
        '可尝试以下任一方式:',
        `- 使用 --python="${pathExample}" 开关`,
        '  (npm 与本包均接受该参数)',
        '- 设置环境变量 PYTHON',
        '- 设置 npm 配置项 python:',
        `  npm config set python "${pathExample}"`,
        '更多说明见文档:',
        'https://github.com/nodejs/node-gyp#installation',
        '**********************************************************'
      ].join('\n');

    this.log.error(`\n${errorLog}\n\n${info}\n`);
    throw new Error('未找到可用的 Python 安装');
  }
}

export { PythonFinder };