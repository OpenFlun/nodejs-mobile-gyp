# @flun/nodejs-mobile-gyp

移动端 Node.js 原生模块（Native Addon）的交叉编译工具。

用于为 nodejs-mobile 环境编译 C/C++ 原生模块，支持 Android 与 iOS 的交叉编译。适用于官方 [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) 及兼容的社区发行版（如 [OpenFlun/nodejs-mobile](https://github.com/OpenFlun/nodejs-mobile)）。

宿主平台支持 **Windows** / **macOS** / **Linux**，各平台所需的环境与工具见「[支持的系统与配置要求](#支持的系统与配置要求)」。

[`@flun/nodejs-mobile-react-native`](https://www.npmjs.com/package/@flun/nodejs-mobile-react-native) 在构建时会自动调用本包，无需手动安装。

本包是 [`nodejs-mobile-gyp`](https://github.com/nodejs-mobile/nodejs-mobile-gyp) 的 flun fork，后者又基于上游 [`node-gyp`](https://github.com/nodejs/node-gyp)。

- GitHub：https://github.com/OpenFlun/nodejs-mobile-gyp
- gitee: https://gitee.com/OpenFlun/nodejs-mobile-gyp
- npm：https://www.npmjs.com/package/@flun/nodejs-mobile-gyp

## 项目结构

```txt
@flun/nodejs-mobile-gyp/
│
├── bin/
│   └── node-gyp.js               # CLI 入口（#!/usr/bin/env node），创建 Gyp 实例并依次执行命令队列
│
├── lib/                          # 核心实现，全部为 ESM
│   ├── node-gyp.js               # Gyp 主类：参数解析、命令分发、usage 生成
│   ├── build.js                  # build 命令：调用 make / msbuild 编译原生模块
│   ├── clean.js                  # clean 命令：删除 build 目录
│   ├── configure.js              # configure 命令：下载 headers、生成 config.gypi 与工程文件
│   ├── rebuild.js                # rebuild 命令：依次执行 clean + configure + build
│   ├── install.js                # install 命令：下载并解压指定版本的 Node 开发文件
│   ├── remove.js                 # remove 命令：删除指定版本的 Node 开发文件
│   ├── list.js                   # list 命令：列出已安装的 Node 开发文件版本
│   ├── create-config-gypi.js     # 生成 config.gypi；Windows 上强制 MSVC 工具集、关闭 LTO
│   ├── process-release.js        # 解析下载 URL、本地目录名、headers 与 node.lib 地址
│   ├── download.js               # 基于 make-fetch-happen 的 HTTP 下载与 CA 读取
│   ├── find-node-directory.js    # 推断 Node 安装根目录（用于 AIX / zOS）
│   ├── find-python.js            # PythonFinder 类：动态定位 Python 3.6+（py 启动器 / 目录扫描）
│   ├── find-visualstudio.js      # VisualStudioFinder 类：定位可用的 VS 安装（VS2013+，含 VS2026）
│   ├── Find-VisualStudio.cs      # PowerShell 调用的 C# 脚本，枚举 VS 安装信息
│   ├── log.js                    # Logger 类 + proc-log 包装，分级着色日志
│   └── util.js                   # 通用工具：execFile 包装、注册表读取、候选文件查找
│
├── gyp/                          # 内置的 gyp 工具（Python）
│   ├── gyp                       # Python 启动脚本（Unix）
│   ├── gyp.bat                   # Python 启动脚本（Windows）
│   ├── gyp_main.py               # gyp 主入口
│   ├── LICENSE                   # gyp 自身的许可证
│   ├── pylib/gyp/                # gyp 核心 Python 模块
│   │   ├── input.py              # 解析 .gyp / .gypi 文件
│   │   ├── common.py             # 通用工具
│   │   ├── MSVS*.py              # MSBuild / VS 工程生成
│   │   ├── msvs_emulation.py     # VS 配置模拟
│   │   ├── xcode*.py             # Xcode 工程生成
│   │   ├── mac_tool.py           # macOS 工具链
│   │   ├── win_tool.py           # Windows 工具链
│   │   └── generator/            # 各类生成器后端（make / msvs / ninja / xcode / cmake ...）
│   ├── pylib/packaging/          # gyp 依赖的 Python packaging 库（vendored）
│   └── data/win/
│       └── large-pdb-shim.cc     # Windows 大 PDB 兼容编译单元
│
├── src/
│   └── win_delay_load_hook.cc    # Windows 加载延迟钩子（编译进每个原生模块）
│
├── addon.gypi                    # 所有原生模块共用的 gyp 配置
├── package.json                  # type: module，bin 命令名为 nodejs-mobile-gyp
├── LICENSE                       # 本包许可证（ISC）
├── README.md                     # 本文件
├── CHANGELOG.md                  # 版本变更记录
├── .gitignore                    # Git 忽略规则
├── .npmignore                    # npm 发布排除规则
├── .gitattributes                # Git 换行符 / 二进制标记
└── macOS_Catalina_acid_test.sh   # macOS Catalina 兼容性验证脚本（仅本地开发，不随包发布）
```

## 本 fork 的改动

本 fork 在功能上与原版 `nodejs-mobile-gyp` 一致，做了以下改造。

### 代码风格

| 项       | 原版                    | 本 fork                                       |
| -------- | ----------------------- | --------------------------------------------- |
| 模块系统 | CommonJS                | **ESM**（`package.json` 的 `type: "module"`） |
| 导出方式 | 文件内 `module.exports` | **末尾统一 `export { ... }`**                 |
| 函数声明 | `async function xxx`    | `const xxx = async () =>`（`class` 保留）     |
| 注释     | 英文                    | 中文                                          |

### 依赖升级

| 包                  | 原版       | 本 fork   | 原因                                         |
| ------------------- | ---------- | --------- | -------------------------------------------- |
| `tar`               | `^6.1.2`   | `^7.5.22` | 上游 v6 停更，有安全公告                     |
| `glob`              | `^10.3.10` | `^13.0.6` | 上游 v10 停更                                |
| `make-fetch-happen` | `^13.0.0`  | `^16.0.1` | 连带升级 `cacache`，去掉 `tar@6` / `glob@10` |

升级后依赖树干净，`npm audit` 0 vulnerabilities。

### Windows 构建适配

原版 `nodejs-mobile-gyp` 在 Windows 上有若干问题，本 fork 逐一解决，涉及三方面。

#### 1. 工具集与 LTO

原版默认走 ClangCL 工具集，且继承 Node 官方二进制的 LTO 配置。Node.js 24+ 官方二进制由 ClangCL + ThinLTO 编译，其 `common.gypi` 会在 `clang==1` 时把 MSBuild 工具集设为 `ClangCL`，并在 `enable_lto==true` / `enable_thin_lto==true` 时向链接器传入 `-flto=thin`、`/opt:lldltojobs` 等 Clang 专用参数。若用户本机没装 ClangCL，或用的是传统 MSVC 工具链，会报：

- `MSB8020: 无法找到 ClangCL 的生成工具`
- `LNK1117: 选项"opt:lldltojobs=2"中的语法错误`

本 fork 强制走 MSVC 工具集并关闭 LTO，避免上述报错。工具集版本从 `find-visualstudio` 的探测结果**动态获取**（`v140` / `v141` / `v142` / `v143` / `v145`...），不写死。

#### 2. GNU make 的 POSIX 环境

Android 原生模块通过 GNU make 构建，其 Makefile 会调用 `printf`、`xargs`、`sed` 等 Unix 命令。GNU make 需要一个 POSIX shell（`sh.exe`）来执行它们；Windows 上若无，会直接报 `CreateProcess(NULL, printf ...) failed`。Git for Windows 自带整套 POSIX 工具集；本 fork 会自动定位其 `usr/bin` 并前置到 PATH，详见「[支持的系统与配置要求](#支持的系统与配置要求) → 自动探测」。

#### 3. 路径分隔符

gyp 生成的 Makefile 中，路径原本会带上 Windows 的反斜杠（如 `src\bufferutil.o`），导致 `sh` / `sed` / `make` 解析失败。本 fork 在 gyp 的路径生成环节统一转成正斜杠；该改动在非 Windows 平台上是 no-op。

### 具体改动清单

#### 构建工具链

| 文件                            | 改动                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/create-config-gypi.js`     | 生成 `config.gypi` 时把 `clang` 置 0、`enable_lto` / `enable_thin_lto` 置 `'false'`、`lto_jobs` 置空，避免 `common.gypi` 切到 ClangCL 并向 MSVC 传 LTO 参数 |
| `lib/configure.js`              | 调用 gyp 时追加 `-Gmsvs_toolset=<探测到的 toolset>`，不再写死 `v145`                                                                                        |
| `lib/find-visualstudio.js`      | 支持 VS2013+，含最新 VS2026（版本号 18，`versionYear=2026`，toolset `v145`）                                                                                |
| `gyp/pylib/gyp/MSVSSettings.py` | 注册 `ExternalWarningLevel`（MSBuild 属性），供 `addon.gypi` 使用                                                                                           |
| `addon.gypi`                    | Windows 下追加 `/external:anglebrackets` + `ExternalWarningLevel: TurnOffAllWarnings`，只静音外部头（Node / V8）的警告                                      |

#### 跨平台路径

| 文件                              | 改动                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `gyp/pylib/gyp/common.py`         | `RelativePath` 返回值统一转正斜杠                                                                           |
| `gyp/pylib/gyp/generator/make.py` | `Absolutify` 返回正斜杠；新增 `slashpath` 供 `mkdir` 使用；Windows 下跳过 `node_modules` 中的超长 gypi 依赖 |

#### Windows 运行时探测

| 文件                 | 改动                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lib/find-python.js` | 重写：移除硬编码版本列表，改为 `py.exe` 候选 + `py -0p` 枚举 + 目录扫描；`run()` 显式检查 `execFile` 的 err    |
| `lib/build.js`       | 区分「宿主 Windows」与「Android 交叉编译」；自动探测 `sh.exe` 并前置到 PATH；为 Python 创建 `python3.cmd` shim |

#### 兼容性与健壮性

- **`proc-log` 新版本兼容**：新版把日志级别函数与 `pause` / `resume` 挂在默认导出的 `log` 对象下。本 fork 已按此调整 `lib/log.js`，否则 `configure` 阶段会抛 `TypeError`。
- **弃用 API 清理**：`lib/process-release.js` 不再用 `url.resolve()` / `url.parse()`，改用 WHATWG `URL`，消除 `DEP0169` 警告。
- **依赖脚本放行**：`package.json` 显式声明 `allowScripts`，适配新版 npm 默认禁止依赖执行安装脚本的行为。


### 迁移踩过的坑

1. **`graceful-fs` 是 CJS，命名导入会失败**
   写成 `import gracefulFs from 'graceful-fs'`，再从 default 解构 `const { openSync, closeSync } = gracefulFs`。

2. **`tar@7` 没有 default export**
   写成 `import * as tar from 'tar'`。

3. **`proc-log` 的解构**
   `import procLog from 'proc-log'`，再把需要的函数从 default 里解构后统一导出。

4. **PowerShell 写文件会加 BOM**
   `Set-Content -Encoding UTF8` 会写入 `\uFEFF`，导致 gyp 的 `eval()` 报 `SyntaxError: invalid non-printable character U+FEFF`。写 `binding.gyp` 等交给 Python eval 的文件时，用 `[System.IO.File]::WriteAllText` + `New-Object System.Text.UTF8Encoding $false`。

5. **ESM 不支持动态 `require('./' + command)`**
   `lib/node-gyp.js` 原本用 `require('./' + command)` 动态加载命令模块，ESM 下改为在顶部静态 import 所有命令，再用静态映射表组装 `this.commands`。

6. **`__dirname` / `__filename` 在 ESM 中不存在**
   用 `fileURLToPath(import.meta.url)` 重建。

7. **非 Windows 平台不引入 `find-visualstudio.js`**
   该模块依赖 Windows 专属的 `path.win32` 和注册表操作，保持原版的"仅在 Windows 上条件加载"逻辑。

## 支持的系统与配置要求

本包面向 **Android / iOS 交叉编译**，宿主平台支持情况：

| 宿主平台 | 目标：Android | 目标：iOS  |
| -------- | ------------- | ---------- |
| Windows  | ✅ 完整支持    | ❌ 需 macOS |
| macOS    | ✅ 完整支持    | ✅ 完整支持 |
| Linux    | ✅ 完整支持    | ❌ 需 macOS |

各平台所需的构建环境如下。

### 通用要求

- **Node.js**：最低版本见 `package.json` 的 `engines.node` 字段
- **Python 3.6+**：gyp 本身是 Python 程序，构建时必需
- **目标平台 SDK**：
  - Android：Android NDK（**23–27 已验证**）
  - iOS：完整 Xcode（仅 macOS；Command Line Tools 单独不够）

### Windows

| 组件            | 要求                                    | 说明                                                        |
| --------------- | --------------------------------------- | ----------------------------------------------------------- |
| Node.js         | 见 `engines.node`                       |                                                             |
| Python          | 3.6+                                    | 支持任意安装位置，见下方「自动探测」                        |
| Visual Studio   | **VS2019 / VS2022 / VS2026**（2026 已验证） | 需勾选「使用 C++ 的桌面开发」工作负载，含 Windows SDK；VS2017 及更早受 Node 版本上限限制 |
| Android NDK     | **23–27**（已验证）                          | 由 `@flun/nodejs-mobile-react-native` 自动定位              |
| Git for Windows | 任意近期版本                            | 自带**整套 MSYS2 POSIX 工具集**（`sh.exe`、`printf`、`xargs`、`sed`、`rm`、`mkdir` 等数十个命令），GNU make 执行 Makefile 所依赖的 Unix 命令均由它提供；位置自动探测（见下方） |

> **为什么需要 Git for Windows？** Android 原生模块通过 GNU make 构建，Makefile 中会调用 `printf`、`xargs`、`sed` 等 Unix 命令。这些命令并非 Windows 自带，GNU make 需要一个 POSIX 环境来执行它们。Git for Windows 自带**整套 MSYS2 POSIX 工具集**（`sh.exe`、`printf`、`xargs`、`sed`、`rm`、`mkdir` 等数十个命令），无需额外安装 MSYS2 或 Cygwin。

### macOS

| 组件        | 要求                             |
| ----------- | -------------------------------- |
| Node.js     | 见 `engines.node`                |
| Python      | 3.6+                             |
| Xcode       | 完整 Xcode（必须，CLT 单独不够） |
| Android NDK | 仅构建 Android 目标时需 23–27     |

### Linux

| 组件        | 要求                                                   |
| ----------- | ------------------------------------------------------ |
| Node.js     | 见 `engines.node`                                      |
| Python      | 3.6+                                                   |
| 构建工具    | `make`、`g++`（`apt install build-essential python3`） |
| Android NDK | 仅构建 Android 目标时需 23–27                           |

### 自动探测（Windows）

以下工具的**安装位置**由本包动态探测，**无需手动指定路径**（前提：工具已安装）：

- **Python**，依次尝试：
  1. `NODE_GYP_FORCE_PYTHON` 环境变量
  2. 命令行 `--python=`
  3. `PYTHON` 环境变量
  4. `py.exe` 启动器（PATH 中、`%SystemRoot%\py.exe`、`%SystemRoot%\System32\py.exe`）
  5. `py -0p` 枚举所有已注册 Python
  6. `python3` / `python` 命令
  7. 扫描 `%LOCALAPPDATA%\Programs\Python\Python*` 与 `%ProgramFiles%\Python*`

- **Git for Windows 的 `usr/bin` 目录**（POSIX 工具集所在处，以 `sh.exe` 是否存在作为判据），依次尝试：
  1. 注册表 `HKLM\SOFTWARE\GitForWindows` 的 `InstallPath`
  2. `which git` 反推 `../usr/bin`
  3. `PATH` 中的 `git.exe` 反推 `../usr/bin`
  4. 常见安装位置兜底

- **Android NDK**：由 `@flun/nodejs-mobile-react-native` 通过 `android.ndkDirectory` 定位，并注入 `make.exe`、`clang` 等工具路径。

> 本包不依赖任何随包分发的硬编码配置文件。上述探测均为运行时动态完成；仅 Visual Studio 的「版本号 → 版本年份 → toolset」对照表以常量形式内联在 `lib/find-visualstudio.js` 中——这类信息由微软固定发布，无枚举接口，且随 VS 版本发布而更新，不适合做成外部资源。


## 安装

```bash
npm i @flun/nodejs-mobile-gyp
```

通常你不需要手动安装本包——它由 [`@flun/nodejs-mobile-react-native`](https://www.npmjs.com/package/@flun/nodejs-mobile-react-native) 在编译原生模块时自动调用。

> **Node 版本要求**：本 fork 的依赖链（`make-fetch-happen`、`nopt`、`proc-log`、`which` 等）已升级到较新版本，要求比原版 `nodejs-mobile-gyp` 更高的 Node。具体最低版本见 `package.json` 的 `engines.node` 字段。若你的项目仍在使用较旧的 Node，请改用原版 `nodejs-mobile-gyp`。

## 使用

### 命令行

```bash
npx @flun/nodejs-mobile-gyp <command> [options]
```

或在 `package.json` 的 `scripts` 中调用：

```json
{
  "scripts": {
    "build-addon": "nodejs-mobile-gyp rebuild"
  }
}
```

### 从 Node.js 代码调用

本包主要作为 CLI 工具使用，推荐通过 spawn / execFile 调用其命令行入口。包本身也导出了 Gyp 类，但属于内部实现，接口可能随版本变化，不建议直接在代码中依赖。

## 命令

| 命令        | 说明                                     |
| ----------- | ---------------------------------------- |
| `help`      | 显示帮助                                 |
| `build`     | 调用 `make` / `msbuild.exe` 编译原生模块 |
| `clean`     | 删除 `build` 目录（若存在）              |
| `configure` | 为当前平台生成工程构建文件               |
| `rebuild`   | 依次执行 `clean` → `configure` → `build` |
| `install`   | 为指定版本安装 Node.js 头文件            |
| `list`      | 列出已安装的 Node.js 头文件版本          |
| `remove`    | 删除指定版本的 Node.js 头文件            |

## 命令选项

| 选项                              | 说明                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `-v`, `--version`                 | 打印本包版本号                                                                               |
| `-j n`, `--jobs n`                | 并行运行 `make`；`max` 表示使用所有 CPU 核心                                                 |
| `--target=v6.2.1`                 | 目标 Node.js 版本（默认 `process.version`）                                                  |
| `--silly`, `--loglevel=silly`     | 输出全部进度日志                                                                             |
| `--verbose`, `--loglevel=verbose` | 输出大部分进度日志                                                                           |
| `--silent`, `--loglevel=silent`   | 不输出任何日志                                                                               |
| `debug`, `--debug`                | 生成 Debug 构建（默认 Release）                                                              |
| `--release`, `--no-debug`         | 生成 Release 构建                                                                            |
| `-C $dir`, `--directory=$dir`     | 在指定目录运行命令                                                                           |
| `--make=$make`                    | 覆盖 `make` 命令（如 `gmake`）                                                               |
| `--thin=yes`                      | 启用 thin 静态库                                                                             |
| `--arch=$arch`                    | 目标架构（如 `ia32`）                                                                        |
| `--tarball=$path`                 | 从本地 tarball 获取头文件                                                                    |
| `--devdir=$path`                  | SDK 下载目录（默认为系统缓存目录）                                                           |
| `--ensure`                        | 已存在的头文件不重装                                                                         |
| `--dist-url=$url`                 | 从自定义 URL 下载头文件 tarball                                                              |
| `--proxy=$url`                    | 下载时使用 HTTP(S) 代理                                                                      |
| `--noproxy=$urls`                 | 下载时忽略代理的 URL 列表                                                                    |
| `--cafile=$cafile`                | 覆盖默认 CA 链（用于下载 tarball）                                                           |
| `--nodedir=$path`                 | 指定 Node 源码路径                                                                           |
| `--python=$path`                  | 指定 Python 二进制路径                                                                       |
| `--msvs_version=$version`         | 指定 Visual Studio 版本或安装路径（仅 Windows；可填 `2022` / `2026` 或 `C:\...\BuildTools`） |
| `--solution=$solution`            | 指定 Visual Studio Solution 版本（仅 Windows）                                               |
| `--force-process-config`          | 强制用运行时的 `process.config` 生成 `config.gypi`                                           |

## 配置

### 环境变量

上表中的所有命令选项，都可以用 `npm_config_OPTION_NAME` 形式的**环境变量**来设置（选项名中的 `-` 替换为 `_`）。

例如，把 `devdir` 设为 `/tmp/.gyp`：

Unix：
```bash
export npm_config_devdir=/tmp/.gyp
```

Windows：
```console
set npm_config_devdir=c:\temp\.gyp
```

### npm 配置（npm v9 之前）

用 `OPTION_NAME` 形式：

```bash
npm config set [--global] devdir /tmp/.gyp
```

**注意**：通过 `npm config` 设置的配置，只在本包 **由 npm 调用时**生效，直接运行 `nodejs-mobile-gyp` 不生效。

## 上游参考

本包是 `node-gyp` 的 fork。上游完整文档（含更多高级用法、`binding.gyp` 语法、跨平台细节）请见：

- [nodejs/node-gyp README](https://github.com/nodejs/node-gyp#readme)
- [gyp 用户文档](https://gyp.gsrc.io/docs/UserDocumentation.md)
- [gyp 输入格式参考](https://gyp.gsrc.io/docs/InputFormatReference.md)

## 许可

ISC