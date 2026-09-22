# @flun/nodejs-mobile-gyp

移动端 Node.js 原生模块（Native Addon）的交叉编译工具。

用于为 [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) 环境编译 C/C++ 原生模块，支持 Android 与 iOS 的交叉编译。

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
│   ├── find-python.js            # PythonFinder 类：按顺序定位可用的 Python 3.6+
│   ├── find-visualstudio.js      # VisualStudioFinder 类：定位可用的 VS 安装（含 VS2026）
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
├── package.json                  # type: module，bin 指向 bin/node-gyp.js
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

原版在 Windows 上默认走 ClangCL 工具集，且继承 Node 官方二进制的 LTO 配置。Node.js 24+ 官方二进制由 ClangCL + ThinLTO 编译，其 `common.gypi` 会在 `clang==1` 时把 MSBuild 工具集设为 `ClangCL`，并在 `enable_lto==true` / `enable_thin_lto==true` 时向链接器传入 `-flto=thin`、`/opt:lldltojobs` 等 Clang 专用参数。若用户本机没装 ClangCL，或用的是传统 MSVC 工具链，会报以下错误：

- `MSB8020: 无法找到 ClangCL 的生成工具`
- `LNK1117: 选项"opt:lldltojobs=2"中的语法错误`

本 fork 强制走 MSVC 工具集并关闭 LTO，避免上述报错。

### 具体改动清单

| 文件                        | 改动                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/create-config-gypi.js` | 生成 `config.gypi` 时，把 `clang` 置 0，`enable_lto` / `enable_thin_lto` 置 `'false'`，`lto_jobs` 置空。避免 `common.gypi` 把工具集改成 ClangCL、向 MSVC 传 LTO 参数 |
| `lib/configure.js`          | 调用 gyp 时追加 `-Gmsvs_toolset=v145`，显式指定 VS2026 工具集                                                                                                        |
| `lib/find-visualstudio.js`  | 支持 VS2026（版本号 18，`versionYear=2026`，toolset `v145`）                                                                                                         |

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

## 安装

```bash
npm install @flun/nodejs-mobile-gyp
```

通常你不需要手动安装本包——它由 [`@flun/nodejs-mobile-react-native`](https://www.npmjs.com/package/@flun/nodejs-mobile-react-native) 在编译原生模块时自动调用。

## 使用

### 命令行

```bash
npx node-gyp <command> [options]
```

或在 `package.json` 的 `scripts` 中调用：

```json
{
  "scripts": {
    "build-addon": "node-gyp rebuild"
  }
}
```

### 从 Node.js 代码调用

```js
import createGyp from '@flun/nodejs-mobile-gyp'

const gyp = createGyp()
gyp.parseArgv(process.argv)
// gyp.todo 是待执行的命令队列
```

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

| 选项                              | 说明                                               |
| --------------------------------- | -------------------------------------------------- |
| `-j n`, `--jobs n`                | 并行运行 `make`；`max` 表示使用所有 CPU 核心       |
| `--target=v6.2.1`                 | 目标 Node.js 版本（默认 `process.version`）        |
| `--silly`, `--loglevel=silly`     | 输出全部进度日志                                   |
| `--verbose`, `--loglevel=verbose` | 输出大部分进度日志                                 |
| `--silent`, `--loglevel=silent`   | 不输出任何日志                                     |
| `debug`, `--debug`                | 生成 Debug 构建（默认 Release）                    |
| `--release`, `--no-debug`         | 生成 Release 构建                                  |
| `-C $dir`, `--directory=$dir`     | 在指定目录运行命令                                 |
| `--make=$make`                    | 覆盖 `make` 命令（如 `gmake`）                     |
| `--thin=yes`                      | 启用 thin 静态库                                   |
| `--arch=$arch`                    | 目标架构（如 `ia32`）                              |
| `--tarball=$path`                 | 从本地 tarball 获取头文件                          |
| `--devdir=$path`                  | SDK 下载目录（默认为系统缓存目录）                 |
| `--ensure`                        | 已存在的头文件不重装                               |
| `--dist-url=$url`                 | 从自定义 URL 下载头文件 tarball                    |
| `--proxy=$url`                    | 下载时使用 HTTP(S) 代理                            |
| `--noproxy=$urls`                 | 下载时忽略代理的 URL 列表                          |
| `--cafile=$cafile`                | 覆盖默认 CA 链（用于下载 tarball）                 |
| `--nodedir=$path`                 | 指定 Node 源码路径                                 |
| `--python=$path`                  | 指定 Python 二进制路径                             |
| `--msvs_version=$version`         | 指定 Visual Studio 版本（仅 Windows）              |
| `--solution=$solution`            | 指定 Visual Studio Solution 版本（仅 Windows）     |
| `--force-process-config`          | 强制用运行时的 `process.config` 生成 `config.gypi` |

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

**注意**：通过 `npm config` 设置的配置，只在 `node-gyp` **由 npm 调用时**生效，直接运行 `node-gyp` 不生效。

## 上游参考

本包是 `node-gyp` 的 fork。上游完整文档（含更多高级用法、`binding.gyp` 语法、跨平台细节）请见：

- [nodejs/node-gyp README](https://github.com/nodejs/node-gyp#readme)
- [gyp 用户文档](https://gyp.gsrc.io/docs/UserDocumentation.md)
- [gyp 输入格式参考](https://gyp.gsrc.io/docs/InputFormatReference.md)

## 许可

ISC