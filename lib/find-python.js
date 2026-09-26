import * as log from './log.js';
import semver from 'semver';
import { execFile } from './util.js';
import os from 'os';

const win = process.platform === 'win32',
  /**
   * 获取当前操作系统用户名（失败时返回 undefined）
   */
  getOsUserInfo = () => {
    try { return os.userInfo().username } catch { }
  },
  systemDrive = process.env.SystemDrive || 'C:', username = process.env.USERNAME || process.env.USER || getOsUserInfo(),
  localAppData = process.env.LOCALAPPDATA || `${systemDrive}\\${username}\\AppData\\Local`,
  foundLocalAppData = process.env.LOCALAPPDATA || username,
  programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || `${systemDrive}\\Program Files`,
  programFilesX86 = process.env['ProgramFiles(x86)'] || `${programFiles} (x86)`, winDefaultLocationsArray = [];

for (const majorMinor of ['311', '310', '39', '38']) {
  if (foundLocalAppData) {
    winDefaultLocationsArray.push(
      `${localAppData}\\Programs\\Python\\Python${majorMinor}\\python.exe`,
      `${programFiles}\\Python${majorMinor}\\python.exe`,
      `${localAppData}\\Programs\\Python\\Python${majorMinor}-32\\python.exe`,
      `${programFiles}\\Python${majorMinor}-32\\python.exe`,
      `${programFilesX86}\\Python${majorMinor}-32\\python.exe`
    );
  } else {
    winDefaultLocationsArray.push(
      `${programFiles}\\Python${majorMinor}\\python.exe`,
      `${programFiles}\\Python${majorMinor}-32\\python.exe`,
      `${programFilesX86}\\Python${majorMinor}-32\\python.exe`
    );
  }
}

/**
 * Python 查找器：按顺序尝试多种途径定位可用的 Python 3.6+
 */
class PythonFinder {
  static findPython = (...args) => new PythonFinder(...args).findPython();

  log = log.withPrefix('find Python');
  argsExecutable = ['-c', 'import sys; print(sys.executable);'];
  argsVersion = ['-c', 'import sys; print("%s.%s.%s" % sys.version_info[:3]);'];
  semverRange = '>=3.6.0';

  // 以下可在测试时覆盖：
  execFile = execFile;
  env = process.env;
  win = win;
  pyLauncher = 'py.exe';
  winDefaultLocations = winDefaultLocationsArray;

  constructor(configPython) {
    this.configPython = configPython, this.errorLog = [];
  }

  // 以 verbose 级别记录日志，同时保存下来，出错时以 error 级别展示，便于诊断
  addLog(message) {
    this.log.verbose(message), this.errorLog.push(message);
  }

  // 依次尝试多种 Python 定位方式。忽略错误，直到找到可用版本
  async findPython() {
    const SKIP = 0, FAIL = 1,
      toCheck = (() => {
        if (this.env.NODE_GYP_FORCE_PYTHON) {
          return [{
            before: () => {
              this.addLog('checking Python explicitly set from NODE_GYP_FORCE_PYTHON');
              this.addLog('- process.env.NODE_GYP_FORCE_PYTHON is ' + `"${this.env.NODE_GYP_FORCE_PYTHON}"`);
            }, check: () => this.checkCommand(this.env.NODE_GYP_FORCE_PYTHON)
          }]
        }
        const checks = [
          {
            before: () => {
              if (!this.configPython) {
                this.addLog('Python is not set from command line or npm configuration');
                return SKIP;
              }
              this.addLog('checking Python explicitly set from command line or ' + 'npm configuration')
              this.addLog('- "--python=" or "npm config get python" is ' + `"${this.configPython}"`)
            }, check: () => this.checkCommand(this.configPython)
          },
          {
            before: () => {
              if (!this.env.PYTHON) {
                this.addLog('Python is not set from environment variable ' + 'PYTHON');
                return SKIP;
              }
              this.addLog('checking Python explicitly set from environment ' + 'variable PYTHON');
              this.addLog(`- process.env.PYTHON is "${this.env.PYTHON}"`);
            },
            check: () => this.checkCommand(this.env.PYTHON)
          }
        ];

        if (this.win) {
          checks.push({
            before: () => {
              this.addLog('checking if the py launcher can be used to find Python 3');
            }, check: () => this.checkPyLauncher()
          })
        }

        checks.push(...[
          {
            before: () => { this.addLog('checking if "python3" can be used') },
            check: () => this.checkCommand('python3')
          },
          {
            before: () => { this.addLog('checking if "python" can be used') },
            check: () => this.checkCommand('python')
          }
        ])

        if (this.win) {
          for (let i = 0; i < this.winDefaultLocations.length; ++i) {
            const location = this.winDefaultLocations[i];
            checks.push({
              before: () => this.addLog(`checking if Python is ${location}`),
              check: () => this.checkExecPath(location)
            })
          }
        }

        return checks;
      })();

    for (const check of toCheck) {
      const before = check.before()
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

  // 检查命令是否为可用的 Python。成功则返回结果。
  // Windows 下需在 CMD shell 中运行以支持 BAT/CMD 启动器。
  async checkCommand(command) {
    let exec = command, args = this.argsExecutable, shell = false;
    // 参数需手动加引号
    if (this.win) exec = `"${exec}"`, args = args.map(a => `"${a}"`), shell = true;

    this.log.verbose(`- executing "${command}" to get executable path`);
    // 可能结果：
    // - 报错：不在 PATH、不可执行或执行失败
    // - 乱码：后续版本检查会失败
    // - 可执行文件的绝对路径
    try {
      const execPath = await this.run(exec, args, shell);
      this.addLog(`- executable path is "${execPath}"`);
      return this.checkExecPath(execPath)
    } catch (err) {
      this.addLog(`- "${command}" is not in PATH or produced an error`);
      throw err;
    }
  }

  // 检查 py 启动器是否能找到可用的 Python。成功则返回结果。
  // Windows 上的 Python 发行版默认安装 "py.exe" 启动器，比 python.exe 出现在 PATH 更常见。
  // 因为 py 启动器同时支持 Python 2 和 3，这里显式请求 Python 3：用 "-3" 作为首个参数。
  // 由于 "py.exe -3" 对 execFile 来说不是合法可执行文件，需要用启动器找出真正的 python.exe 路径。
  async checkPyLauncher() {
    this.log.verbose(`- executing "${this.pyLauncher}" to get Python 3 executable path`)
    // 可能结果：与 checkCommand 相同
    try {
      const execPath = await this.run(this.pyLauncher, ['-3', ...this.argsExecutable], false);
      this.addLog(`- executable path is "${execPath}"`);
      return this.checkExecPath(execPath);
    } catch (err) {
      this.addLog(`- "${this.pyLauncher}" is not in PATH or produced an error`);
      throw err;
    }
  }

  // 检查某个 Python 可执行文件版本是否可用。成功则返回结果。
  async checkExecPath(execPath) {
    this.log.verbose(`- executing "${execPath}" to get version`)
    // 可能结果：
    // - 报错：可执行文件无法运行（多半上一步输出了乱码）
    // - 乱码：上一步不知为何输出了可执行文件路径，验证版本时会失败
    // - Python 可执行文件的版本号
    try {
      const version = await this.run(execPath, this.argsVersion, false);
      this.addLog(`- version is "${version}"`);

      const range = new semver.Range(this.semverRange);
      let valid = false;
      try {
        valid = range.test(version);
      } catch (err) {
        this.log.silly('range.test() threw:\n%s', err.stack);
        this.addLog(`- "${execPath}" does not have a valid version`);
        this.addLog('- is it a Python executable?');
        throw err;
      }
      if (!valid) {
        this.addLog(`- version is ${version} - should be ${this.semverRange}`);
        this.addLog('- THIS VERSION OF PYTHON IS NOT SUPPORTED');
        throw new Error(`Found unsupported Python version ${version}`);
      }
      return this.succeed(execPath, version);
    } catch (err) {
      this.addLog(`- "${execPath}" could not be run`);
      throw err;
    }
  }

  // 运行可执行文件或 shell 命令，并去除输出两端空白
  async run(exec, args, shell) {
    const env = Object.assign({}, this.env), opts = { env, shell };

    env.TERM = 'dumb';
    this.log.silly('execFile: exec = %j', exec);
    this.log.silly('execFile: args = %j', args);
    this.log.silly('execFile: opts = %j', opts);
    try {
      const [err, stdout, stderr] = await this.execFile(exec, args, opts)
      this.log.silly('execFile result: err = %j', (err && err.stack) || err);
      this.log.silly('execFile result: stdout = %j', stdout);
      this.log.silly('execFile result: stderr = %j', stderr);
      return stdout.trim();
    } catch (err) {
      this.log.silly('execFile: threw:\n%s', err.stack);
      throw err;
    }
  }

  succeed(execPath, version) {
    this.log.info(`using Python version ${version} found at "${execPath}"`);
    return execPath;
  }

  fail() {
    const errorLog = this.errorLog.join('\n'),
      pathExample = this.win ? 'C:\\Path\\To\\python.exe' : '/path/to/pythonexecutable',
      // Windows 80 列控制台，用到 X 标记列之前（含日志前缀共 79 字符，可用 58 字符）
      info = [
        '**********************************************************',
        'You need to install the latest version of Python.',
        'Node-gyp should be able to find and use Python. If not,',
        'you can try one of the following options:',
        `- Use the switch --python="${pathExample}"`,
        '  (accepted by both node-gyp and npm)',
        '- Set the environment variable PYTHON',
        '- Set the npm configuration variable python:',
        `  npm config set python "${pathExample}"`,
        'For more information consult the documentation at:',
        'https://github.com/nodejs/node-gyp#installation',
        '**********************************************************'
      ].join('\n');

    this.log.error(`\n${errorLog}\n\n${info}\n`);
    throw new Error('未找到可用的 Python 安装');
  }
}

export { PythonFinder }