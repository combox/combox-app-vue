import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return fallback
  const value = process.argv[idx + 1]
  if (!value || value.startsWith('--')) return fallback
  return value
}

const host = getArg('host', '127.0.0.1')
const port = Number(getArg('port', '4173'))
const dir = path.resolve(process.cwd(), getArg('dir', 'dist'))

const mimeByExt = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
])

function isHashedAsset(filePath) {
  const base = path.basename(filePath)
  return /\.[a-f0-9]{8}\./i.test(base)
}

function cacheControlFor(filePath) {
  if (filePath.endsWith('.html')) {
    // SPA entry point should never be cached aggressively in local preview.
    return 'no-store, no-cache, must-revalidate, max-age=0'
  }

  const ext = path.extname(filePath).toLowerCase()
  // Fonts are versioned by URL (often with ?v=...) and safe to cache for a long time.
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) {
    return 'public, max-age=31536000, immutable'
  }

  if (filePath.includes(`${path.sep}assets${path.sep}`) && isHashedAsset(filePath)) {
    return 'public, max-age=31536000, immutable'
  }
  if (isHashedAsset(filePath)) {
    return 'public, max-age=31536000, immutable'
  }
  // Reasonable default for non-hashed static files copied from /public.
  return 'public, max-age=3600'
}

async function readFileSafe(absPath) {
  try {
    const buf = await fs.readFile(absPath)
    const st = await fs.stat(absPath)
    return { ok: true, buf, st }
  } catch {
    return { ok: false }
  }
}

function isCompressibleExt(ext) {
  return [
    '.html',
    '.js',
    '.css',
    '.json',
    '.svg',
    '.txt',
    '.map',
    '.ttf',
    '.otf',
  ].includes(ext)
}

function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '')
  // Prefer brotli, fallback to gzip.
  if (/\bbr\b/i.test(ae)) return 'br'
  if (/\bgzip\b/i.test(ae)) return 'gzip'
  return null
}

function makeEtagForEncoding(st, encoding) {
  // Different encodings are different representations. Keep etags stable per-encoding.
  const enc = encoding || 'identity'
  return `W/\"${st.size}-${Math.trunc(st.mtimeMs)}-${enc}\"`
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || host}`)
    const pathname = decodeURIComponent(url.pathname)

    // Basic traversal guard.
    const abs = path.resolve(dir, `.${pathname}`)
    if (!abs.startsWith(dir + path.sep) && abs !== dir) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    let target = abs
    if (pathname.endsWith('/')) {
      target = path.join(abs, 'index.html')
    }

    let file = await readFileSafe(target)
    if (!file.ok) {
      // SPA fallback.
      target = path.join(dir, 'index.html')
      file = await readFileSafe(target)
    }

    if (!file.ok) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    const ext = path.extname(target).toLowerCase()
    const encoding = isCompressibleExt(ext) ? pickEncoding(req) : null
    const etag = makeEtagForEncoding(file.st, encoding)
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304
      res.setHeader('ETag', etag)
      res.end()
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', mimeByExt.get(ext) || 'application/octet-stream')
    res.setHeader('Cache-Control', cacheControlFor(target))
    res.setHeader('ETag', etag)
    res.setHeader('Vary', 'Accept-Encoding')

    if (encoding === 'br') {
      res.setHeader('Content-Encoding', 'br')
      res.end(zlib.brotliCompressSync(file.buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }))
      return
    }
    if (encoding === 'gzip') {
      res.setHeader('Content-Encoding', 'gzip')
      res.end(zlib.gzipSync(file.buf, { level: 6 }))
      return
    }

    res.end(file.buf)
  } catch (err) {
    res.statusCode = 500
    res.end('Internal Server Error')
  }
})

server.listen(port, host, () => {
  console.log(`Preview server: http://${host}:${port} (root: ${path.relative(process.cwd(), dir) || '.'})`)
})
