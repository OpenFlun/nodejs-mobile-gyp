/* eslint-disable n/no-deprecated-api */

import semver from 'semver'
import url from 'url'
import path from 'path'
import * as log from './log.js'

// 开始发布 -headers.tar.gz 的版本
const headersTarballRange = '>= 3.0.0 || ~0.12.10 || ~0.10.42'
const bitsre = /\/win-(x86|x64|arm64)\//
const bitsreV3 = /\/win-(x86|ia32|x64)\// // io.js v3.x.x 里用的是 "ia32"，本应是 "x86"

/**
 * 归一化路径：统一分隔符为 /
 */
const normalizePath = (p) => path.normalize(p).replace(/\\/g, '/')

/**
 * 根据名称、基础 URL、架构、主版本号解析 lib 下载地址
 */
const resolveLibUrl = (name, defaultUrl, arch, versionMajor) => {
  const base = url.resolve(defaultUrl, './')
  const hasLibUrl = bitsre.test(defaultUrl) || (versionMajor === 3 && bitsreV3.test(defaultUrl))

  if (!hasLibUrl) {
    // 假设传入的是 baseUrl
    if (versionMajor >= 1) {
      return url.resolve(base, 'win-' + arch + '/' + name + '.lib')
    }
    // io.js@1.0.0 之前，32 位 node.lib 在根目录，64 位在 /x64/
    return url.resolve(base, (arch === 'x86' ? '' : arch + '/') + name + '.lib')
  }

  // 否则传入的已经是 .lib 地址，只需保证架构正确
  return defaultUrl.replace(versionMajor === 3 ? bitsreV3 : bitsre, '/win-' + arch + '/')
}

/**
 * 负责确定下载 URL、本地目录和文件名。
 * 输入来自命令行开关（--target、--dist-url）、process.version 和 process.release。
 */
const processRelease = (argv, gyp, defaultVersion, defaultRelease) => {
  let version = (semver.valid(argv[0]) && argv[0]) || gyp.opts.target || defaultVersion
  const versionSemver = semver.parse(version)
  let overrideDistUrl = gyp.opts['dist-url'] || gyp.opts.disturl
  let isNamedForLegacyIojs
  let name
  let distBaseUrl
  let baseUrl
  let libUrl32
  let libUrl64
  let libUrlArm64
  let tarballUrl
  let canGetHeaders

  if (!versionSemver) {
    // 不是合法 semver，只能原样返回 version
    return { version }
  }
  // 把 version 拍平为字符串
  version = versionSemver.version

  // defaultVersion 来自 process.version，应当是合法 semver
  const isDefaultVersion = version === semver.parse(defaultVersion).version

  // 用了 --target=x.y.z 就不能用 process.release
  if (!isDefaultVersion) {
    defaultRelease = null
  }

  if (defaultRelease) {
    // v3 起有 process.release
    name = defaultRelease.name.replace(/io\.js/, 'iojs') // 去掉 '.' 以便目录命名
  } else {
    // 老版本 Node 或自定义 --target
    // semver.satisfies() 不支持预发布标签，因此直接判断主版本
    isNamedForLegacyIojs = versionSemver.major >= 1 && versionSemver.major < 4
    // isNamedForLegacyIojs 是为了支持 Electron < 4（特别是 Electron 3）
    // 早期逻辑用它保证 iojs 版本下载 "iojs"，Node 版本下载 "node"。
    // 但该逻辑过宽，导致 electron@3 的发布物命名为 "iojs" 才能让 node-gyp 正常工作。
    // Electron@3 EOL 之后（2019 年底）应移除这个 hack。
    name = isNamedForLegacyIojs ? 'iojs' : 'node'
  }

  // 检查 nvm.sh 标准镜像环境变量
  if (!overrideDistUrl && process.env.NODEJS_ORG_MIRROR) {
    overrideDistUrl = process.env.NODEJS_ORG_MIRROR
  }

  if (overrideDistUrl) {
    log.verbose('download', 'using dist-url', overrideDistUrl)
  }

  if (overrideDistUrl) {
    distBaseUrl = overrideDistUrl.replace(/\/+$/, '')
  } else {
    distBaseUrl = 'https://nodejs.org/dist'
  }
  distBaseUrl += '/v' + version + '/'

  // 新式：基于 process.release，大部分数据已有
  if (defaultRelease && defaultRelease.headersUrl && !overrideDistUrl) {
    baseUrl = url.resolve(defaultRelease.headersUrl, './')
    libUrl32 = resolveLibUrl(name, defaultRelease.libUrl || baseUrl || distBaseUrl, 'x86', versionSemver.major)
    libUrl64 = resolveLibUrl(name, defaultRelease.libUrl || baseUrl || distBaseUrl, 'x64', versionSemver.major)
    libUrlArm64 = resolveLibUrl(name, defaultRelease.libUrl || baseUrl || distBaseUrl, 'arm64', versionSemver.major)
    tarballUrl = defaultRelease.headersUrl
  } else {
    // 没有 process.release 的老版本，需要做很多假设；
    // 另外 --target=x.y.z 时也无法使用当前 process.release
    baseUrl = distBaseUrl
    libUrl32 = resolveLibUrl(name, baseUrl, 'x86', versionSemver.major)
    libUrl64 = resolveLibUrl(name, baseUrl, 'x64', versionSemver.major)
    libUrlArm64 = resolveLibUrl(name, baseUrl, 'arm64', versionSemver.major)

    // 大胆假设：任何版本号 >3.0.0 的版本，其 dist 目录都有 *-headers.tar.gz
    canGetHeaders = semver.satisfies(versionSemver, headersTarballRange)
    tarballUrl = url.resolve(baseUrl, name + '-v' + version + (canGetHeaders ? '-headers' : '') + '.tar.gz')
  }

  return {
    version,
    semver: versionSemver,
    name,
    baseUrl,
    tarballUrl,
    shasumsUrl: url.resolve(baseUrl, 'SHASUMS256.txt'),
    versionDir: (name !== 'node' ? name + '-' : '') + version,
    ia32: {
      libUrl: libUrl32,
      libPath: normalizePath(path.relative(url.parse(baseUrl).path, url.parse(libUrl32).path))
    },
    x64: {
      libUrl: libUrl64,
      libPath: normalizePath(path.relative(url.parse(baseUrl).path, url.parse(libUrl64).path))
    },
    arm64: {
      libUrl: libUrlArm64,
      libPath: normalizePath(path.relative(url.parse(baseUrl).path, url.parse(libUrlArm64).path))
    }
  }
}

export { processRelease }
