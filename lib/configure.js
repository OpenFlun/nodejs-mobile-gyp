import gracefulFs from 'graceful-fs';
import os from 'os';
import path from 'path';
import { format as msgFormat } from 'util';
import { fileURLToPath } from 'url';
import { createConfigGypi } from './create-config-gypi.js';
import { findNodeDirectory } from './find-node-directory.js';
import { PythonFinder } from './find-python.js';
import * as log from './log.js';
import { processRelease } from './process-release.js';
import { findAccessibleSync } from './util.js';

const fs = gracefulFs.promises, win = process.platform === 'win32',
    __dirname = path.dirname(fileURLToPath(import.meta.url));

// 条件加载:仅在 Windows 上需要
let findVisualStudio = null, nodeDir, vsInfo = null;
if (win) {
  const { VisualStudioFinder } = await import('./find-visualstudio.js');
  findVisualStudio = VisualStudioFinder.findVisualStudio;
}

/**
 * 生成构建文件(Makefile / MSVC 工程)
 * >查看定义:@see {@link configure}
 * @param {object} gyp gyp 实例
 * @param {string[]} argv 命令行参数
 * @returns {Promise<void>}
 */
const configure = async (gyp, argv) => {
  const buildDir = path.resolve('build'), configNames = ['config.gypi', 'common.gypi'], configs = [],
    release = processRelease(argv, gyp, process.version, process.release),
    python = await PythonFinder.findPython(gyp.opts.python),
    runGyp = async () => {
      if (!~argv.indexOf('-f') && !~argv.indexOf('--format')) {
        if (win) {
          log.verbose('gyp', '未指定 gyp 格式,强制使用 "msvs"');
          // 非 Windows 强制使用 make 目标
          argv.push('-f', ('format' in gyp.opts) ? gyp.opts.format : 'msvs');
        } else {
          log.verbose('gyp', '未指定 gyp 格式,强制使用 "make"');
          // 非 Windows 强制使用 make 目标
          argv.push('-f', ('format' in gyp.opts) ? gyp.opts.format : 'make');
        }
      }

      configs.forEach(config => argv.push('-I', config)); // 引入所有找到的 .gypi 文件
      // AIX 和 z/OS 需要设置导出文件路径,其中包含链接所需符号
      let nodeExpFile, nodeRootDir, candidates, logprefix = '查找导出文件';
      if (process.platform === 'aix' || process.platform === 'os390' || process.platform === 'os400') {
        const ext = process.platform === 'os390' ? 'x' : 'exp';
        nodeRootDir = findNodeDirectory();

        if (process.platform === 'aix' || process.platform === 'os400')
          candidates = ['include/node/node', 'out/Release/node', 'out/Debug/node', 'node'].map(file => file + '.' + ext);
        else
          candidates = [
            'out/Release/lib.target/libnode', 'out/Debug/lib.target/libnode', 'out/Release/obj.target/libnode',
            'out/Debug/obj.target/libnode', 'lib/libnode'].map(file => file + '.' + ext);

        nodeExpFile = findAccessibleSync(logprefix, nodeRootDir, candidates);
        if (nodeExpFile !== undefined) log.verbose(logprefix, '已找到导出文件: %s', nodeExpFile);
        else {
          const msg = msgFormat('未找到 node.%s 文件,目录: %s', ext, nodeRootDir);
          log.error(logprefix, '未找到导出文件');
          throw new Error(msg);
        }
      }

      // z/OS 需要设置 zoslib 头文件目录,其中包含 v8config.h 引用的头文件
      let zoslibIncDir;
      if (process.platform === 'os390') {
        logprefix = "查找 zoslib 的 zos-base.h:";
        let msg, zoslibIncPath = process.env.ZOSLIB_INCLUDES;
        if (zoslibIncPath) {
          zoslibIncPath = findAccessibleSync(logprefix, zoslibIncPath, ['zos-base.h']);
          if (zoslibIncPath === undefined) {
            msg = msgFormat('在 ZOSLIB_INCLUDES 指定的目录中未找到 zos-base.h 文件: ' +
              '%s; 请将其设为正确路径,或取消设置以便在 ' +
              '%s 中搜索', process.env.ZOSLIB_INCLUDES, nodeRootDir)
          }
        } else {
          candidates = [
            'include/node/zoslib/zos-base.h', 'include/zoslib/zos-base.h', 'zoslib/include/zos-base.h',
            'install/include/node/zoslib/zos-base.h'
          ]
          zoslibIncPath = findAccessibleSync(logprefix, nodeRootDir, candidates);
          if (zoslibIncPath === undefined) {
            msg = msgFormat('未找到 %s 中列出的任意一项(目录: %s); ' +
              '请设置环境变量 ZOSLIB_INCLUDES 指向包含 zos-base.h 的路径',
              candidates.toString(), nodeRootDir);
          }
        }
        if (zoslibIncPath !== undefined) {
          zoslibIncDir = path.dirname(zoslibIncPath);
          log.verbose(logprefix, "在 %s 中找到 zoslib 的 zos-base.h", zoslibIncDir);
        } else if (release.version.split('.')[0] >= 16) {
          // zoslib 只随 Node v16 及以上发布
          log.error(logprefix, msg);
          throw new Error(msg);
        }
      }

      // 这段逻辑移植自旧的 `gyp_addon` Python 文件
      const gypScript = path.resolve(__dirname, '..', 'gyp', 'gyp_main.py'),
        addonGypi = path.resolve(__dirname, '..', 'addon.gypi');
      let commonGypi = path.resolve(nodeDir, 'include/node/common.gypi');
      try {
        await fs.stat(commonGypi);
      } catch (err) {
        commonGypi = path.resolve(nodeDir, 'common.gypi');
      }

      let outputDir = 'build';
      if (win) outputDir = buildDir;  // Windows 需要绝对路径
      const nodeGypDir = path.resolve(__dirname, '..');

      let nodeLibFile = path.join(nodeDir,
          !gyp.opts.nodedir ? '<(target_arch)' : '$(Configuration)', release.name + '.lib');

      argv.push('-I', addonGypi), argv.push('-I', commonGypi), argv.push('-Dlibrary=shared_library');
      argv.push('-Dvisibility=default'), argv.push('-Dnode_root_dir=' + nodeDir);
      if (process.platform === 'aix' || process.platform === 'os390' || process.platform === 'os400') {
        argv.push('-Dnode_exp_file=' + nodeExpFile);
        if (process.platform === 'os390' && zoslibIncDir) argv.push('-Dzoslib_include_dir=' + zoslibIncDir);
      }
      argv.push('-Dnode_gyp_dir=' + nodeGypDir);

      // 这样做是为了让 Cygwin 环境正常工作,否则未转义的 '\' 会被吃掉,
      // 导致路径错误,如 c:parentFolderfolderanotherFolder 而非 c:\parentFolder\folder\anotherFolder
      if (win) nodeLibFile = nodeLibFile.replace(/\\/g, '\\\\');
      argv.push('-Dnode_lib_file=' + nodeLibFile), argv.push('-Dmodule_root_dir=' + process.cwd());
      argv.push('-Dnode_engine=' + (gyp.opts.node_engine || process.jsEngine || 'v8'));
      argv.push('--depth=.'), argv.push('--no-parallel');
      argv.push('--generator-output', outputDir); // 告诉 gyp 把 Makefile/Solution 文件写到 output_dir
      // 使用 find-visualstudio 探测到的实际 toolset(v140/v141/v142/v143/v145...),
      // 不再硬编码,以兼容 VS2013+ 各版本
      if (win) {
        if (vsInfo?.toolset) argv.push('-Gmsvs_toolset=' + vsInfo.toolset);
        else log.warn('gyp', '未能探测到 VS toolset,将使用 gyp 默认值');
      }

      argv.push('-Goutput_dir=.'); // 告诉 make 把输出写到同一目录
      argv.unshift('binding.gyp'); // 强制使用 binding.gyp 文件
      argv.unshift(gypScript);     // 从当前目标 nodedir 执行 `gyp`

      // 确保 python 使用该 node 包自带的文件
      const pypath = [path.join(__dirname, '..', 'gyp', 'pylib')]
      if (process.env.PYTHONPATH) pypath.push(process.env.PYTHONPATH);
      process.env.PYTHONPATH = pypath.join(win ? ';' : ':');

      await new Promise((resolve, reject) => {
        const cp = gyp.spawn(python, argv);
        cp.on('exit', code => {
          if (code !== 0) reject(new Error('`gyp` 执行失败,退出码: ' + code));
          else resolve(); // 完成
        })
      })
    },
    findConfigs = async () => {
      const name = configNames.shift();
      if (!name) return runGyp();

      const fullPath = path.resolve(name);
      log.verbose(name, '正在检查 gypi 文件: %s', fullPath);
      try {
        await fs.stat(fullPath), log.verbose(name, '已找到 gypi 文件'), configs.push(fullPath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err; // ENOENT 时继续检查下一个 gypi 文件名
      }

      return findConfigs();
    },
    createConfigFile = async () => {
      if (win) {
        process.env.GYP_MSVS_VERSION = Math.min(vsInfo.versionYear, 2015);
        process.env.GYP_MSVS_OVERRIDE_PATH = vsInfo.path;
      }
      const configPath = await createConfigGypi({ gyp, buildDir, nodeDir, vsInfo, python });
      configs.push(configPath);
      return findConfigs();
    },
    createBuildDir = async () => {
      log.verbose('build 目录', '正在创建 "build" 目录: %s', buildDir);

      const isNew = await fs.mkdir(buildDir, { recursive: true });
      log.verbose('build 目录', '"build" 目录是否需要创建?', isNew ? '是' : '否');
      vsInfo = win ? await findVisualStudio(release.semver, gyp.opts['msvs-version']) : null;
      return createConfigFile();
    },
    getNodeDir = async () => {
      // 此时 python 已确定
      process.env.PYTHON = python;

      if (gyp.opts.nodedir) {
        // 指定了 --nodedir,用它作为开发文件目录
        nodeDir = gyp.opts.nodedir.replace(/^~/, os.homedir());
        log.verbose('获取 node 目录', '使用指定的 --nodedir 开发文件编译: %s', nodeDir);
      } else {
        // 未指定 --nodedir,先确保 Node 依赖已安装
        if ('v' + release.version !== process.version) {
          // 指定了 --target,确定目标版本
          log.verbose('获取 node 目录', '按 --target 指定的 node 版本编译: %s', release.version);
        } else {
          // 未指定 --target,使用当前主机 Node 版本
          log.verbose('获取 node 目录',
              '未指定 --target 版本,回退到宿主 node 版本: %s', release.version);
        }

        if (!release.semver) throw new Error('版本号无效: ' + release.version); // 无法用 semver 解析版本字符串
        // 如果指定了 tarball 选项,总是删除并重装 headers 到 devdir,
        // 否则只在不存在时安装
        gyp.opts.ensure = !gyp.opts.tarball, await gyp.commands.install([release.version]);
        log.verbose('获取 node 目录', '目标 node 版本已安装:', release.versionDir);
        nodeDir = path.resolve(gyp.devDir, release.versionDir);
      }

      return createBuildDir();
    };
  return getNodeDir();
};

configure.usage = '为当前模块生成 ' + (win ? 'MSVC 项目文件' : 'Makefile') + ';';
export { configure };