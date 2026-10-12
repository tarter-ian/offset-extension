// Draws the extension's icon at each size Chrome asks for and writes PNG files.
// The mark: a dark green rounded square with a pale ring and a small leaf-green
// dot set off-centre inside it ("offset"). No dependencies; PNG is written by hand.
// usage: node make-icons.mjs <outDir>
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
mkdirSync(out, { recursive: true })

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}
function png(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const GREEN = [15, 61, 46]
const PALE = [244, 247, 240]
const LEAF = [126, 200, 122]

// Colour and coverage of the mark at a point, in units where the icon is 1 wide.
function at(x, y) {
  // Rounded square.
  const r = 0.22
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  if (Math.hypot(dx, dy) > r) return null
  // Dot, set down and to the right.
  if (Math.hypot(x - 0.6, y - 0.6) < 0.115) return LEAF
  // Ring.
  const d = Math.hypot(x - 0.5, y - 0.5)
  if (d < 0.33 && d > 0.225) return PALE
  return GREEN
}

for (const size of [16, 32, 48, 128]) {
  const rgba = Buffer.alloc(size * size * 4)
  const n = 6 // samples per pixel side, for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const c = at((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a++
          }
        }
      }
      const i = (py * size + px) * 4
      if (a) {
        rgba[i] = Math.round(r / a)
        rgba[i + 1] = Math.round(g / a)
        rgba[i + 2] = Math.round(b / a)
        rgba[i + 3] = Math.round((a / (n * n)) * 255)
      }
    }
  }
  writeFileSync(join(out, `icon${size}.png`), png(size, rgba))
  console.log(`icon${size}.png`)
}
