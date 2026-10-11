// Serves the test page on http://localhost:5173 (this computer only).
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const page = fileURLToPath(new URL('./index.html', import.meta.url))
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(readFileSync(page))
}).listen(5173, '127.0.0.1', () => console.log('test page on http://localhost:5173'))
