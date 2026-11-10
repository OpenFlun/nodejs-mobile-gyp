# 变更日志

## [1.2.3] - 2026-11-10 22:15
### 优化
- 整体细节优化+依赖包更新;

## [1.2.2] - 2026-11-06 11:02
### 优化
- 细节优化;

## [1.2.1] - 2026-11-06 10:02
### 优化
- 帮助文本层级改为与其它作用域包一致:`用法:` 缩进 2,分组名缩进 4,各条目缩进 6;
  分组名去掉行尾冒号,底部版本行缩进 2,与 `用法:` 行对齐;
- `usage()` 内原 `cmd` 与 `opt` 两个函数体完全相同,合并为单个 `row`;
- 用户可见的命令名、日志标签与错误消息统一改为中文,涉及 `bin/node-gyp.js`、
  `lib/build.js`、`lib/configure.js`、`lib/create-config-gypi.js`、`lib/install.js`、
  `lib/find-python.js`、`lib/find-visualstudio.js`、`lib/find-node-directory.js`、
  `lib/clean.js`、`lib/list.js`、`lib/remove.js`、`lib/process-release.js`、`lib/util.js`;
- `--verbose`/`--silly` 下的诊断消息一并中文化;技术标识保留原文,如 `py -0p`、
  `installVersion`、`node.lib`、`EACCES`、`SHASUMS256.txt`、`--nodedir`;
- 各命令的 `usage` 属性改为中文;命令名与参数名保留原文;

### 修复
- 主目录缺失时的错误消息此前仍为整句英文,且含拼写错误 `Overide`;现改为中文;
- `find-python.js` 的 `fail()` 提示与 `addLog` 诊断、`find-visualstudio.js` 的
  `fail()` 提示与 `addLog` 诊断,此前为英文;现改为中文;
- `install.js` 中下载、解压、校验相关的英文错误消息改为中文;
- `package.json` 的 `files` 字段含 `gyp/LICENSE`,该文件在磁盘上不存在;现移除;
  其余条目按磁盘实际顺序重排:目录在前,文件在后,否定项紧随其对应的目录;

### 文档
- README 的包目录结构同步磁盘实际内容:补 `gyp/pyproject.toml`、`gyp/README.md`、
  `gyp/test_gyp.py`,移除不存在的 `gyp/LICENSE`;顶层文件按 `files` 顺序重排;