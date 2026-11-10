/**
 * 依次执行 clean、configure、build
 * >查看定义:@see {@link rebuild}
 */
const rebuild = async (gyp, argv) => {
  gyp.todo.push({ name: 'clean', args: [] }, { name: 'configure', args: argv }, { name: 'build', args: [] });
}

rebuild.usage = '依次执行 "clean"、"configure" 和 "build"';
export { rebuild };