# Changelog

## [1.0.2] - 2026-09-26

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

## [1.0.1] - 2026-09-21

### 首发

- 发布 `@flun/nodejs-mobile-gyp`，基于 [nodejs-mobile-gyp](https://github.com/janeasystems/nodejs-mobile-gyp) 0.4.0 与上游 [node-gyp](https://github.com/nodejs/node-gyp) fork
- 用于为 nodejs-mobile 环境编译原生模块（Android / iOS）

### 代码风格

- 全量改造为 **ESM**（`package.json` 的 `type: "module"`）
- 导出方式统一为文件末尾 `export { ... }`
- 函数声明改为 `const xxx = (...) => {}`（`class` 保留）
- 注释全部中文化

### Windows 适配

- 支持 **Visual Studio 2026**（版本号 18，`versionYear=2026`，toolset `v145`）
- 强制走 **MSVC** 工具集，不再使用 ClangCL
- 关闭 **LTO**：`enable_lto` / `enable_thin_lto` 置 `false`，`lto_jobs` 置空
  - 避免 `MSB8020: 无法找到 ClangCL 的生成工具`
  - 避免 `LNK1117: 选项"opt:lldltojobs=2"中的语法错误`
- `configure` 阶段显式追加 `-Gmsvs_toolset=v145`

### 依赖升级

- `tar`: `^6.1.2` → `^7.5.22`
- `glob`: `^10.3.10` → `^13.0.6`
- `make-fetch-happen`: `^13.0.0` → `^16.0.1`
- 连带消除 `inflight`、`rimraf@3`、旧版 `glob` 等停更依赖

### 验证

- Windows + VS2026 BuildTools + Python 3.14 + Node 26.8.1 环境下，`configure` + `build` 全流程通过
- 生成的 `.node` 能被 Node 正常加载
