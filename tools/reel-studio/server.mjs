// Reel Studio — orchestrator-only dev tool. Serves a page that renders 12 looping motion-graphics scenes on a
// canvas, records each with MediaRecorder, and POSTs the WebM here. We patch a Duration element into the WebM
// header (MediaRecorder omits it, which makes <video>.duration Infinity) and write server/seed-media/reels/.
// Node built-ins only. Binds to 127.0.0.1. Usage: node tools/reel-studio/server.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../server/seed-media/reels')
const PORT = Number(process.env.REEL_STUDIO_PORT || 4321)
const NAME_RE = /^reel-(0[1-9]|1[0-2])\.webm$/
const MAX_BYTES = 25 * 1024 * 1024

// ---- minimal EBML helpers -------------------------------------------------------------------------------------
function readVint(buf, pos) {            // returns { length, value, unknown }
  const first = buf[pos]
  let len = 1
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
  if (len > 8) throw new Error('bad vint at ' + pos)
  let value = BigInt(first & (0xff >> len))
  let allOnes = (first & (0xff >> len)) === (0xff >> len)
  for (let i = 1; i < len; i++) { value = (value << 8n) | BigInt(buf[pos + i]); if (buf[pos + i] !== 0xff) allOnes = false }
  return { length: len, value: Number(value), unknown: allOnes }
}
function readId(buf, pos) {
  const first = buf[pos]
  let len = 1
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++
  return { length: len, id: buf.subarray(pos, pos + len).toString('hex') }
}
function writeVint(value, width) {
  const out = Buffer.alloc(width)
  let v = BigInt(value)
  for (let i = width - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n }
  out[0] |= 0x80 >> (width - 1)
  return out
}

/** Insert a Duration (0x4489, float64, in TimecodeScale units) into Segment › Info. Returns the patched buffer. */
function patchDuration(buf, durationMs) {
  let pos = 0
  const ebml = readId(buf, pos)                                   // 1a45dfa3
  if (ebml.id !== '1a45dfa3') throw new Error('not EBML')
  pos += ebml.length
  const ebmlSize = readVint(buf, pos); pos += ebmlSize.length + ebmlSize.value
  const seg = readId(buf, pos)                                    // 18538067
  if (seg.id !== '18538067') throw new Error('no Segment')
  pos += seg.length
  const segSize = readVint(buf, pos)
  const segSizePos = pos
  pos += segSize.length
  // walk Segment children until Info (1549a966)
  while (pos < buf.length) {
    const id = readId(buf, pos)
    const sizePos = pos + id.length
    const size = readVint(buf, sizePos)
    const dataPos = sizePos + size.length
    if (id.id === '1549a966') {
      const info = buf.subarray(dataPos, dataPos + size.value)
      let timecodeScale = 1_000_000
      let p = 0, hasDuration = false
      while (p < info.length) {
        const cid = readId(info, p); const cs = readVint(info, p + cid.length)
        const cdata = p + cid.length + cs.length
        if (cid.id === '2ad7b1') { let v = 0; for (let i = 0; i < cs.value; i++) v = v * 256 + info[cdata + i]; timecodeScale = v }
        if (cid.id === '4489') hasDuration = true
        p = cdata + cs.value
      }
      if (hasDuration) return buf
      const dur = Buffer.alloc(11)
      dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88                 // id + size(8)
      dur.writeDoubleBE(durationMs * 1_000_000 / timecodeScale, 3)
      const newInfoSize = writeVint(size.value + dur.length, size.length)
      if (size.value + dur.length >= 2 ** (7 * size.length) - 1) throw new Error('Info size vint too narrow')
      const parts = [buf.subarray(0, sizePos), newInfoSize, info, dur, buf.subarray(dataPos + size.value)]
      const out = Buffer.concat(parts)
      if (!segSize.unknown) writeVint(segSize.value + dur.length, segSize.length).copy(out, segSizePos)
      return out
    }
    if (size.unknown) throw new Error('unknown-size element before Info: ' + id.id)
    pos = dataPos + size.value
  }
  throw new Error('Info element not found')
}

// ---- server ---------------------------------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true })
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return fs.createReadStream(path.join(HERE, 'index.html')).pipe(res)
  }
  if (req.method === 'GET' && url.pathname.startsWith('/out/')) {
    const name = url.pathname.slice(5)
    if (!NAME_RE.test(name) || !fs.existsSync(path.join(OUT, name))) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'content-type': 'video/webm', 'cache-control': 'no-store' })
    return fs.createReadStream(path.join(OUT, name)).pipe(res)
  }
  if (req.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name') || ''
    const durationMs = Number(url.searchParams.get('durationMs'))
    if (!NAME_RE.test(name) || !(durationMs > 0 && durationMs < 61_000)) { res.writeHead(400); return res.end('bad name or duration') }
    const chunks = []; let total = 0
    req.on('data', c => { total += c.length; if (total > MAX_BYTES) { res.writeHead(413); res.end('too large'); req.destroy() } else chunks.push(c) })
    req.on('end', () => {
      if (res.writableEnded) return
      try {
        const raw = Buffer.concat(chunks)
        let patched = raw, note = 'duration patched'
        try { patched = patchDuration(raw, durationMs) } catch (e) { note = 'NOT patched: ' + e.message }
        fs.writeFileSync(path.join(OUT, name), patched)
        const body = JSON.stringify({ name, bytes: patched.length, note })
        console.log(body)
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(body)
      } catch (e) { res.writeHead(500); res.end(String(e)) }
    })
    return
  }
  res.writeHead(404); res.end('not found')
})
server.listen(PORT, '127.0.0.1', () => console.log(`reel-studio on http://127.0.0.1:${PORT} → ${OUT}`))
