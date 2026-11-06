import gracefulFs from 'graceful-fs';
import path from 'path';
import * as log from './log.js';
import semver from 'semver';

const fs = gracefulFs.promises,
  /**
   * 删除指定版本的 Node 开发文件
   */
  remove = async (gyp, argv) => {
    const devDir = gyp.devDir;
    log.verbose('移除', '使用 node-gyp 目录:', devDir);

    // 获取用户指定的版本号
    let version = argv[0] || gyp.opts.target;
    log.verbose('移除', '正在移除目标版本:', version);
    if (!version) throw new Error('必须指定要删除的版本号,例如: "' + process.version + '"');

    const versionSemver = semver.parse(version);
    if (versionSemver) version = versionSemver.version; // 把版本数组拍平为字符串

    const versionPath = path.resolve(gyp.devDir, version);
    log.verbose('移除', '正在移除该版本的开发文件:', version);

    // 先检查是否安装过
    try {
      await fs.stat(versionPath);
    } catch (err) {
      if (err.code === 'ENOENT') return '该版本已卸载: ' + version;
      throw err;
    }

    await fs.rm(versionPath, { recursive: true, force: true });
  }

remove.usage = '移除指定版本的 node 开发文件';
export { remove }