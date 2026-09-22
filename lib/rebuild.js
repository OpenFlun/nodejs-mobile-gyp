/**
 * 依次执行 clean、configure、build
 */
const rebuild = async (gyp, argv) => {
  gyp.todo.push(
    { name: 'clean', args: [] }
    , { name: 'configure', args: argv }
    , { name: 'build', args: [] }
  )
}

rebuild.usage = 'Runs "clean", "configure" and "build" all at once'

export { rebuild }
