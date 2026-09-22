import * as log from './log.js'
import { existsSync } from 'fs'
import nodePath from 'path'
import { fileURLToPath } from 'url'
import { regSearchKeys, execFile } from './util.js'

const path = nodePath.win32
const __dirname = nodePath.dirname(fileURLToPath(import.meta.url))

/**
 * Visual Studio 查找器：定位可用的 VS 安装
 */
class VisualStudioFinder {
  static findVisualStudio = (...args) => new VisualStudioFinder(...args).findVisualStudio()

  log = log.withPrefix('find VS')

  regSearchKeys = regSearchKeys

  constructor (nodeSemver, configMsvsVersion) {
    this.nodeSemver = nodeSemver
    this.configMsvsVersion = configMsvsVersion
    this.errorLog = []
    this.validVersions = []
  }

  // 以 verbose 级别记录日志，同时保存下来，出错时以 error 级别展示，便于诊断
  addLog (message) {
    this.log.verbose(message)
    this.errorLog.push(message)
  }

  async findVisualStudio () {
    this.configVersionYear = null
    this.configPath = null
    if (this.configMsvsVersion) {
      this.addLog('msvs_version was set from command line or npm config')
      if (this.configMsvsVersion.match(/^\d{4}$/)) {
        this.configVersionYear = parseInt(this.configMsvsVersion, 10)
        this.addLog(
          `- looking for Visual Studio version ${this.configVersionYear}`)
      } else {
        this.configPath = path.resolve(this.configMsvsVersion)
        this.addLog(
          `- looking for Visual Studio installed in "${this.configPath}"`)
      }
    } else {
      this.addLog('msvs_version not set from command line or npm config')
    }

    if (process.env.VCINSTALLDIR) {
      this.envVcInstallDir =
        path.resolve(process.env.VCINSTALLDIR, '..')
      this.addLog('running in VS Command Prompt, installation path is:\n' +
        `"${this.envVcInstallDir}"\n- will only use this version`)
    } else {
      this.addLog('VCINSTALLDIR not set, not running in VS Command Prompt')
    }

    const checks = [
      () => this.findVisualStudio2017OrNewer(),
      () => this.findVisualStudio2015(),
      () => this.findVisualStudio2013()
    ]

    for (const check of checks) {
      const info = await check()
      if (info) {
        return this.succeed(info)
      }
    }

    return this.fail()
  }

  succeed (info) {
    this.log.info(`using VS${info.versionYear} (${info.version}) found at:` +
                  `\n"${info.path}"` +
                  '\nrun with --verbose for detailed information')
    return info
  }

  fail () {
    if (this.configMsvsVersion && this.envVcInstallDir) {
      this.errorLog.push(
        'msvs_version does not match this VS Command Prompt or the',
        'installation cannot be used.')
    } else if (this.configMsvsVersion) {
      // 指定了 msvs_version 但没找到 VS，输出可接受的版本
      this.errorLog.push('')
      if (this.validVersions) {
        this.errorLog.push('valid versions for msvs_version:')
        this.validVersions.forEach((version) => {
          this.errorLog.push(`- "${version}"`)
        })
      } else {
        this.errorLog.push('no valid versions for msvs_version were found')
      }
    }

    const errorLog = this.errorLog.join('\n')

    // Windows 80 列控制台，用到 X 标记列之前（含日志前缀共 79 字符，可用 62 字符）：
    //                                                               X
    const infoLog = [
      '**************************************************************',
      'You need to install the latest version of Visual Studio',
      'including the "Desktop development with C++" workload.',
      'For more information consult the documentation at:',
      'https://github.com/nodejs/node-gyp#on-windows',
      '**************************************************************'
    ].join('\n')

    this.log.error(`\n${errorLog}\n\n${infoLog}\n`)
    throw new Error('Could not find any Visual Studio installation to use')
  }

  // 调用 PowerShell 脚本，获取 Visual Studio 2017 或更新版本的信息
  async findVisualStudio2017OrNewer () {
    const ps = path.join(process.env.SystemRoot, 'System32',
      'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const csFile = path.join(__dirname, 'Find-VisualStudio.cs')
    const psArgs = [
      '-ExecutionPolicy',
      'Unrestricted',
      '-NoProfile',
      '-Command',
      '&{Add-Type -Path \'' + csFile + '\';' + '[VisualStudioConfiguration.Main]::PrintJson()}'
    ]

    this.log.silly('Running', ps, psArgs)
    const [err, stdout, stderr] = await execFile(ps, psArgs, { encoding: 'utf8' })
    return this.parseData(err, stdout, stderr)
  }

  // 解析 PowerShell 脚本输出，寻找可用的 Visual Studio 2017 或更新版本
  parseData (err, stdout, stderr) {
    this.log.silly('PS stderr = %j', stderr)

    const failPowershell = () => {
      this.addLog(
        'could not use PowerShell to find Visual Studio 2017 or newer, try re-running with \'--loglevel silly\' for more details')
      return null
    }

    if (err) {
      this.log.silly('PS err = %j', err && (err.stack || err))
      return failPowershell()
    }

    let vsInfo
    try {
      vsInfo = JSON.parse(stdout)
    } catch (e) {
      this.log.silly('PS stdout = %j', stdout)
      this.log.silly(e)
      return failPowershell()
    }

    if (!Array.isArray(vsInfo)) {
      this.log.silly('PS stdout = %j', stdout)
      return failPowershell()
    }

    vsInfo = vsInfo.map((info) => {
      this.log.silly(`processing installation: "${info.path}"`)
      info.path = path.resolve(info.path)
      const ret = this.getVersionInfo(info)
      ret.path = info.path
      ret.msBuild = this.getMSBuild(info, ret.versionYear)
      ret.toolset = this.getToolset(info, ret.versionYear)
      ret.sdk = this.getSDK(info)
      return ret
    })
    this.log.silly('vsInfo:', vsInfo)

    // 去掉未来版本或版本号解析失败的项
    vsInfo = vsInfo.filter((info) => {
      if (info.versionYear) {
        return true
      }
      this.addLog(`unknown version "${info.version}" found at "${info.path}"`)
      return false
    })

    // 排序：新版本在前
    vsInfo.sort((a, b) => b.versionYear - a.versionYear)

    for (let i = 0; i < vsInfo.length; ++i) {
      const info = vsInfo[i]
      this.addLog(`checking VS${info.versionYear} (${info.version}) found ` +
                  `at:\n"${info.path}"`)

      if (info.msBuild) {
        this.addLog('- found "Visual Studio C++ core features"')
      } else {
        this.addLog('- "Visual Studio C++ core features" missing')
        continue
      }

      if (info.toolset) {
        this.addLog(`- found VC++ toolset: ${info.toolset}`)
      } else {
        this.addLog('- missing any VC++ toolset')
        continue
      }

      if (info.sdk) {
        this.addLog(`- found Windows SDK: ${info.sdk}`)
      } else {
        this.addLog('- missing any Windows SDK')
        continue
      }

      if (!this.checkConfigVersion(info.versionYear, info.path)) {
        continue
      }

      return info
    }

    this.addLog(
      'could not find a version of Visual Studio 2017 or newer to use')
    return null
  }

  // 辅助：解析版本信息
  getVersionInfo (info) {
    const match = /^(\d+)\.(\d+)\..*/.exec(info.version)
    if (!match) {
      this.log.silly('- failed to parse version:', info.version)
      return {}
    }
    this.log.silly('- version match = %j', match)
    const ret = {
      version: info.version,
      versionMajor: parseInt(match[1], 10),
      versionMinor: parseInt(match[2], 10)
    }
    if (ret.versionMajor === 15) {
      ret.versionYear = 2017
      return ret
    }
    if (ret.versionMajor === 16) {
      ret.versionYear = 2019
      return ret
    }
    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)
    return {}
  }

  msBuildPathExists (path) {
    return existsSync(path)
  }

  // 辅助：解析 MSBuild 信息
  getMSBuild (info, versionYear) {
    const pkg = 'Microsoft.VisualStudio.VC.MSBuild.Base'
    const msbuildPath = path.join(info.path, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe')
    const msbuildPathArm64 = path.join(info.path, 'MSBuild', 'Current', 'Bin', 'arm64', 'MSBuild.exe')
    if (info.packages.indexOf(pkg) !== -1) {
      this.log.silly('- found VC.MSBuild.Base')
      if (versionYear === 2017) {
        return path.join(info.path, 'MSBuild', '15.0', 'Bin', 'MSBuild.exe')
      }
      if (versionYear === 2019) {
        return msbuildPath
      }
    }
    /**
     * Visual Studio 2022 没有 MSBuild 包。
     * ARM64 上编译的支持从 MSVC 14.32.31326 起加入，
     * 因此用户设备是 ARM64 时优先使用它。
     */
    if (process.arch === 'arm64' && this.msBuildPathExists(msbuildPathArm64)) {
      return msbuildPathArm64
    } else if (this.msBuildPathExists(msbuildPath)) {
      return msbuildPath
    }
    return null
  }

  // 辅助：解析 toolset 信息
  getToolset (info, versionYear) {
    const pkg = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
    const express = 'Microsoft.VisualStudio.WDExpress'

    if (info.packages.indexOf(pkg) !== -1) {
      this.log.silly('- found VC.Tools.x86.x64')
    } else if (info.packages.indexOf(express) !== -1) {
      this.log.silly('- found Visual Studio Express (looking for toolset)')
    } else {
      return null
    }

    if (versionYear === 2017) {
      return 'v141'
    } else if (versionYear === 2019) {
      return 'v142'
    } else if (versionYear === 2022) {
      return 'v143'
    } else if (versionYear === 2026) {
      return 'v145'
    }
    this.log.silly('- invalid versionYear:', versionYear)
    return null
  }

  // 辅助：解析 Windows SDK 信息
  getSDK (info) {
    const win8SDK = 'Microsoft.VisualStudio.Component.Windows81SDK'
    const win10SDKPrefix = 'Microsoft.VisualStudio.Component.Windows10SDK.'
    const win11SDKPrefix = 'Microsoft.VisualStudio.Component.Windows11SDK.'

    let Win10or11SDKVer = 0
    info.packages.forEach((pkg) => {
      if (!pkg.startsWith(win10SDKPrefix) && !pkg.startsWith(win11SDKPrefix)) {
        return
      }
      const parts = pkg.split('.')
      if (parts.length > 5 && parts[5] !== 'Desktop') {
        this.log.silly('- ignoring non-Desktop Win10/11SDK:', pkg)
        return
      }
      const foundSdkVer = parseInt(parts[4], 10)
      if (isNaN(foundSdkVer)) {
        // Microsoft.VisualStudio.Component.Windows10SDK.IpOverUsb
        this.log.silly('- failed to parse Win10/11SDK number:', pkg)
        return
      }
      this.log.silly('- found Win10/11SDK:', foundSdkVer)
      Win10or11SDKVer = Math.max(Win10or11SDKVer, foundSdkVer)
    })

    if (Win10or11SDKVer !== 0) {
      return `10.0.${Win10or11SDKVer}.0`
    } else if (info.packages.indexOf(win8SDK) !== -1) {
      this.log.silly('- found Win8SDK')
      return '8.1'
    }
    return null
  }

  // 查找可用的 Visual Studio 2015
  async findVisualStudio2015 () {
    if (this.nodeSemver.major >= 19) {
      this.addLog(
        'not looking for VS2015 as it is only supported up to Node.js 18')
      return null
    }
    return this.findOldVS({
      version: '14.0',
      versionMajor: 14,
      versionMinor: 0,
      versionYear: 2015,
      toolset: 'v140'
    })
  }

  // 查找可用的 Visual Studio 2013
  async findVisualStudio2013 () {
    if (this.nodeSemver.major >= 9) {
      this.addLog(
        'not looking for VS2013 as it is only supported up to Node.js 8')
      return null
    }
    return this.findOldVS({
      version: '12.0',
      versionMajor: 12,
      versionMinor: 0,
      versionYear: 2013,
      toolset: 'v120'
    })
  }

  // 辅助：VS2013 和 VS2015 的公共代码
  async findOldVS (info) {
    const regVC7 = ['HKLM\\Software\\Microsoft\\VisualStudio\\SxS\\VC7',
      'HKLM\\Software\\Wow6432Node\\Microsoft\\VisualStudio\\SxS\\VC7']
    const regMSBuild = 'HKLM\\Software\\Microsoft\\MSBuild\\ToolsVersions'

    this.addLog(`looking for Visual Studio ${info.versionYear}`)
    try {
      let res = await this.regSearchKeys(regVC7, info.version, [])
      const vsPath = path.resolve(res, '..')
      this.addLog(`- found in "${vsPath}"`)
      const msBuildRegOpts = process.arch === 'ia32' ? [] : ['/reg:32']

      try {
        res = await this.regSearchKeys([`${regMSBuild}\\${info.version}`], 'MSBuildToolsPath', msBuildRegOpts)
      } catch (err) {
        this.addLog('- could not find MSBuild in registry for this version')
        return null
      }

      const msBuild = path.join(res, 'MSBuild.exe')
      this.addLog(`- MSBuild in "${msBuild}"`)

      if (!this.checkConfigVersion(info.versionYear, vsPath)) {
        return null
      }

      info.path = vsPath
      info.msBuild = msBuild
      info.sdk = null
      return info
    } catch (err) {
      this.addLog('- not found')
      return null
    }
  }

  // 找到可用的 Visual Studio 后：
  // - 把它加入 validVersions，用于在指定版本未找到时输出；
  // - 检查是否是请求的版本；
  // - 检查是否匹配 Visual Studio 命令提示符。
  checkConfigVersion (versionYear, vsPath) {
    this.validVersions.push(versionYear)
    this.validVersions.push(vsPath)

    if (this.configVersionYear && this.configVersionYear !== versionYear) {
      this.addLog('- msvs_version does not match this version')
      return false
    }
    if (this.configPath &&
        path.relative(this.configPath, vsPath) !== '') {
      this.addLog('- msvs_version does not point to this installation')
      return false
    }
    if (this.envVcInstallDir &&
        path.relative(this.envVcInstallDir, vsPath) !== '') {
      this.addLog('- does not match this Visual Studio Command Prompt')
      return false
    }

    return true
  }
}

export { VisualStudioFinder }
