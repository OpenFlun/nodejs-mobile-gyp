import crypto from 'crypto';
import { backOff } from 'exponential-backoff';
import gracefulFs from 'graceful-fs';
import os from 'os';
import path from 'path';
import semver from 'semver';
import { promises as streamPromises, Transform } from 'stream';
import * as tar from 'tar';
import { download } from './download.js';
import * as log from './log.js';
import { processRelease } from './process-release.js';

/**
 * SHA256 校验流
 */
class ShaSum extends Transform {
  constructor(callback) {
    super(), this._callback = callback, this._digester = crypto.createHash('sha256');
  }

  _transform(chunk, _, callback) {
    this._digester.update(chunk), callback(null, chunk)
  }

  _flush(callback) {
    this._callback(null, this._digester.digest('hex')), callback()
  }
}

const { createWriteStream, promises: fs } = gracefulFs, { pipeline } = streamPromises, win = process.platform === 'win32';
/**
 * 下载并安装指定版本的 Node.js 头文件与库
 * >查看定义:@see {@link install}
 * @param {*} gyp
 * @param {*} argv
 * @returns {*}
 */
const install = async (gyp, argv) => {
  log.stdout();
  const release = processRelease(argv, gyp, process.version, process.release),
    // 按 create-config-gypi.js 的逻辑推断 target_arch,仅 Windows 用
    arch = win ? (gyp.opts.target_arch || gyp.opts.arch || process.arch || 'ia32') : '';
  let shouldDownloadTarball = true; // 仅 Windows 下只需新 node.lib 时,避免下载 tarball

  // 确定要安装哪个版本的 Node 开发文件
  log.verbose('安装', '输入版本字符串 %j', release.version);
  if (!release.semver) throw new Error('版本号无效: ' + release.version); // 无法用 semver 解析版本字符串
  if (semver.lt(release.version, '0.8.0')) throw new Error('目标版本最低为 `0.8.0`,当前: ' + release.version);
  // 0.x.y-pre 版本尚未发布,无法安装,直接退出
  if (release.semver.prerelease[0] === 'pre') {
    log.verbose('检测到 "pre" 版 node', release.version);
    if (!gyp.opts.nodedir) throw new Error('无法安装 "pre" 版本的 node,请改用 --nodedir 参数');
    log.verbose('传入了 --nodedir 参数;跳过安装', gyp.opts.nodedir);
    return;
  }

  log.verbose('安装', '正在安装版本: %s', release.versionDir); // 版本拍平为字符串
  const devDir = path.resolve(gyp.devDir, release.versionDir),          // 开发文件安装目录
    valid = file => {
      // 头文件
      const extname = path.extname(file);
      return extname === '.h' || extname === '.gypi';
    },
    copyDirectory = async (src, dest) => {
      try {
        await fs.stat(src);
      } catch {
        throw new Error(`找不到要复制的源目录: ${src}`);
      }
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) await copyDirectory(path.join(src, entry.name), path.join(dest, entry.name));
        else if (entry.isFile()) {
          // 并行安装时,Windows 上复制文件可能报文件错误,
          // 因此用指数退避解决冲突
          await backOff(async () => {
            try {
              await fs.copyFile(path.join(src, entry.name), path.join(dest, entry.name));
            } catch (err) {
              // 若设置了 ensure,检查文件是否已存在,存在就足够了
              if (gyp.opts.ensure && err.code === 'EBUSY') {
                try {
                  await fs.stat(path.join(dest, entry.name));
                  return;
                } catch { }
              }
              throw err;
            }
          })
        }
        else throw new Error('意外的文件目录条目类型');
      }
    },
    rollback = async err => {
      log.warn('安装', '发生错误,正在回滚安装')
      await gyp.commands.remove([release.versionDir]);
      throw err;
    },
    /**
     * EACCES 回退方案,用于处理 npm 的 `sudo` 行为:
     * npm 在调用任何子进程(如 node-gyp)前会先降权,
     * 于是 "nobody" 用户没有权限创建 dev dir;
     * 作为回退,把 tmpdir() 作为本次安装的 dev dir;
     * 这不理想,但至少编译能成功......
     */
    eaccesFallback = async err => {
      const noretry = '--node_gyp_internal_noretry';
      if (argv.indexOf(noretry) !== -1) throw err;
      const tmpdir = os.tmpdir();
      gyp.devDir = path.resolve(tmpdir, '.node-gyp');
      let userString = '';
      try {
        userString = ` ("${os.userInfo().username}")`; // os.userInfo 在某些系统上会失败,这里不关键
      } catch (e) { }
      log.warn('EACCES', '当前用户%s 没有权限访问开发文件目录 "%s"', userString, devDir);
      log.warn('EACCES', '尝试用临时开发文件目录重新安装 "%s"', gyp.devDir);
      if (process.cwd() === tmpdir) {
        log.verbose('tmpdir 等于 cwd', '将自动删除开发文件以节省磁盘空间');
        gyp.todo.push({ name: 'remove', args: argv });
      }
      return gyp.commands.install([noretry].concat(argv));
    },
    go = async () => {
      log.verbose('正在确保 devDir 已创建', devDir);

      // 先创建 Node 开发文件所在目录
      try {
        const created = await fs.mkdir(devDir, { recursive: true });
        if (created) log.verbose('已创建 devDir', created);
      } catch (err) {
        if (err.code === 'EACCES') return eaccesFallback(err);
        throw err;
      }

      // 下载 Node tarball
      let extractErrors = false, extractCount = 0;
      const tarPath = gyp.opts.tarball, contentShasums = {}, expectShasums = {},
        // 检查从 tarball 解出的文件是否有效;
        // 只有 .h 头文件和 gyp 文件会被解出
        isValid = path => {
          const isValid = valid(path);
          if (isValid) log.verbose('已从 tarball 解出文件', path), extractCount++;
          else log.silly('忽略 tarball 中的该项', path); // 无效

          return isValid;
        },
        onwarn = (code, message) => {
          extractErrors = true, log.error('解压 tarball 出错', code, message);
        },
        // 下载并解压 tarball!
        // 仅 Windows 上只需新 node.lib 时跳过
        // Windows 上并行安装时(多个原生模块,很常见)tar 会报文件错误,
        // 所以先把 tarball 解到临时目录,再复制过去
        tarExtractDir = win ? await fs.mkdtemp(path.join(os.tmpdir(), 'node-gyp-tmp-')) : devDir,
        downloadShasums = async () => {
          log.verbose('检查下载内容校验值,需要下载 `SHASUMS256.txt`...');
          log.verbose('校验文件地址', release.shasumsUrl);

          const res = await download(gyp, release.shasumsUrl);
          if (res.status !== 200) throw new Error(`下载校验文件时返回状态码 ${res.status}`);

          for (const line of (await res.text()).trim().split('\n')) {
            const items = line.trim().split(/\s+/);
            if (items.length !== 2) return;

            // 0035d18e2dcf9aad669b1c7c07319e17abfe3762  ./node-v0.11.4.tar.gz
            const name = items[1].replace(/^\.\//, '');
            expectShasums[name] = items[0];
          }

          log.verbose('校验数据', JSON.stringify(expectShasums));
        },
        downloadNodeLib = async () => {
          log.verbose('Windows 上;需要下载 `' + release.name + '.lib`...');
          const dir = path.resolve(tarExtractDir, arch), targetLibPath = path.resolve(dir, release.name + '.lib'),
            { libUrl, libPath } = release[arch], name = `${arch} ${release.name}.lib`;

          log.verbose(name, '目录', dir), log.verbose(name, '地址', libUrl);
          await fs.mkdir(dir, { recursive: true }), log.verbose('正在流式写入', name, '到:', targetLibPath);

          const res = await download(gyp, libUrl);
          // 只下载所需的 node.lib,若未拿到则抛错
          if (res.status !== 200) throw new Error(`下载 ${name} 时返回状态码 ${res.status}`);

          return pipeline(
            res.body,
            new ShaSum((_, checksum) => {
              contentShasums[libPath] = checksum, log.verbose('内容校验值', libPath, checksum)
            }), createWriteStream(targetLibPath)
          );
        };

      try {
        if (shouldDownloadTarball) {
          if (tarPath) await tar.extract({ file: tarPath, strip: 1, filter: isValid, onwarn, cwd: tarExtractDir });
          else {
            try {
              const res = await download(gyp, release.tarballUrl);

              if (res.status !== 200) throw new Error(`下载 ${release.tarballUrl} 时返回状态码 ${res.status}`);
              await pipeline(
                res.body,
                // 内容校验和
                new ShaSum((_, checksum) => {
                  const filename = path.basename(release.tarballUrl).trim();
                  contentShasums[filename] = checksum, log.verbose('内容校验值', filename, checksum);
                }),
                tar.extract({ strip: 1, cwd: tarExtractDir, filter: isValid, onwarn })
              )
            } catch (err) {
              // tarball 下载出问题?
              if (err.code === 'ENOTFOUND')
                throw new Error('这通常不是 nodejs-mobile-gyp 或包本身的问题,而是网络问题;\n' +
                  '通常是因为你在代理后,或网络设置异常;');
              throw err;
            }
          }

          // tarball 解压完成后调用
          if (extractErrors || extractCount === 0) throw new Error('下载/解压 tarball 时发生致命错误');
          log.verbose('tarball', '解析 tarball 完成');
        }

        const installVersionPath = path.resolve(tarExtractDir, 'installVersion');
        await Promise.all([
          // 需要下载 node.lib
          ...(win ? [downloadNodeLib()] : []),
          // 写入 "installVersion" 文件
          fs.writeFile(installVersionPath, gyp.package.installVersion + '\n'),
          // 只有在下载了需要 SHA 校验的东西时才下载 SHASUMS.txt
          ...(!tarPath || win ? [downloadShasums()] : [])
        ])

        log.verbose('下载内容校验值', JSON.stringify(contentShasums));
        // 校验内容 shasum
        for (const k in contentShasums) {
          log.verbose('正在校验 ' + k + ' 的下载校验值', '(%s == %s)', contentShasums[k], expectShasums[k]);
          if (contentShasums[k] !== expectShasums[k]) {
            throw new Error(k + ' 本地校验值与远程不一致: ' + contentShasums[k] + ' != ' + expectShasums[k]);
          }
        }

        // 从临时解压目录复制文件到 devDir
        if (tarExtractDir !== devDir) {
          await copyDirectory(tarExtractDir, devDir);
        }
      } finally {
        if (tarExtractDir !== devDir) {
          try {
            await fs.rm(tarExtractDir, { recursive: true }); // 尝试清理临时目录
          } catch { log.warn('清理临时 tarball 解压目录失败') }
        }
      }
    };

  // 如果传了 --ensure,则不总是安装,只在需要时安装
  if (gyp.opts.ensure) {
    log.verbose('安装', '传入了 --ensure,已安装时不再重装');
    try {
      await fs.stat(devDir);
    } catch (err) {
      if (err.code === 'ENOENT') {
        log.verbose('安装', '版本尚未安装,继续安装', release.version);
        try {
          return await go();
        } catch (err) { return rollback(err) }
      }
      else if (err.code === 'EACCES') return eaccesFallback(err);
      throw err;
    }
    log.verbose('安装', '版本已安装,需要检查 "installVersion"');
    const installVersionFile = path.resolve(devDir, 'installVersion');
    let installVersion = 0;
    try {
      const ver = await fs.readFile(installVersionFile, 'ascii');
      installVersion = parseInt(ver, 10) || 0;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    log.verbose('得到 "installVersion"', installVersion);
    log.verbose('需要 "installVersion"', gyp.package.installVersion);
    if (installVersion < gyp.package.installVersion) {
      log.verbose('安装', '版本不可用;重新安装');
      try {
        return await go();
      } catch (err) { return rollback(err) }
    }
    log.verbose('安装', '版本可用');
    if (win) {
      log.verbose('Windows 上;需要检查 node.lib');
      const nodeLibPath = path.resolve(devDir, arch, 'node.lib');
      try {
        await fs.stat(nodeLibPath);
      } catch (err) {
        if (err.code === 'ENOENT') {
          log.verbose('安装', `版本尚未为 ${arch} 安装,继续安装`, release.version);
          try {
            shouldDownloadTarball = false;
            return await go();
          } catch (err) { return rollback(err) }
        }
        else if (err.code === 'EACCES') return eaccesFallback(err);
        throw err;
      }
    }
  } else {
    try {
      return await go();
    } catch (err) { return rollback(err) }
  }
};

export { install };