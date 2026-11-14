# 变更日志
## [1.2.4] - 2026-11-14 08:55
### 修复
- `lib/process-release.js` 第 7 行以 `;` 结尾,截断了 `const` 声明链,使后续 `bitsreV3`、`normalizePath`、
  `resolveLibUrl` 成为隐式全局;在 ESM 严格模式下导入即抛 `ReferenceError: bitsreV3 is not defined`,
  导致原生模块编译失败(`npm rebuild` 在 `node-gyp-build-mobile` 阶段崩溃);
- 第 7 行末的 `;` 改为 `,`,三变量归入同一 `const` 声明链;

## [1.2.3] - 2026-11-10 22:15
### 优化
- 整体细节优化+依赖包更新;

## [1.2.2] - 2026-11-06 11:02
### 优化
- 细节优化;