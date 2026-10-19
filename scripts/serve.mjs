// Zero-dependency static server for the demo. Serves the package root so
// examples/index.html can import ../dist and three from node_modules, then
// opens the browser (set NO_OPEN=1 to skip).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT) || 4180
const entry = process.env.ENTRY || '/examples/index.html'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0])
    if (path === '/') path = entry
    // keep within the package root
    const filePath = normalize(join(root, path))
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const body = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
  }
})

server.listen(port, () => {
  const url = `http://localhost:${port}${entry}`
  console.log(`\n  🏋️  Gym Motion studio → ${url}\n  (Ctrl+C to stop)\n`)
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  if (process.env.NO_OPEN) return
  try { spawn(opener, args, { stdio: 'ignore', detached: true }).unref() } catch { /* open manually */ }
})
