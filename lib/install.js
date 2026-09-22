import gracefulFs from 'graceful-fs'
import os from 'os'
import { backOff } from 'exponential-backoff'
import * as tar from 'tar'
import path from 'path'
import { Transform, promises as streamPromises } from 'stream'
import crypto from 'crypto'
import * as log from './log.js'
import semver from 'semver'
import { download } from './download.js'
import { processRelease } from './process-release.js'

const { createWriteStream, promises: fs } = gracefulFs
const { pipeline } = streamPromises
const win = process.platform === 'win32'

/**
 * 为指定 Node 版本安装开发文件
 */
const install = async (gyp, argv) => {
  log.stdout()
  const release = processRelease(argv, gyp, process.version, process.release)
  // 按 create-config-gypi.js 的逻辑推断 target_arch，仅 Windows 用
  const arch = win ? (gyp.opts.target_arch || gyp.opts.arch || process.arch || 'ia32') : ''
  // 仅 Windows 下只需新 node.lib 时，避免下载 tarball
  let shouldDownloadTarball = true

  // 确定要安装哪个版本的 Node 开发文件
  log.verbose('install', 'input version string %j', release.version)

  if (!release.semver) {
    // 无法用 semver 解析版本字符串
    throw new Error('Invalid version number: ' + release.version)
  }

  if (semver.lt(release.version, '0.8.0')) {
    throw new Error('Minimum target version is `0.8.0` or greater. Got: ' + release.version)
  }

  // 0.x.y-pre 版本尚未发布，无法安装，直接退出
  if (release.semver.prerelease[0] === 'pre') {
    log.verbose('detected "pre" node version', release.version)
    if (!gyp.opts.nodedir) {
      throw new Error('"pre" versions of node cannot be installed, use the --nodedir flag instead')
    }
    log.verbose('--nodedir flag was passed; skipping install', gyp.opts.nodedir)
    return
  }

  // 版本拍平为字符串
  log.verbose('install', 'installing version: %s', release.versionDir)

  // 开发文件安装目录
  const devDir = path.resolve(gyp.devDir, release.versionDir)

  // 如果传了 --ensure，则不总是安装，只在需要时安装
  if (gyp.opts.ensure) {
    log.verbose('install', '--ensure was passed, so won\'t reinstall if already installed')
    try {
      await fs.stat(devDir)
    } catch (err) {
      if (err.code === 'ENOENT') {
        log.verbose('install', 'version not already installed, continuing with install', release.version)
        try {
          return await go()
        } catch (err) {
          return rollback(err)
        }
      } else if (err.code === 'EACCES') {
        return eaccesFallback(err)
      }
      throw err
    }
    log.verbose('install', 'version is already installed, need to check "installVersion"')
    const installVersionFile = path.resolve(devDir, 'installVersion')
    let installVersion = 0
    try {
      const ver = await fs.readFile(installVersionFile, 'ascii')
      installVersion = parseInt(ver, 10) || 0
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err
      }
    }
    log.verbose('got "installVersion"', installVersion)
    log.verbose('needs "installVersion"', gyp.package.installVersion)
    if (installVersion < gyp.package.installVersion) {
      log.verbose('install', 'version is no good; reinstalling')
      try {
        return await go()
      } catch (err) {
        return rollback(err)
      }
    }
    log.verbose('install', 'version is good')
    if (win) {
      log.verbose('on Windows; need to check node.lib')
      const nodeLibPath = path.resolve(devDir, arch, 'node.lib')
      try {
        await fs.stat(nodeLibPath)
      } catch (err) {
        if (err.code === 'ENOENT') {
          log.verbose('install', `version not already installed for ${arch}, continuing with install`, release.version)
          try {
            shouldDownloadTarball = false
            return await go()
          } catch (err) {
            return rollback(err)
          }
        } else if (err.code === 'EACCES') {
          return eaccesFallback(err)
        }
        throw err
      }
    }
  } else {
    try {
      return await go()
    } catch (err) {
      return rollback(err)
    }
  }

  async function copyDirectory (src, dest) {
    try {
      await fs.stat(src)
    } catch {
      throw new Error(`Missing source directory for copy: ${src}`)
    }
    await fs.mkdir(dest, { recursive: true })
    const entries = await fs.readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await copyDirectory(path.join(src, entry.name), path.join(dest, entry.name))
      } else if (entry.isFile()) {
        // 并行安装时，Windows 上复制文件可能报文件错误，
        // 因此用指数退避解决冲突
        await backOff(async () => {
          try {
            await fs.copyFile(path.join(src, entry.name), path.join(dest, entry.name))
          } catch (err) {
            // 若设置了 ensure，检查文件是否已存在，存在就足够了
            if (gyp.opts.ensure && err.code === 'EBUSY') {
              try {
                await fs.stat(path.join(dest, entry.name))
                return
              } catch {}
            }
            throw err
          }
        })
      } else {
        throw new Error('Unexpected file directory entry type')
      }
    }
  }

  async function go () {
    log.verbose('ensuring devDir is created', devDir)

    // 先创建 Node 开发文件所在目录
    try {
      const created = await fs.mkdir(devDir, { recursive: true })

      if (created) {
        log.verbose('created devDir', created)
      }
    } catch (err) {
      if (err.code === 'EACCES') {
        return eaccesFallback(err)
      }

      throw err
    }

    // 下载 Node tarball
    const tarPath = gyp.opts.tarball
    let extractErrors = false
    let extractCount = 0
    const contentShasums = {}
    const expectShasums = {}

    // 检查从 tarball 解出的文件是否有效。
    // 只有 .h 头文件和 gyp 文件会被解出
    function isValid (path) {
      const isValid = valid(path)
      if (isValid) {
        log.verbose('extracted file from tarball', path)
        extractCount++
      } else {
        // 无效
        log.silly('ignoring from tarball', path)
      }
      return isValid
    }

    function onwarn (code, message) {
      extractErrors = true
      log.error('error while extracting tarball', code, message)
    }

    // 下载并解压 tarball！
    // 仅 Windows 上只需新 node.lib 时跳过

    // Windows 上并行安装时（多个原生模块，很常见）tar 会报文件错误，
    // 所以先把 tarball 解到临时目录，再复制过去
    const tarExtractDir = win ? await fs.mkdtemp(path.join(os.tmpdir(), 'node-gyp-tmp-')) : devDir

    try {
      if (shouldDownloadTarball) {
        if (tarPath) {
          await tar.extract({
            file: tarPath,
            strip: 1,
            filter: isValid,
            onwarn,
            cwd: tarExtractDir
          })
        } else {
          try {
            const res = await download(gyp, release.tarballUrl)

            if (res.status !== 200) {
              throw new Error(`${res.status} response downloading ${release.tarballUrl}`)
            }

            await pipeline(
              res.body,
              // 内容校验和
              new ShaSum((_, checksum) => {
                const filename = path.basename(release.tarballUrl).trim()
                contentShasums[filename] = checksum
                log.verbose('content checksum', filename, checksum)
              }),
              tar.extract({
                strip: 1,
                cwd: tarExtractDir,
                filter: isValid,
                onwarn
              })
            )
          } catch (err) {
          // tarball 下载出问题？
            if (err.code === 'ENOTFOUND') {
              throw new Error('This is most likely not a problem with node-gyp or the package itself and\n' +
              'is related to network connectivity. In most cases you are behind a proxy or have bad \n' +
              'network settings.')
            }
            throw err
          }
        }

        // tarball 解压完成后调用
        if (extractErrors || extractCount === 0) {
          throw new Error('There was a fatal problem while downloading/extracting the tarball')
        }

        log.verbose('tarball', 'done parsing tarball')
      }

      const installVersionPath = path.resolve(tarExtractDir, 'installVersion')
      await Promise.all([
      // 需要下载 node.lib
        ...(win ? [downloadNodeLib()] : []),
        // 写入 "installVersion" 文件
        fs.writeFile(installVersionPath, gyp.package.installVersion + '\n'),
        // 只有在下载了需要 SHA 校验的东西时才下载 SHASUMS.txt
        ...(!tarPath || win ? [downloadShasums()] : [])
      ])

      log.verbose('download contents checksum', JSON.stringify(contentShasums))
      // 校验内容 shasum
      for (const k in contentShasums) {
        log.verbose('validating download checksum for ' + k, '(%s == %s)', contentShasums[k], expectShasums[k])
        if (contentShasums[k] !== expectShasums[k]) {
          throw new Error(k + ' local checksum ' + contentShasums[k] + ' not match remote ' + expectShasums[k])
        }
      }

      // 从临时解压目录复制文件到 devDir
      if (tarExtractDir !== devDir) {
        await copyDirectory(tarExtractDir, devDir)
      }
    } finally {
      if (tarExtractDir !== devDir) {
        try {
          // 尝试清理临时目录
          await fs.rm(tarExtractDir, { recursive: true })
        } catch {
          log.warn('failed to clean up temp tarball extract directory')
        }
      }
    }

    async function downloadShasums () {
      log.verbose('check download content checksum, need to download `SHASUMS256.txt`...')
      log.verbose('checksum url', release.shasumsUrl)

      const res = await download(gyp, release.shasumsUrl)

      if (res.status !== 200) {
        throw new Error(`${res.status}  status code downloading checksum`)
      }

      for (const line of (await res.text()).trim().split('\n')) {
        const items = line.trim().split(/\s+/)
        if (items.length !== 2) {
          return
        }

        // 0035d18e2dcf9aad669b1c7c07319e17abfe3762  ./node-v0.11.4.tar.gz
        const name = items[1].replace(/^\.\//, '')
        expectShasums[name] = items[0]
      }

      log.verbose('checksum data', JSON.stringify(expectShasums))
    }

    async function downloadNodeLib () {
      log.verbose('on Windows; need to download `' + release.name + '.lib`...')
      const dir = path.resolve(tarExtractDir, arch)
      const targetLibPath = path.resolve(dir, release.name + '.lib')
      const { libUrl, libPath } = release[arch]
      const name = `${arch} ${release.name}.lib`
      log.verbose(name, 'dir', dir)
      log.verbose(name, 'url', libUrl)

      await fs.mkdir(dir, { recursive: true })
      log.verbose('streaming', name, 'to:', targetLibPath)

      const res = await download(gyp, libUrl)

      // 只下载所需的 node.lib，若未拿到则抛错
      if (res.status !== 200) {
        throw new Error(`${res.status} status code downloading ${name}`)
      }

      return pipeline(
        res.body,
        new ShaSum((_, checksum) => {
          contentShasums[libPath] = checksum
          log.verbose('content checksum', libPath, checksum)
        }),
        createWriteStream(targetLibPath)
      )
    } // downloadNodeLib()
  } // go()

  /**
   * 检查给定文件名是否对本次安装"有效"
   */

  function valid (file) {
    // 头文件
    const extname = path.extname(file)
    return extname === '.h' || extname === '.gypi'
  }

  async function rollback (err) {
    log.warn('install', 'got an error, rolling back install')
    // 出错则回滚安装
    await gyp.commands.remove([release.versionDir])
    throw err
  }

  /**
   * EACCES 回退方案，用于处理 npm 的 `sudo` 行为：
   * npm 在调用任何子进程（如 node-gyp）前会先降权，
   * 于是 "nobody" 用户没有权限创建 dev dir。
   * 作为回退，把 tmpdir() 作为本次安装的 dev dir。
   * 这不理想，但至少编译能成功……
   */

  async function eaccesFallback (err) {
    const noretry = '--node_gyp_internal_noretry'
    if (argv.indexOf(noretry) !== -1) {
      throw err
    }
    const tmpdir = os.tmpdir()
    gyp.devDir = path.resolve(tmpdir, '.node-gyp')
    let userString = ''
    try {
      // os.userInfo 在某些系统上会失败，这里不关键
      userString = ` ("${os.userInfo().username}")`
    } catch (e) {}
    log.warn('EACCES', 'current user%s does not have permission to access the dev dir "%s"', userString, devDir)
    log.warn('EACCES', 'attempting to reinstall using temporary dev dir "%s"', gyp.devDir)
    if (process.cwd() === tmpdir) {
      log.verbose('tmpdir == cwd', 'automatically will remove dev files after to save disk space')
      gyp.todo.push({ name: 'remove', args: argv })
    }
    return gyp.commands.install([noretry].concat(argv))
  }
}

/**
 * SHA256 校验流
 */
class ShaSum extends Transform {
  constructor (callback) {
    super()
    this._callback = callback
    this._digester = crypto.createHash('sha256')
  }

  _transform (chunk, _, callback) {
    this._digester.update(chunk)
    callback(null, chunk)
  }

  _flush (callback) {
    this._callback(null, this._digester.digest('hex'))
    callback()
  }
}

install.usage = 'Install node development files for the specified node version.'

export { install }
