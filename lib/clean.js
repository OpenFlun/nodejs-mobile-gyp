import gracefulFs from 'graceful-fs';
import * as log from './log.js';

/**
 * 清理:删除 build 目录
 * >查看定义:@see {@link clean}
 * @param {object} gyp gyp 实例
 * @param {string[]} argv 命令行参数
 * @returns {Promise<void>}
 */
const clean = async (gyp, argv) => {
  const buildDir = 'build';

  log.verbose('清理', '正在删除 "%s" 目录', buildDir);
  await gracefulFs.promises.rm(buildDir, { recursive: true, force: true });
};

clean.usage = '删除生成的构建文件与 "out" 目录';
export { clean };