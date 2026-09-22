import fetch from 'make-fetch-happen'
import gracefulFs from 'graceful-fs'
import * as log from './log.js'

const { promises: fs } = gracefulFs

/**
 * 读取 CA 证书文件，按证书边界切分为多个证书
 */
const readCAFile = async (filename) => {
  // CA 文件可能包含多份证书，按证书边界切分
  // [\S\s]*? 用于匹配包括换行在内的所有内容
  const ca = await fs.readFile(filename, 'utf8')
  const re = /(-----BEGIN CERTIFICATE-----[\S\s]*?-----END CERTIFICATE-----)/g
  return ca.match(re)
}

/**
 * 使用 make-fetch-happen 下载指定 URL
 */
const download = async (gyp, url) => {
  log.http('GET', url)

  const requestOpts = {
    headers: {
      'User-Agent': `node-gyp v${gyp.version} (node ${process.version})`,
      Connection: 'keep-alive'
    },
    proxy: gyp.opts.proxy,
    noProxy: gyp.opts.noproxy
  }

  const cafile = gyp.opts.cafile
  if (cafile) {
    requestOpts.ca = await readCAFile(cafile)
  }

  const res = await fetch(url, requestOpts)
  log.http(res.status, res.url)

  return res
}

export { download, readCAFile }
