# Changelog

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

- `tar`: `^6.1.2` → `^7.5.21`
- `glob`: `^10.3.10` → `^13.0.6`
- `make-fetch-happen`: `^13.0.0` → `^16.0.1`
- 连带消除 `inflight`、`rimraf@3`、旧版 `glob` 等停更依赖

### 验证

- Windows + VS2026 BuildTools + Python 3.14 + Node 26.8.1 环境下，`configure` + `build` 全流程通过
- 生成的 `.node` 能被 Node 正常加载