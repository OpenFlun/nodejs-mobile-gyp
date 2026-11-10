import gracefulFs from 'graceful-fs';
import * as log from './log.js';

const fs = gracefulFs.promises;
/**
 * 列出当前项目的编译配置
 * >查看定义:@see {@link list}
 * @param {*} gyp
 * @param {*} args
 * @returns {*}
 */
const list = async (gyp, args) => {
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
};

export { list };