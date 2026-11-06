# 变更日志

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

## [1.2.0] - 2026-11-02 16:05
### 新增
- 帮助文本重写为中文三层结构:`用法:` 为 0 级,`命令:`/`选项:` 缩进 2,各条目缩进 4;
  命令含别名 `ls`/`rm`,选项简写在前、完整写法置于行尾注释;末尾仅输出版本号行;
- 无参数、`help`、`-h`、`--help` 均打印完整帮助并以 exit 0 退出;
- 帮助文本按语义着色:`用法:` 用 `chalk.blueBright`,分组名用 `chalk.cyan`,命令与选项名用 `chalk.cyanBright`,
  说明文字用 `chalk.gray`,末尾版本号用 `chalk.hex('#B8860B')`;非 TTY 下自动关闭颜色,不向管道泄漏 ANSI;
- 未知命令提示着色:错误标记用 `chalk.red`,命令名用 `chalk.yellow`;

### 修复
- 未知命令改为输出 `✗ 未知命令: xxx` + 一个空行 + 完整帮助,并以 exit 1 退出;
  此前未知参数不报错,静默继续;
- `-h` 此前被忽略,现作为帮助入口;该行为变更可能影响依赖旧行为的脚本;
- 帮助文本命令区与选项区说明列错位:命令区原补到显示列 17,选项区 23,现统一补到 23;
  补白改为按显示宽度计算,中日韩全角字符按 2 列计,此前按码元计导致含中文的选项名整体左移;
- `package.json` 的 `dependencies` 补声明 `chalk`;`lib/node-gyp.js` 已引用该模块,
  此前未声明,从 npm 安装后缺少依赖会导致 `--help` 直接报错;

### 文档
- `lib/` 下 12 个 js 去除 BOM;`维护.md`、`package.json`、`lib/util.js` 换行符由 CRLF 改为 LF;