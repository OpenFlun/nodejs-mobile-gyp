import cp from 'child_process';
import path from 'path';
import gracefulFs from 'graceful-fs';
import * as log from './log.js';

const { openSync, closeSync } = gracefulFs,
  /**
   * 执行外部命令并返回 [err, stdout, stderr]
   */
  execFile = async (...args) => new Promise(resolve => {
    const child = cp.execFile(...args, (...a) => resolve(a));
    child.stdin.end();
  }),
  /**
   * 读取 Windows 注册表指定键的值
   */
  regGetValue = async (key, value, addOpts) => {
    const outReValue = value.replace(/\W/g, '.'), outRe = new RegExp(`^\\s+${outReValue}\\s+REG_\\w+\\s+(\\S.*)$`, 'im'),
      reg = path.join(process.env.SystemRoot, 'System32', 'reg.exe'), regArgs = ['query', key, '/v', value].concat(addOpts);

    log.silly('reg', 'running', reg, regArgs);
    const [err, stdout, stderr] = await execFile(reg, regArgs, { encoding: 'utf8' });

    log.silly('reg', 'reg.exe stdout = %j', stdout);
    if (err || stderr.trim() !== '') {
      log.silly('reg', 'reg.exe err = %j', err && (err.stack || err));
      log.silly('reg', 'reg.exe stderr = %j', stderr);
      if (err) throw err;
      throw new Error(stderr);
    }

    const result = outRe.exec(stdout)
    if (!result) {
      log.silly('reg', 'error parsing stdout');
      throw new Error('无法解析 reg.exe 的输出');
    }

    log.silly('reg', 'found: %j', result[1]);
    return result[1];
  },
  /**
   * 依次搜索多个注册表键，返回第一个可读的值
   */
  regSearchKeys = async (keys, value, addOpts) => {
    for (const key of keys) {
      try {
        return await regGetValue(key, value, addOpts);
      } catch { continue }
    }
  },
  /**
   * 返回候选列表中第一个当前用户可读的文件或目录，都不存在则返回 undefined
   */
  findAccessibleSync = (logprefix, dir, candidates) => {
    for (let next = 0; next < candidates.length; next++) {
      const candidate = path.resolve(dir, candidates[next]);
      let fd;
      try {
        fd = openSync(candidate, 'r');
      } catch (e) {
        // 该候选文件不存在或不可读，继续检查下一个
        log.silly(logprefix, 'Could not open %s: %s', candidate, e.message);
        continue;
      }
      closeSync(fd), log.silly(logprefix, 'Found readable %s', candidate);
      return candidate;
    }

    return undefined;
  }

export { execFile, regGetValue, regSearchKeys, findAccessibleSync }