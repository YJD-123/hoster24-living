// Hoster24 保活 bot：真登录进服待一段时间再退出，重置"无人 12 小时"计时。
// 登录前先做一次状态 ping：已有人在线就跳过本轮（真玩家本身在重置计时，
// 且同账号互顶时不能让 bot 把真人踢下线）。
// 配置全部走环境变量，见 docker-compose.yml / README。
const net = require('net')
const mineflayer = require('mineflayer')

const HOST = process.env.MC_HOST || 'server.hoster24.org'
const PORT = parseInt(process.env.MC_PORT || '24825', 10)
const USERNAME = process.env.MC_USER || 'qx47_kp9z2'
const AUTH = process.env.MC_AUTH || 'offline' // 'offline' | 'microsoft'
const STAY_MS = parseInt(process.env.STAY_MIN || '60', 10) * 60 * 1000

function log (...args) { console.log(new Date().toISOString(), ...args) }

// ---- 极简 Server List Ping（版本无关，只读 players.online） ----
function varint (n) {
  const bytes = []
  let v = n >>> 0
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v) b |= 0x80
    bytes.push(b)
  } while (v)
  return Buffer.from(bytes)
}
function mcString (s) {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([varint(b.length), b])
}
function mcPacket (id, payload) {
  const body = Buffer.concat([varint(id), payload])
  return Buffer.concat([varint(body.length), body])
}
function statusPing () {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(PORT, HOST)
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('ping timeout')) }, 10000)
    let buf = Buffer.alloc(0)
    sock.on('connect', () => {
      const hs = mcPacket(0x00, Buffer.concat([
        varint(47), mcString(HOST),
        Buffer.from([(PORT >> 8) & 0xff, PORT & 0xff]),
        varint(1) // next state = status
      ]))
      sock.write(Buffer.concat([hs, mcPacket(0x00, Buffer.alloc(0))]))
    })
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      try {
        let off = 0
        const readVarint = () => {
          let num = 0; let shift = 0; let b
          do { b = buf[off++]; num |= (b & 0x7f) << shift; shift += 7 } while (b & 0x80)
          return num
        }
        const len = readVarint()
        if (buf.length < off + len) return // 数据还没到齐，等下一片
        readVarint() // packet id (0x00)
        const slen = readVarint()
        const json = buf.slice(off, off + slen).toString('utf8')
        clearTimeout(timer)
        sock.destroy()
        resolve(JSON.parse(json))
      } catch { /* 半包，继续等 */ }
    })
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

// ---- 主流程 ----
async function main () {
  let status
  try {
    status = await statusPing()
  } catch (e) {
    log('status ping failed (server down?):', e.message)
    process.exit(1)
  }
  const online = status && status.players ? status.players.online : 0
  log('players online:', online)
  if (online > 0) {
    log('someone is playing, skip this round')
    process.exit(0)
  }

  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: USERNAME,
    auth: AUTH,
    // 微软授权的 token 缓存目录（NAS 上落在挂载卷里；GitHub Actions 里由 cache 持久化）
    profilesFolder: process.env.MC_PROFILES_FOLDER || './msa-cache'
    // version 不写：mineflayer 先 ping 服务器自动识别协议版本
  })

  let done = false
  function finish (code, msg) {
    if (done) return
    done = true
    log(msg)
    try { bot.quit() } catch {}
    setTimeout(() => process.exit(code), 500)
  }

  bot.once('login', () => log('logged in as', bot.username))
  bot.once('spawn', () => {
    log('spawned; staying', STAY_MS / 60000, 'min')
    setTimeout(() => finish(0, 'stay complete, leaving'), STAY_MS)
  })
  bot.on('kicked', (reason) => finish(1, 'kicked: ' + JSON.stringify(reason)))
  bot.on('error', (err) => finish(1, 'error: ' + (err && err.message)))
  bot.on('end', () => { if (!done) finish(1, 'connection ended early') })

  // 硬超时兜底：挂住的会话最多多留 5 分钟就强退
  setTimeout(() => finish(1, 'hard timeout'), STAY_MS + 5 * 60 * 1000)
}

main()
