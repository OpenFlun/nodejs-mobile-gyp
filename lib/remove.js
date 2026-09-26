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
    log.verbose('remove', 'using node-gyp dir:', devDir);

    // 获取用户指定的版本号
    let version = argv[0] || gyp.opts.target;
    log.verbose('remove', 'removing target version:', version);
    if (!version) throw new Error('必须指定要删除的版本号，例如: "' + process.version + '"');

    const versionSemver = semver.parse(version);
    if (versionSemver) version = versionSemver.version; // 把版本数组拍平为字符串

    const versionPath = path.resolve(gyp.devDir, version);
    log.verbose('remove', 'removing development files for version:', version);

    // 先检查是否安装过
    try {
      await fs.stat(versionPath);
    } catch (err) {
      if (err.code === 'ENOENT') return 'version was already uninstalled: ' + version;
      throw err;
    }

    await fs.rm(versionPath, { recursive: true, force: true });
  }

remove.usage = 'Removes the node development files for the specified version';
export { remove }
