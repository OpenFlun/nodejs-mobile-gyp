import gracefulFs from 'graceful-fs'
import * as log from './log.js'

const fs = gracefulFs.promises

/**
 * 列出已安装的 Node 开发文件版本
 */
const list = async (gyp, args) => {
  const devDir = gyp.devDir
  log.verbose('list', 'using node-gyp dir:', devDir)

  let versions = []
  try {
    const dir = await fs.readdir(devDir)
    if (Array.isArray(dir)) {
      versions = dir.filter((v) => v !== 'current')
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw err
    }
  }

  return versions
}

list.usage = 'Prints a listing of the currently installed node development files'

export { list }
