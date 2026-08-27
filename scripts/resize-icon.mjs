// 纯 Node 实现 PNG 缩放：解码 → 双线性重采样 → 重新编码。
// 只依赖内置 zlib，不需要 sips / ImageMagick / sharp。
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** 解析 PNG，返回 {width, height, rgba} */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('不是 PNG 文件')

  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette = null
  let trns = null
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = Buffer.from(data)
    } else if (type === 'tRNS') {
      trns = Buffer.from(data)
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }

  if (bitDepth !== 8) throw new Error(`仅支持 8 位深度，实际为 ${bitDepth}`)
  if (interlace !== 0) throw new Error('不支持隔行扫描 PNG')

  const channelsFor = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const channels = channelsFor[colorType]
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)

  // 逐行反解 PNG 滤波器
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let v = src[x]
      switch (filter) {
        case 0: break
        case 1: v += a; break
        case 2: v += b; break
        case 3: v += (a + b) >> 1; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default: throw new Error(`未知滤波器类型 ${filter}`)
      }
      cur[x] = v & 0xff
    }
  }

  // 统一展开为 RGBA
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = i * channels
    const d = i * 4
    if (colorType === 6) {
      rgba[d] = pixels[s]; rgba[d + 1] = pixels[s + 1]; rgba[d + 2] = pixels[s + 2]; rgba[d + 3] = pixels[s + 3]
    } else if (colorType === 2) {
      rgba[d] = pixels[s]; rgba[d + 1] = pixels[s + 1]; rgba[d + 2] = pixels[s + 2]; rgba[d + 3] = 255
    } else if (colorType === 0) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = pixels[s]; rgba[d + 3] = 255
    } else if (colorType === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = pixels[s]; rgba[d + 3] = pixels[s + 1]
    } else if (colorType === 3) {
      const idx = pixels[s]
      rgba[d] = palette[idx * 3]; rgba[d + 1] = palette[idx * 3 + 1]; rgba[d + 2] = palette[idx * 3 + 2]
      rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255
    }
  }

  return { width, height, rgba }
}

/** 盒式滤波下采样（缩小图像时比双线性更干净，不会漏采样） */
function resize(src, targetW, targetH) {
  const { width: sw, height: sh, rgba } = src
  const out = Buffer.alloc(targetW * targetH * 4)
  const xRatio = sw / targetW
  const yRatio = sh / targetH

  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.min(sh, Math.ceil((y + 1) * yRatio))
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.min(sw, Math.ceil((x + 1) * xRatio))

      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4
          const alpha = rgba[i + 3]
          // 按 alpha 加权，避免透明边缘出现黑边
          r += rgba[i] * alpha
          g += rgba[i + 1] * alpha
          b += rgba[i + 2] * alpha
          a += alpha
          n++
        }
      }
      const d = (y * targetW + x) * 4
      if (a > 0) {
        out[d] = Math.round(r / a)
        out[d + 1] = Math.round(g / a)
        out[d + 2] = Math.round(b / a)
        out[d + 3] = Math.round(a / n)
      }
    }
  }
  return { width: targetW, height: targetH, rgba: out }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // RGBA
  ihdr[10] = 0  // deflate
  ihdr[11] = 0  // adaptive filtering
  ihdr[12] = 0  // no interlace

  // 每行前置 filter 0（None），交给 deflate 压缩
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const [srcPath, ...specs] = process.argv.slice(2)
if (!srcPath || specs.length === 0) {
  console.error('用法: node resize-icon.mjs <源图> <尺寸:输出路径> ...')
  process.exit(1)
}

const source = decodePng(readFileSync(srcPath))
console.log(`源图 ${source.width}x${source.height}`)

for (const spec of specs) {
  const [sizeStr, outPath] = spec.split(':')
  const size = Number(sizeStr)
  const scaled = size === source.width ? source : resize(source, size, size)
  const png = encodePng(scaled)
  writeFileSync(outPath, png)
  console.log(`  ${String(size).padStart(4)}px → ${outPath}  ${(png.length / 1024).toFixed(1)} KB`)
}
