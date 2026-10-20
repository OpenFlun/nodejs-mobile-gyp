# 变更日志

## [1.1.3] - 2026-10-20 13:55
### 修复
- 一些细节优化

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