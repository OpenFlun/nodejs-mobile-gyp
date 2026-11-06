import gracefulFs from 'graceful-fs';
import * as log from './log.js';

const fs = gracefulFs.promises,
  /**
   * 清理:删除 build 目录
   */
  clean = async (gyp, argv) => {
    const buildDir = 'build';

    log.verbose('清理', '正在删除 "%s" 目录', buildDir);
    await fs.rm(buildDir, { recursive: true, force: true });
  }

clean.usage = '删除生成的构建文件与 "out" 目录';
export { clean };