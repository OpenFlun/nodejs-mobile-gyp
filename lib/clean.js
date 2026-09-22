import gracefulFs from 'graceful-fs'
import * as log from './log.js'

const fs = gracefulFs.promises

/**
 * 清理：删除 build 目录
 */
const clean = async (gyp, argv) => {
  // 删除 build 目录
  const buildDir = 'build'

  log.verbose('clean', 'removing "%s" directory', buildDir)
  await fs.rm(buildDir, { recursive: true, force: true })
}

clean.usage = 'Removes any generated build files and the "out" dir'

export { clean }
