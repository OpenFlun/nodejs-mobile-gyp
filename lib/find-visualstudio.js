import { existsSync } from 'fs';
import nodePath from 'path';
import { fileURLToPath } from 'url';
import * as log from './log.js';
import { execFile, regSearchKeys } from './util.js';

const path = nodePath.win32, __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
/**
 * Visual Studio 查找器:定位可用的 VS 安装
 * >查看定义:@see {@link VisualStudioFinder}
 */
class VisualStudioFinder {
  static findVisualStudio = (...args) => new VisualStudioFinder(...args).findVisualStudio();

  log = log.withPrefix('查找 VS');
  regSearchKeys = regSearchKeys;
  constructor(nodeSemver, configMsvsVersion) {
    this.nodeSemver = nodeSemver, this.configMsvsVersion = configMsvsVersion, this.errorLog = [], this.validVersions = [];
  }

  // 以 verbose 级别记录日志,同时保存下来,出错时以 error 级别展示,便于诊断
  addLog(message) {
    this.log.verbose(message), this.errorLog.push(message);
  }

  async findVisualStudio() {
    this.configVersionYear = null, this.configPath = null;
    if (this.configMsvsVersion) {
      this.addLog('已从命令行或 npm 配置设置 msvs_version');
      if (this.configMsvsVersion.match(/^\d{4}$/)) {
        this.configVersionYear = parseInt(this.configMsvsVersion, 10);
        this.addLog(`- 正在查找 Visual Studio ${this.configVersionYear} 版本`);
      } else {
        this.configPath = path.resolve(this.configMsvsVersion);
        this.addLog(`- 正在查找安装在 "${this.configPath}" 的 Visual Studio`);
      }
    }
    else this.addLog('未从命令行或 npm 配置设置 msvs_version');

    if (process.env.VCINSTALLDIR) {
      this.envVcInstallDir = path.resolve(process.env.VCINSTALLDIR, '..');
      this.addLog('运行在 VS 命令提示符中,安装路径为:\n' + `"${this.envVcInstallDir}"\n- will only use this version`);
    }
    else this.addLog('未设置 VCINSTALLDIR,不在 VS 命令提示符中运行');

    const checks = [
      () => this.findVisualStudio2017OrNewer(), () => this.findVisualStudio2015(), () => this.findVisualStudio2013()
    ];

    for (const check of checks) {
      const info = await check();
      if (info) return this.succeed(info);
    }

    return this.fail();
  }

  succeed(info) {
    this.log.info(`使用 VS${info.versionYear} (${info.version}),路径:` +
      `\n"${info.path}"` + '\n加 --verbose 可查看详细信息');
    return info;
  }

  fail() {
    if (this.configMsvsVersion && this.envVcInstallDir)
      this.errorLog.push('msvs_version 与当前 VS 命令提示符不匹配,或该安装不可用');
    else if (this.configMsvsVersion) {
      // 指定了 msvs_version 但没找到 VS,输出可接受的版本
      this.errorLog.push('');
      if (this.validVersions) {
        this.errorLog.push('msvs_version 可用的版本:');
        this.validVersions.forEach(version => this.errorLog.push(`- "${version}"`));
      }
      else this.errorLog.push('未找到 msvs_version 可用的版本');
    }

    const errorLog = this.errorLog.join('\n'),
      // Windows 80 列控制台,用到 X 标记列之前(含日志前缀共 79 字符,可用 62 字符):
      infoLog = [
        '**************************************************************',
        '需要安装最新版本的 Visual Studio,并包含',
        '"使用 C++ 的桌面开发"工作负载;',
        '更多说明见文档:',
        'https://github.com/nodejs/node-gyp#on-windows',
        '**************************************************************'
      ].join('\n');

    this.log.error(`\n${errorLog}\n\n${infoLog}\n`);
    throw new Error('未找到可用的 Visual Studio 安装');
  }

  // 调用 PowerShell 脚本,获取 Visual Studio 2017 或更新版本的信息
  async findVisualStudio2017OrNewer() {
    const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      csFile = path.join(__dirname, 'Find-VisualStudio.cs'),
      psArgs = ['-ExecutionPolicy', 'Unrestricted', '-NoProfile', '-Command',
        '&{Add-Type -Path \'' + csFile + '\';' + '[VisualStudioConfiguration.Main]::PrintJson()}'];

    this.log.silly('正在执行', ps, psArgs);
    const [err, stdout, stderr] = await execFile(ps, psArgs, { encoding: 'utf8' });
    return this.parseData(err, stdout, stderr);
  }

  // 解析 PowerShell 脚本输出,寻找可用的 Visual Studio 2017 或更新版本
  parseData(err, stdout, stderr) {
    this.log.silly('PS 标准错误 = %j', stderr)

    const failPowershell = () => {
      this.addLog(`无法用 PowerShell 找到 Visual Studio 2017 或更新版本,可加 '--loglevel silly' 重新运行以获取更多细节`);
      return null;
    }

    if (err) {
      this.log.silly('PS 错误 = %j', err && (err.stack || err));
      return failPowershell();
    }

    let vsInfo;
    try {
      vsInfo = JSON.parse(stdout);
    } catch (e) {
      this.log.silly('PS 标准输出 = %j', stdout), this.log.silly(e);
      return failPowershell();
    }

    if (!Array.isArray(vsInfo)) {
      this.log.silly('PS 标准输出 = %j', stdout);
      return failPowershell();
    }

    vsInfo = vsInfo.map((info) => {
      this.log.silly(`processing installation: "${info.path}"`);
      info.path = path.resolve(info.path);
      const ret = this.getVersionInfo(info);
      ret.path = info.path;
      ret.msBuild = this.getMSBuild(info, ret.versionYear);
      ret.toolset = this.getToolset(info, ret.versionYear);
      ret.sdk = this.getSDK(info);
      return ret;
    })
    this.log.silly('vsInfo:', vsInfo);

    // 去掉未来版本或版本号解析失败的项
    vsInfo = vsInfo.filter(info => {
      if (info.versionYear) return true;
      this.addLog(`在 "${info.path}" 发现未知版本 "${info.version}"`);
      return false;
    })

    // 排序:新版本在前
    vsInfo.sort((a, b) => b.versionYear - a.versionYear)

    for (let i = 0; i < vsInfo.length; ++i) {
      const info = vsInfo[i];
      this.addLog(`正在检查 VS${info.versionYear} (${info.version}),发现于:\n"${info.path}"`);

      if (info.msBuild) this.addLog('- 找到 "Visual Studio C++ 核心功能"');
      else {
        this.addLog('- 缺少 "Visual Studio C++ 核心功能"'); continue;
      }
      if (info.toolset) this.addLog(`- 找到 VC++ 工具集: ${info.toolset}`);
      else {
        this.addLog('- 缺少任何 VC++ 工具集'); continue;
      }
      if (info.sdk) this.addLog(`- 找到 Windows SDK: ${info.sdk}`);
      else {
        this.addLog('- 缺少任何 Windows SDK'); continue;
      }
      if (!this.checkConfigVersion(info.versionYear, info.path)) continue;
      return info
    }

    this.addLog('未找到可用的 Visual Studio 2017 或更新版本');
    return null;
  }

  // 辅助:解析版本信息
  getVersionInfo(info) {
    const match = /^(\d+)\.(\d+)\./.exec(info.version);
    if (!match) {
      this.log.silly('- 解析版本失败:', info.version);
      return {};
    }

    this.log.silly('- 版本匹配 = %j', match);
    const versionMajor = parseInt(match[1], 10), versionMinor = parseInt(match[2], 10),
      VERSION_YEAR = { 15: 2017, 16: 2019, 17: 2022, 18: 2026, }, versionYear = VERSION_YEAR[versionMajor];

    if (!versionYear) {
      this.log.silly('- 不支持的版本:', versionMajor);
      return {};
    }

    return { version: info.version, versionMajor, versionMinor, versionYear };
  }

  msBuildPathExists(path) {
    return existsSync(path);
  }

  // 辅助:解析 MSBuild 信息
  getMSBuild(info, versionYear) {
    const pkg = 'Microsoft.VisualStudio.VC.MSBuild.Base',
      msbuildPath = path.join(info.path, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
      msbuildPathArm64 = path.join(info.path, 'MSBuild', 'Current', 'Bin', 'arm64', 'MSBuild.exe');
    if (info.packages.indexOf(pkg) !== -1) {
      this.log.silly('- 找到 VC.MSBuild.Base')
      if (versionYear === 2017) return path.join(info.path, 'MSBuild', '15.0', 'Bin', 'MSBuild.exe');
      if (versionYear === 2019) return msbuildPath;
    }
    /**
     * Visual Studio 2022 没有 MSBuild 包;
     * ARM64 上编译的支持从 MSVC 14.32.31326 起加入,
     * 因此用户设备是 ARM64 时优先使用它;
     */
    if (process.arch === 'arm64' && this.msBuildPathExists(msbuildPathArm64)) return msbuildPathArm64;
    else if (this.msBuildPathExists(msbuildPath)) return msbuildPath;
    return null;
  }

  // 辅助:解析 toolset 信息
  getToolset(info, versionYear) {
    const pkg = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', express = 'Microsoft.VisualStudio.WDExpress';
    if (info.packages.indexOf(pkg) !== -1) this.log.silly('- 找到 VC.Tools.x86.x64');
    else if (info.packages.indexOf(express) !== -1) this.log.silly('- 找到 Visual Studio Express(正在查找工具集)');
    else return null;

    if (versionYear === 2017) return 'v141'
    else if (versionYear === 2019) return 'v142';
    else if (versionYear === 2022) return 'v143';
    else if (versionYear === 2026) return 'v145';
    this.log.silly('- versionYear 无效:', versionYear);
    return null;
  }

  // 辅助:解析 Windows SDK 信息
  getSDK(info) {
    const win8SDK = 'Microsoft.VisualStudio.Component.Windows81SDK',
      win10SDKPrefix = 'Microsoft.VisualStudio.Component.Windows10SDK.',
      win11SDKPrefix = 'Microsoft.VisualStudio.Component.Windows11SDK.';

    let Win10or11SDKVer = 0;
    info.packages.forEach((pkg) => {
      if (!pkg.startsWith(win10SDKPrefix) && !pkg.startsWith(win11SDKPrefix)) return;
      const parts = pkg.split('.')
      if (parts.length > 5 && parts[5] !== 'Desktop') {
        this.log.silly('- 忽略非桌面版 Win10/11SDK:', pkg);
        return;
      }
      const foundSdkVer = parseInt(parts[4], 10);
      if (isNaN(foundSdkVer)) {
        // Microsoft.VisualStudio.Component.Windows10SDK.IpOverUsb
        this.log.silly('- 解析 Win10/11SDK 编号失败:', pkg);
        return;
      }
      this.log.silly('- 找到 Win10/11SDK:', foundSdkVer);
      Win10or11SDKVer = Math.max(Win10or11SDKVer, foundSdkVer);
    })

    if (Win10or11SDKVer !== 0) return `10.0.${Win10or11SDKVer}.0`;
    else if (info.packages.indexOf(win8SDK) !== -1) {
      this.log.silly('- 找到 Win8SDK');
      return '8.1';
    }
    return null;
  }

  // 查找可用的 Visual Studio 2015
  async findVisualStudio2015() {
    if (this.nodeSemver.major >= 19) {
      this.addLog('不查找 VS2015,它只支持到 Node.js 18');
      return null;
    }
    return this.findOldVS({ version: '14.0', versionMajor: 14, versionMinor: 0, versionYear: 2015, toolset: 'v140' });
  }

  // 查找可用的 Visual Studio 2013
  async findVisualStudio2013() {
    if (this.nodeSemver.major >= 9) {
      this.addLog('不查找 VS2013,它只支持到 Node.js 8')
      return null;
    }
    return this.findOldVS({ version: '12.0', versionMajor: 12, versionMinor: 0, versionYear: 2013, toolset: 'v120' });
  }

  // 辅助:VS2013 和 VS2015 的公共代码
  async findOldVS(info) {
    const regVC7 = ['HKLM\\Software\\Microsoft\\VisualStudio\\SxS\\VC7',
      'HKLM\\Software\\Wow6432Node\\Microsoft\\VisualStudio\\SxS\\VC7'],
      regMSBuild = 'HKLM\\Software\\Microsoft\\MSBuild\\ToolsVersions';

    this.addLog(`正在查找 Visual Studio ${info.versionYear}`);
    try {
      let res = await this.regSearchKeys(regVC7, info.version, []);
      const msBuildRegOpts = process.arch === 'ia32' ? [] : ['/reg:32'], vsPath = path.resolve(res, '..');
      this.addLog(`- 发现于 "${vsPath}"`);

      try {
        res = await this.regSearchKeys([`${regMSBuild}\\${info.version}`], 'MSBuildToolsPath', msBuildRegOpts);
      } catch (err) {
        this.addLog('- 在注册表中未找到此版本的 MSBuild');
        return null;
      }

      const msBuild = path.join(res, 'MSBuild.exe');
      this.addLog(`- MSBuild 位于 "${msBuild}"`);

      if (!this.checkConfigVersion(info.versionYear, vsPath)) return null;
      info.path = vsPath, info.msBuild = msBuild, info.sdk = null;
      return info;
    } catch (err) {
      this.addLog('- 未找到');
      return null;
    }
  }

  // 找到可用的 Visual Studio 后:
  // - 把它加入 validVersions,用于在指定版本未找到时输出;
  // - 检查是否是请求的版本;
  // - 检查是否匹配 Visual Studio 命令提示符;
  checkConfigVersion(versionYear, vsPath) {
    this.validVersions.push(versionYear), this.validVersions.push(vsPath);

    if (this.configVersionYear && this.configVersionYear !== versionYear) {
      this.addLog('- msvs_version 与此版本不匹配');
      return false;
    }
    if (this.configPath && path.relative(this.configPath, vsPath) !== '') {
      this.addLog('- msvs_version 未指向此安装');
      return false;
    }
    if (this.envVcInstallDir && path.relative(this.envVcInstallDir, vsPath) !== '') {
      this.addLog('- 与当前 Visual Studio 命令提示符不匹配');
      return false;
    }

    return true;
  }
}

export { VisualStudioFinder };