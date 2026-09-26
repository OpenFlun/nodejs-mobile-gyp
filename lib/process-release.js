/* eslint-disable n/no-deprecated-api */

import semver from 'semver';
import path from 'path';
import * as log from './log.js';

// 开始发布 -headers.tar.gz 的版本(io.js v3.x.x 里用的是 "ia32"，本应是 "x86")
const headersTarballRange = '>= 3.0.0 || ~0.12.10 || ~0.10.42', bitsre = /\/win-(x86|x64|arm64)\//,
  bitsreV3 = /\/win-(x86|ia32|x64)\//, normalizePath = (p) => path.normalize(p).replace(/\\/g, '/'), // 统一分隔符为 /
  /**
   * 根据名称、基础 URL、架构、主版本号解析 lib 下载地址
   */
  resolveLibUrl = (name, defaultUrl, arch, versionMajor) => {
    const base = new URL('./', defaultUrl).href, // 相当于 url.resolve(defaultUrl, './')
      hasLibUrl = bitsre.test(defaultUrl) || (versionMajor === 3 && bitsreV3.test(defaultUrl));

    if (!hasLibUrl) {
      // 假设传入的是 baseUrl
      if (versionMajor >= 1) return new URL('win-' + arch + '/' + name + '.lib', base).href;
      // io.js@1.0.0 之前，32 位 node.lib 在根目录，64 位在 /x64/
      const prefix = arch === 'x86' ? '' : arch + '/';
      return new URL(prefix + name + '.lib', base).href;
    }
    // 否则传入的已经是 .lib 地址，只需保证架构正确
    return defaultUrl.replace(versionMajor === 3 ? bitsreV3 : bitsre, '/win-' + arch + '/');
  },
  /**
   * 负责确定下载 URL、本地目录和文件名。
   * 输入来自命令行开关（--target、--dist-url）、process.version 和 process.release。
   */
  processRelease = (argv, gyp, defaultVersion, defaultRelease) => {
    let version = (semver.valid(argv[0]) && argv[0]) || gyp.opts.target || defaultVersion
    const versionSemver = semver.parse(version)
    let overrideDistUrl = gyp.opts['dist-url'] || gyp.opts.disturl, isNamedForLegacyIojs, name, distBaseUrl,
      baseUrl, libUrl32, libUrl64, libUrlArm64, tarballUrl, canGetHeaders;

    if (!versionSemver) return { version }; // 如果 semver 不合法,那么原样返回 version
    version = versionSemver.version; // 把 version 拍平为字符串

    // defaultVersion 来自 process.version，应当是合法 semver
    const isDefaultVersion = version === semver.parse(defaultVersion).version;
    if (!isDefaultVersion) defaultRelease = null;      // 用了 --target=x.y.z 就不能用 process.release
    if (defaultRelease) name = defaultRelease.name.replace(/io\.js/, 'iojs'); // 去掉 '.' 以便目录命名
    else {
      // 老版本 Node 或自定义 --target
      // semver.satisfies() 不支持预发布标签，因此直接判断主版本
      isNamedForLegacyIojs = versionSemver.major >= 1 && versionSemver.major < 4;
      // isNamedForLegacyIojs 是为了支持 Electron < 4（特别是 Electron 3）
      // 早期逻辑用它保证 iojs 版本下载 "iojs"，Node 版本下载 "node"。
      // 但该逻辑过宽，导致 electron@3 的发布物命名为 "iojs" 才能让 node-gyp 正常工作。
      // Electron@3 EOL 之后（2019 年底）应移除这个 hack。
      name = isNamedForLegacyIojs ? 'iojs' : 'node';
    }

    // 检查 nvm.sh 标准镜像环境变量
    if (!overrideDistUrl && process.env.NODEJS_ORG_MIRROR) overrideDistUrl = process.env.NODEJS_ORG_MIRROR;
    if (overrideDistUrl) log.verbose('download', 'using dist-url', overrideDistUrl);
    if (overrideDistUrl) distBaseUrl = overrideDistUrl.replace(/\/+$/, '');
    else distBaseUrl = 'https://nodejs.org/dist';
    distBaseUrl += '/v' + version + '/'

    // 新式：基于 process.release，大部分数据已有
    if (defaultRelease?.headersUrl && !overrideDistUrl) {
      baseUrl = new URL('./', defaultRelease.headersUrl).href;
      libUrl32 = resolveLibUrl(name, defaultRelease.libUrl || baseUrl || distBaseUrl, 'x86', versionSemver.major);
      libUrl64 = resolveLibUrl(name, defaultRelease.libUrl || baseUrl || distBaseUrl, 'x64', versionSemver.major);
      libUrlArm64 = resolveLibUrl(name, defaultRelease.libUrl || baseUrl || distBaseUrl, 'arm64', versionSemver.major);
      tarballUrl = defaultRelease.headersUrl;
    } else {
      // 没有 process.release 的老版本，需要做很多假设；
      // 另外 --target=x.y.z 时也无法使用当前 process.release
      baseUrl = distBaseUrl;
      libUrl32 = resolveLibUrl(name, baseUrl, 'x86', versionSemver.major);
      libUrl64 = resolveLibUrl(name, baseUrl, 'x64', versionSemver.major);
      libUrlArm64 = resolveLibUrl(name, baseUrl, 'arm64', versionSemver.major);

      // 大胆假设：任何版本号 >3.0.0 的版本，其 dist 目录都有 *-headers.tar.gz
      canGetHeaders = semver.satisfies(versionSemver, headersTarballRange);
      tarballUrl = new URL(name + '-v' + version + (canGetHeaders ? '-headers' : '') + '.tar.gz', baseUrl).href;
    }

    return {
      version,
      semver: versionSemver,
      name,
      baseUrl,
      tarballUrl,
      shasumsUrl: new URL('SHASUMS256.txt', baseUrl).href,
      versionDir: (name !== 'node' ? name + '-' : '') + version,
      ia32: {
        libUrl: libUrl32,
        libPath: normalizePath(path.relative(new URL(baseUrl).pathname, new URL(libUrl32).pathname))
      },
      x64: {
        libUrl: libUrl64,
        libPath: normalizePath(path.relative(new URL(baseUrl).pathname, new URL(libUrl64).pathname))
      },
      arm64: {
        libUrl: libUrlArm64,
        libPath: normalizePath(path.relative(new URL(baseUrl).pathname, new URL(libUrlArm64).pathname))
      }
    }
  };

export { processRelease }