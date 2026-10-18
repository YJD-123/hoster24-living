#!/bin/sh
# 循环模式：登录待 STAY_MIN 分钟 -> 退出 -> 睡 INTERVAL_H 小时 -> 再来
# 一轮最长"无人"间隔 = INTERVAL_H 小时，远小于 12 小时停服线
mkdir -p logs
while true; do
  node bot.js >> logs/keepalive.log 2>&1
  echo "$(date -Iseconds) session ended, sleeping ${INTERVAL_H:-4}h" >> logs/keepalive.log
  sleep $((${INTERVAL_H:-4} * 3600))
done
