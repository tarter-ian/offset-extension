// Builds the zip to upload to the Chrome Web Store.
//
// The store copy differs from the repository in two ways: it leaves out the
// files only developers need (demo, store, README), and its manifest lists only
// the site's real addresses, not localhost or branch previews.
//
// usage: node store/build.mjs      -> dist/offset-extension-<version>.zip
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

// The addresses the published extension talks to: the site's own domain, and its Cloudflare address.
const SITE_MATCHES = ['https://myoffset.org/*', 'https://www.myoffset.org/*', 'https://offset-website.itsian123.workers.dev/*']
const SHIPPED = ['background.js', 'site-bridge.js', 'provider-shim.js', 'provider-relay.js', 'permit.html', 'permit.js', 'LICENSE', 'providers', 'icons']

// Every shipped file as [path inside the zip, contents].
const files = []
const add = (path) => {
  const full = join(root, path)
  if (statSync(full).isDirectory()) for (const name of readdirSync(full).sort()) add(`${path}/${name}`)
  else files.push([path, readFileSync(full)])
}
SHIPPED.forEach(add)
manifest.content_scripts[0].matches = SITE_MATCHES
files.push(['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')])

// A zip written by hand, so the build needs nothing installed and its paths
// always use forward slashes, which the store requires.
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const local = []
const central = []
let offset = 0
for (const [path, data] of files) {
  const name = Buffer.from(path)
  const packed = deflateRawSync(data, { level: 9 })
  const head = Buffer.alloc(30)
  head.writeUInt32LE(0x04034b50, 0)
  head.writeUInt16LE(20, 4) // version needed
  head.writeUInt16LE(0x0800, 6) // names are UTF-8
  head.writeUInt16LE(8, 8) // deflate
  head.writeUInt32LE(0x00210000, 10) // a fixed time and date (1980-01-01), so builds repeat exactly
  head.writeUInt32LE(crc32(data), 14)
  head.writeUInt32LE(packed.length, 18)
  head.writeUInt32LE(data.length, 22)
  head.writeUInt16LE(name.length, 26)
  local.push(head, name, packed)
  const entry = Buffer.alloc(46)
  entry.writeUInt32LE(0x02014b50, 0)
  entry.writeUInt16LE(20, 4)
  head.copy(entry, 6, 4, 30) // the same fields as the local header
  entry.writeUInt32LE(offset, 42)
  central.push(entry, name)
  offset += 30 + name.length + packed.length
}
const centralSize = central.reduce((n, b) => n + b.length, 0)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(offset, 16)

const out = join(root, 'dist')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const zip = join(out, `offset-extension-${manifest.version}.zip`)
writeFileSync(zip, Buffer.concat([...local, ...central, end]))
console.log(`built ${zip}`)
console.log(`${files.length} files: ${files.map(([p]) => p).join(', ')}`)
console.log(`site addresses: ${SITE_MATCHES.join(', ')}`)
