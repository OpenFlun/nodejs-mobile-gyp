import gracefulFs from 'graceful-fs';
import * as log from './log.js';

const fs = gracefulFs.promises,
  /**
   * 列出已安装的 Node 开发文件版本
   */
  list = async (gyp, args) => {
    const devDir = gyp.devDir;
    let versions = [];

    log.verbose('列表', '使用 node-gyp 目录:', devDir);
    try {
      const dir = await fs.readdir(devDir);
      if (Array.isArray(dir)) versions = dir.filter((v) => v !== 'current');
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
    }

    return versions;
  }

list.usage = '列出当前已安装的 node 开发文件';
export { list }