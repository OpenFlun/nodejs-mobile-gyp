import gracefulFs from 'graceful-fs';
import path from 'path';
import { glob } from 'glob';
import * as log from './log.js';
import which from 'which';
import os from 'os';

const fs = gracefulFs.promises, win = process.platform === 'win32',
  /**
   * 调用 make/msbuild 构建原生模块
   */
  build = async (gyp, argv) => {
    let platformMake = 'make';

    if (['aix', 'os400'].includes(process.platform) || process.platform.includes('bsd')) platformMake = 'gmake';
    else if (win && argv.length > 0) argv = argv.map(target => '/t:' + target);

    const makeCommand = gyp.opts.make || process.env.MAKE || platformMake, jobs = gyp.opts.jobs || process.env.JOBS;
    let command = win ? 'msbuild' : makeCommand, buildType, config, arch, nodeDir, guessedSolution, python, buildBinsDir;

    /**
     * 真正启动子进程并编译模块
     */
    const doBuild = async () => {
      // 启用 verbose 构建
      const verbose = log.logger.isVisible('verbose');
      let j;

      if (!win && verbose) argv.push('V=1');
      if (win && !verbose) argv.push('/clp:Verbosity=minimal');
      if (win) argv.push('/nologo'); // Windows 上关闭 Microsoft logo

      // 指定构建类型，默认 Release
      if (win) {
        // 把 .gypi 配置中的 target_arch 转换为 MSBuild 的 /Platform
        // 因为表示"32 位 Intel"的方式很多，默认按此处理
        // 注意：msbuild 的 Condition 字符串相等比较不区分大小写
        const archLower = arch.toLowerCase(), p = archLower === 'x64' ? 'x64' : (archLower === 'arm' ? 'ARM'
          : (archLower === 'arm64' ? 'ARM64' : 'Win32'));
        argv.push('/p:Configuration=' + buildType + ';Platform=' + p)
        if (jobs) {
          j = parseInt(jobs, 10)
          if (!isNaN(j) && j > 0) argv.push('/m:' + j);
          else if (jobs.toUpperCase() === 'MAX') argv.push('/m:' + os.cpus().length);
        }
      }
      // 调用 build 目录下的 Makefile
      else {
        argv.push('BUILDTYPE=' + buildType), argv.push('-C'), argv.push('build');
        if (jobs) {
          j = parseInt(jobs, 10);
          if (!isNaN(j) && j > 0) argv.push('--jobs'), argv.push(j);
          else if (jobs.toUpperCase() === 'MAX') argv.push('--jobs'), argv.push(os.cpus().length);
        }
      }

      if (win) {
        // 用户是否指定了自己的 .sln 文件？
        const hasSln = argv.some(arg => path.extname(arg) === '.sln');
        if (!hasSln) argv.unshift(gyp.opts.solution || guessedSolution);
      }

      if (!win) {
        // 把构建期依赖的符号链接（如 Python）加入 PATH
        buildBinsDir = path.resolve('build', 'node_gyp_bins');
        process.env.PATH = `${buildBinsDir}:${process.env.PATH}`;
        await fs.mkdir(buildBinsDir, { recursive: true });
        const symlinkDestination = path.join(buildBinsDir, 'python3');
        try {
          await fs.unlink(symlinkDestination);
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
        await fs.symlink(python, symlinkDestination);
        log.verbose('bin symlinks', `created symlink to "${python}" in "${buildBinsDir}" and added to PATH`);
      }

      const proc = gyp.spawn(command, argv);
      await new Promise((resolve, reject) => proc.on('exit', async (code, signal) => {
        if (buildBinsDir) await fs.rm(buildBinsDir, { recursive: true }); // 清理构建期依赖的符号链接

        if (code !== 0) return reject(new Error('`' + command + '` failed with exit code: ' + code));
        if (signal) return reject(new Error('`' + command + '` got signal: ' + signal));
        resolve();
      }))
    },
      /**
       * 用 node-which 定位 msbuild / make 可执行文件
       */
      doWhich = async () => {
        // Windows 使用 node-gyp configure 提供的 msbuild
        if (win) {
          if (!config.variables.msbuild_path) throw new Error('MSBuild 未设置，请先运行 `node-gyp configure`');
          command = config.variables.msbuild_path, log.verbose('using MSBuild:', command), await doBuild();
          return;
        }

        // 先确认构建命令在 PATH 中
        const execPath = await which(command);
        log.verbose('`which` succeeded for `' + command + '`', execPath), await doBuild();
      },
      /**
       * Windows 下查找第一个 build/*.sln 文件
       */
      findSolutionFile = async () => {
        const files = await glob('build/*.sln')
        if (files.length === 0) throw new Error('未找到 *.sln 文件，是否运行过 configure？');
        guessedSolution = files[0], log.verbose('found first Solution file', guessedSolution), await doWhich();
      },
      /**
       * 加载 configure 阶段生成的 config.gypi
       */
      loadConfigGypi = async () => {
        let data;
        try {
          const configPath = path.resolve('build', 'config.gypi');
          data = await fs.readFile(configPath, 'utf8');
        } catch (err) {
          if (err.code === 'ENOENT') throw new Error('请先运行 `node-gyp configure`');
          else throw err;
        }

        // 从 config 中取出 arch、buildType、nodeDir
        config = JSON.parse(data.replace(/#.+\n/, '')), buildType = config.target_defaults.default_configuration;
        arch = config.variables.target_arch, nodeDir = config.variables.nodedir, python = config.variables.python;

        if ('debug' in gyp.opts) buildType = gyp.opts.debug ? 'Debug' : 'Release';
        if (!buildType) buildType = 'Release';

        log.verbose('build type', buildType), log.verbose('architecture', arch), log.verbose('node dev dir', nodeDir);
        log.verbose('python', python);

        win ? await findSolutionFile() : await doWhich();
      };
    await loadConfigGypi();
  };

build.usage = 'Invokes `' + (win ? 'msbuild' : 'make') + '` and builds the module';
export { build };