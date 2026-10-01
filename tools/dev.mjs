// Starts the API (:4000) and the web app (:5173) together — unless UniVerse is already running, in which case it prints
// the links instead of crashing on "port already in use".   npm run dev        → this Mac only
//                                                              npm run dev:phone  → also reachable from phones on the same Wi-Fi
import { spawn } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const phone = process.argv.includes('--phone')
const WEB = 5173
const API = 4000

function lanIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
}

/** Resolves true when something accepts connections on host:port. */
function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host })
    s.setTimeout(700)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('timeout', () => { s.destroy(); resolve(false) })
    s.once('error', () => resolve(false))
  })
}

/** Resolves true when the URL answers like UniVerse's health endpoint. */
async function isUniverse(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
    const body = await r.json()
    return r.ok && body?.name === 'UniVerse'
  } catch {
    return false
  }
}

const ip = lanIp()
const [webBusy, apiBusy] = await Promise.all([portInUse(WEB), portInUse(API)])

if (webBusy || apiBusy) {
  const running = await isUniverse(`http://localhost:${WEB}/api/health`)
  if (running) {
    const phoneReachable = ip ? await isUniverse(`http://${ip}:${WEB}/api/health`) : false
    console.log('\nUniVerse is already running — no need to start it again.\n')
    console.log(`  On this Mac:    http://localhost:${WEB}`)
    if (phoneReachable) console.log(`  On your phone:  http://${ip}:${WEB}   (same Wi-Fi)`)
    else if (phone) console.log('  On your phone:  not available — the running copy was started with "npm run dev".\n' +
      '                  Stop it (Ctrl-C in its terminal tab), then run "npm run dev:phone".')
    console.log('\nIt is running in another terminal tab. To restart it, press Ctrl-C in that tab first.\n')
    process.exit(0)
  }
  const busy = [webBusy && WEB, apiBusy && API].filter(Boolean).join(' and ')
  console.error(`\nCan't start UniVerse: port ${busy} is being used by another program.`)
  console.error(`Find it with:  lsof -iTCP:${webBusy ? WEB : API} -sTCP:LISTEN\n`)
  process.exit(1)
}

const bin = path.join(ROOT, 'node_modules', '.bin', 'concurrently')
const child = spawn(bin, [
  '-n', 'api,web', '-c', 'magenta,cyan',
  `PORT=${API} npm --prefix server run dev`,
  `npm --prefix client run dev${phone ? ' -- --host' : ''}`,
], { cwd: ROOT, stdio: 'inherit' })

child.on('exit', (code, signal) => process.exit(signal ? 0 : code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
