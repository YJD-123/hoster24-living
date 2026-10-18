// Hoster24 保活 bot：真登录进服待一段时间再退出，重置"无人 12 小时"计时。
// 登录前先做一次状态 ping：已有人在线就跳过本轮（真玩家本身在重置计时，
// 且同账号互顶时不能让 bot 把真人踢下线）。
// 配置全部走环境变量，见 docker-compose.yml / README。
//
// 为什么不用 mineflayer、直接用 minecraft-protocol 裸客户端（2026-10-18 实测定案）：
// 服务器是 MC 26.3（协议 777），JS 生态的协议库最高只到 26.1 / 1.21.11（协议 775）。
// 靠服务器上的 ViaVersion+ViaBackwards 把 775 客户端翻译接入 777 服时，
// 客户端bound 的传送包翻译正常，但 mineflayer 进服后发的移动包经翻译后会被服务器判
// "Invalid move player packet received" 秒踢（5.12.1 与 5.12.2-SNAPSHOT 均复现，
// 且与 ServerCore 插件无关）。保活 bot 根本不需要移动：裸客户端只做
// 登录 → 确认传送（teleport_confirm）→ 应答 keepalive，全程不发任何移动包，即可稳挂。
const net = require('net')
const mc = require('minecraft-protocol')

const HOST = process.env.MC_HOST || 'server.hoster24.org'
const PORT = parseInt(process.env.MC_PORT || '24825', 10)
const USERNAME = process.env.MC_USER || 'qx47_kp9z2'
const AUTH = process.env.MC_AUTH || 'offline' // 'offline' | 'microsoft'
const STAY_MS = parseInt(process.env.STAY_MIN || '60', 10) * 60 * 1000
// 客户端协议版本写死 1.21.11（协议 775）：服务器端 ViaBackwards 负责翻译到 26.3。
// 不要改成自动识别——状态 ping 回的版本名是 "26.3"，协议库不认识会直接报错。
const VERSION = process.env.MC_VERSION || '1.21.11'

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

  const client = mc.createClient({
    host: HOST,
    port: PORT,
    username: USERNAME,
    auth: AUTH,
    version: VERSION,
    // 微软授权的 token 缓存目录（NAS 上落在挂载卷里；GitHub Actions 里由 cache 持久化）
    profilesFolder: process.env.MC_PROFILES_FOLDER || './msa-cache'
    // keepAlive 默认即 true：协议库自动应答服务器 keepalive，不要手动再回（会重复）
  })

  let done = false
  let spawned = false
  function finish (code, msg) {
    if (done) return
    done = true
    log(msg)
    try { client.end() } catch {}
    setTimeout(() => process.exit(code), 500)
  }

  client.once('login', () => {
    log('logged in as', USERNAME)
    // 从登录成功开始计待机时长；spawn 只是紧随其后的传送确认
    setTimeout(() => finish(0, 'stay complete, leaving'), STAY_MS)
    // 硬超时兜底：挂住的会话最多多留 5 分钟就强退
    setTimeout(() => finish(1, 'hard timeout'), STAY_MS + 5 * 60 * 1000)
  })

  // 服务器传送（进服/换维度/被拉回）只确认、绝不回移动包——见文件头注释
  client.on('position', (packet) => {
    try { client.write('teleport_confirm', { teleportId: packet.teleportId }) } catch {}
    if (!spawned) {
      spawned = true
      log('spawned; staying', STAY_MS / 60000, 'min')
    }
  })

  client.on('kick_disconnect', (packet) => finish(1, 'kicked: ' + JSON.stringify(packet && packet.reason)))
  client.on('disconnect', (packet) => finish(1, 'disconnected: ' + JSON.stringify(packet && packet.reason)))
  client.on('error', (err) => finish(1, 'error: ' + (err && err.message)))
  client.on('end', () => { if (!done) finish(1, 'connection ended early') })
}

main()
