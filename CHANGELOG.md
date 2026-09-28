# Changelog

## [1.1.2] - 2026-09-28 21:49

### 修复

- **action 目标的路径分隔符**：`make.py` 中 `self.output` 由 `ComputeOutput` 产出，Windows 上带反斜杠（如 `$(obj).target\../node-addon-api\foo.stamp`），导致 `sh` 把 `\.` 当转义、目录不存在。现统一转正斜杠；非 Windows 平台为 no-op。

## [1.1.1] - 2026-09-28 09:23

### 修复

- **Windows 路径分隔符**：gyp 生成的 Makefile 中，`Absolutify` 与 `self.output` 产出的路径带 Windows 反斜杠（如 `src\bufferutil.o`），导致 `sh` / `sed` / `make` 解析失败。现在统一转成正斜杠；该改动在非 Windows 平台上是 no-op。
- **`mkdir` 目标路径**：`mkdir -p "$(dir $@)"` 在 Windows 上因路径尾部反斜杠被 `sh` 当转义符，导致目录未创建、编译器无法写产物。新增 `slashpath` 辅助函数，把路径转正斜杠后再传给 `mkdir`。
- **超长路径依赖**：Windows 下 Makefile 会因 gypi 依赖路径超过 260 字符而报 `No rule to make target`。现在过滤掉 `node_modules` 中的此类依赖——仅影响 Makefile 自动重新生成，不影响编译。

### 文档

全面核对并修正 README，消除前后矛盾、过时表述与硬编码：

- **系统要求**：
  - iOS 构建前置工具从「Command Line Tools」修正为「**完整 Xcode**」——`xcodebuild` 必须完整 Xcode，CLT 单独不够；
  - Visual Studio 从「仅 VS2026」放宽为「**VS2019 / VS2022 / VS2026**」——VS2017 及更早受 Node 版本上限限制，故不在支持范围；VS2026 为已验证版本；
  - Android NDK 从「27.x」修正为「**23–27**」，与实测验证范围一致；
  - Git for Windows 的说明从「提供 `sh.exe` / `printf` / `xargs`」扩写为「**自带整套 MSYS2 POSIX 工具集**」，避免读者低估其必要性。
- **自动探测**：
  - 「无需手动配置」改为「**无需手动指定路径**（前提：工具已安装）」，区分「必须安装」与「位置自动定位」；
  - 「POSIX shell（`sh.exe`）」项改为「**Git for Windows 的 `usr/bin` 目录**（以 `sh.exe` 是否存在作为判据）」，与实际探测逻辑一致。
- **顶部引言**：适用范围从仅官方 `nodejs-mobile` 改为「官方及兼容的社区发行版（如 OpenFlun/nodejs-mobile）」。
- 修正若干失效链接。

## [1.1.0] - 2026-09-27 16:01

### 新增

- **Windows 宿主平台支持**：此前 Windows 上无法完成 Android 原生模块的交叉编译全流程，本版起支持。

### 修复

- **GNU make 缺 POSIX shell**：Android 原生模块通过 GNU make 构建，Makefile 会调用 `printf` / `xargs` / `sed` 等 Unix 命令。Windows 上原本因找不到 `sh.exe` 而报 `CreateProcess(NULL, printf ...) failed`。现在自动定位 Git for Windows 的 `usr/bin` 并前置到 PATH。
- **Python 探测漏检**：`find-python.js` 原本硬编码 `3.11 / 3.10 / 3.9 / 3.8` 等安装目录，装在非标准位置（如 `C:\Python314`）或更新版本时无法识别。现在改为动态探测，见下方「变更」。
- **工具集写死**：`configure` 阶段原本硬编码 `-Gmsvs_toolset=v145`，仅 VS2026 可用，VS2022 等会失败。现在从 `find-visualstudio` 的探测结果动态取用。
- **路径分隔符**：gyp 生成的 Makefile 中路径带 Windows 反斜杠（如 `src\bufferutil.o`），导致 `sh` / `sed` / `make` 解析失败。现在统一转正斜杠；该改动在非 Windows 平台为 no-op。
- **超长路径依赖**：Windows 下 Makefile 会因 gypi 依赖路径超过 260 字符而报 `No rule to make target`。现在过滤掉 `node_modules` 中的此类依赖——仅影响 Makefile 自动重新生成，不影响编译。

### 变更

- **`lib/find-python.js`**：重写。移除硬编码版本列表，改为 `py.exe` 候选（PATH / `%SystemRoot%`）+ `py -0p` 枚举 + `%LOCALAPPDATA%\Programs\Python` 与 `%ProgramFiles%\Python` 目录扫描。`run()` 显式检查 `execFile` 的 err，避免失败被当成空输出。
- **`lib/build.js`**：区分「宿主平台」与「交叉编译目标」。Windows 宿主编译 Android 目标时走 GNU make（而非 MSBuild）；自动探测 `sh.exe`；为 Python 创建 `python3.cmd` shim（Windows 上无需符号链接权限）。
- **`lib/configure.js`**：`-Gmsvs_toolset` 从探测结果动态生成，不再写死。
- **`gyp/pylib/gyp/common.py`、`gyp/pylib/gyp/generator/make.py`**：路径统一输出正斜杠；新增 `slashpath` 辅助供 `mkdir` 使用。

### 验证

- Windows + VS2026 BuildTools + Python + Node + NDK 27.x 环境下，`configure` + `build` 全流程通过，生成的 `.node` 可被 Node 正常加载。
- WSL Ubuntu 24.04 环境下，改动不改变生成的 Makefile 路径，非 Windows 平台行为不变。

### 说明

- 本版无破坏性变更，向后兼容。


## [1.0.2] - 2026-09-26 22:00

### 修复

- **lib/log.js**：新版 `proc-log` 的日志级别函数与 `pause` / `resume` 挂在默认导出的 `log` 对象下，而非包顶层。之前误用 `procLog.pause()` 等写法，导致 `configure` 阶段直接抛出 `TypeError`，全流程无法启动。
- **lib/process-release.js**：弃用 `url.resolve()` / `url.parse()`，改用 WHATWG `URL`，消除新版 Node 的 `DEP0169` 弃用警告。
- **Windows 外部头警告抑制**：Node 官方 V8 头文件会触发 `warning C4018` 等噪音。现在在 gyp 中注册 `ExternalWarningLevel` 属性，并在 `addon.gypi` 中使用 `/external:anglebrackets` + `ExternalWarningLevel: TurnOffAllWarnings`。只对 `#include <...>` 的外部头（Node / V8）静音，不影响下游自己代码的警告；且通过 MSBuild 属性而非命令行 `/external:W0`，避免与默认的 `/external:W3` 冲突产生 `D9025`。

### 变更

- **package.json**
  - `bin` 改为对象形式 `{ "nodejs-mobile-gyp": "./bin/node-gyp.js" }`，与上游命令名保持一致，避免与 `node-gyp` 包混淆。
  - `engines.node` 提升到匹配依赖链（`make-fetch-happen`、`nopt`、`proc-log`、`which` 等）的最低版本要求。
- **README.md**：CLI 调用命令修正为 `npx @flun/nodejs-mobile-gyp`；补充 Node 版本要求；移除对内部 `Gyp` API 的示例承诺。

### 验证

- 在 Windows + VS2026 BuildTools + Python 3.14 + Node 26.8.1 环境下，`configure` + `build` 全流程通过，0 warning / 0 error。
- 生成的 `.node` 可被 Node 正常 `require()` 加载并调用。