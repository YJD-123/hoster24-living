# Hoster24 保活方案（定版 2026-10-18）

背景：Hoster24 免费服"无玩家 12 小时自动停服"（面板通知原文），订阅才全天候。
这个服没人玩、纯挂代理节点——服一停节点跟着下线，所以保活必须做。

原理：定时让一个 bot **真登录**进服待 20 分钟再退出，"无人"计时永远到不了 12 小时。
节奏（GitHub Actions 版）：每 6 小时一轮，无人最长约 5.7 小时。

## 前置条件（服务器侧，已就绪）

- `online-mode=false`：用户 2026-10-18 已在面板手动改好；wrapper v3 每次开机
  还会自动兜底修正 `server-port=24826 / online-mode=false / white-list=true`，
  面板 egg 重写也改不回去。
- 白名单只放 bot 一个名字：`whitelist.json`（在 Hoster24 部署包里）上传覆盖即可，
  bot 名 `qx47_kp9z2`（随机名，离线模式下白名单按名字认人，名字即门槛）。
- 离线模式 + 白名单之外的人进不来；ops.json 不要给这个名字 op 权限。

## 跑在哪

两个落点，二选一（代码同一套）：

**A. GitHub Actions（推荐）**：`.github/workflows/keepalive.yml` 已备好。
建一个仓库把本目录推上去，手动跑一次 workflow 验证即可——不需要任何
Secret（离线登录零凭据）。workflow 自带 heartbeat 提交防 60 天无活动停用。
分钟数：每轮约 22 分钟、每天约 90 分钟——公开仓库免费无限；
私有仓库免费额度 2000 分钟/月会超，私有就把 STAY_MIN 改 15、cron 改每 8 小时。

**B. 飞牛 NAS（Docker）**：`docker compose up -d`，循环模式
（待 60 分钟 → 睡 4 小时），日志在 `logs/keepalive.log`。

不能跑在助手 VM：其出口到 24825 端口不通（2026-10-11 实测，
2026-10-18 复测仍不通）。

## 验证

- workflow / NAS 日志出现 `spawned; staying 20 min`
- 面板控制台出现 `qx47_kp9z2 joined the game`、玩家数变 1/2
- 满 12 小时服务器不再被自动停

## 已知风险

- mineflayer 对 Paper 26.3 的协议支持：bot 不写死版本、靠 ping 自动识别；
  若首次登录报版本不支持，等 mineflayer 更新或改走原始协议 bot（备选）。
- max-players=2：bot 在线时占 1 个位；反正没人玩，无影响。
- 名字泄露 = 任何人能以 bot 身份进服（只能进这个空服，world 无价值）；
  真泄露了就换名：改 whitelist.json + workflow/compose 的 MC_USER 三处同步。
