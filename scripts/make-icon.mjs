// Generates resources/icon.ico with an embedded 256x256 PNG and no external dependencies.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../resources/icon.ico')

const px = Buffer.alloc(SIZE * SIZE * 4)

const set = (x, y, [r, g, b, a]) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

const inRounded = (x, y, x0, y0, x1, y1, radius) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius)
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

const BG = [13, 71, 161, 255]
const PAGE = [255, 255, 255, 255]
const INK = [13, 71, 161, 255]
const LINE = [176, 190, 197, 255]

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inRounded(x, y, 8, 8, 247, 247, 48)) set(x, y, BG)
    if (inRounded(x, y, 48, 40, 207, 215, 12)) set(x, y, PAGE)
  }
}

for (const top of [70, 96, 122]) {
  for (let y = top; y < top + 10; y++) {
    for (let x = 72; x < (top === 122 ? 150 : 184); x++) set(x, y, LINE)
  }
}

for (let y = 148; y < 176; y++) {
  for (let x = 118; x < 138; x++) set(x, y, INK)
}
for (let k = 0; k < 30; k++) {
  for (let x = 98 + k; x <= 158 - k; x++) set(x, 176 + k, INK)
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crcBuf])
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)

const entry = Buffer.alloc(16)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.concat([header, entry, png]))
console.log(`Generated icon.ico (${png.length} bytes of PNG)`)
