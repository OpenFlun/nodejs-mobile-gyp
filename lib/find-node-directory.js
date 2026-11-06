import path from 'path';
import { fileURLToPath } from 'url';
import * as log from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url)),
  /**
   * 从脚本位置或进程对象推断 Node 根目录
   */
  findNodeDirectory = (scriptLocation, processObj) => {
    // 未传入时使用默认值,便于回归测试
    if (scriptLocation === undefined) scriptLocation = __dirname;
    if (processObj === undefined) processObj = process;

    // 看看上层目录结构,判断当前所处位置
    const npmParentDirectory = path.join(scriptLocation, '../../../..');
    log.verbose('nodejs-mobile-gyp 根目录', 'npm 上级目录为 ' + path.basename(npmParentDirectory));
    log.verbose('nodejs-mobile-gyp 根目录', '正在查找 node 根目录');
    let nodeRootDir = '';
    if (path.basename(npmParentDirectory) === 'deps') {
      // 处于构建目录中,脚本位于 deps/npm/node_modules/node-gyp/lib
      nodeRootDir = path.join(npmParentDirectory, '..');
      log.verbose('nodejs-mobile-gyp 根目录', '在构建目录中,根目录 = ' + nodeRootDir);
    } else if (path.basename(npmParentDirectory) === 'node_modules') {
      // 处于 Node 安装目录中,脚本位于
      // lib/node_modules/npm/node_modules/node-gyp/lib 或
      // node_modules/npm/node_modules/node-gyp/lib(视平台而定)
      if (processObj.platform === 'win32') nodeRootDir = path.join(npmParentDirectory, '..');
      else nodeRootDir = path.join(npmParentDirectory, '../..');
      log.verbose('nodejs-mobile-gyp 根目录', '在安装目录中,根目录 = ' + nodeRootDir);
    } else {
      // 无法判断,尝试从 node 可执行文件的位置推断
      const nodeDir = path.dirname(processObj.execPath), directoryUp = path.basename(nodeDir);
      if (directoryUp === 'bin') nodeRootDir = path.join(nodeDir, '..');
      else if (directoryUp === 'Release' || directoryUp === 'Debug') {
        // 如果是刚构建的 node,且目录结构为仓库结构:
        // Windows 只需上一层,其余平台两层
        if (processObj.platform === 'win32') nodeRootDir = path.join(nodeDir, '..');
        else nodeRootDir = path.join(nodeDir, '../..');
      }
      // 否则返回默认空串 ""
    }
    return nodeRootDir;
  }

export { findNodeDirectory }