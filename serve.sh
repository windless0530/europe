#!/usr/bin/env bash
# 重启 Vite dev server：先杀旧进程，再后台拉起，端口就绪后本脚本即退出。
# 用法：./serve.sh   （日志在 serve.log）
set -euo pipefail

PORT=5173
LOG="$(dirname "$0")/serve.log"
PIDFILE="$(dirname "$0")/.serve.pid"

cd "$(dirname "$0")"

port_pids() { lsof -t -i :"$PORT" 2>/dev/null || true; }

# 1. 杀掉占用端口的旧服务（先 TERM，短等后 KILL）
pids="$(port_pids)"
if [ -n "$pids" ]; then
  echo "Killing old server on port $PORT (pid: $pids)"
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 25); do
    [ -z "$(port_pids)" ] && break
    sleep 0.2
  done
  pids="$(port_pids)"
  [ -z "$pids" ] || kill -9 $pids 2>/dev/null || true
fi

# 2. 后台启动（nohup 脱离终端，脚本退出后继续运行）
nohup npm run dev >"$LOG" 2>&1 &
echo $! >"$PIDFILE"

# 3. 等端口就绪即退出（最多 ~20s）
for _ in $(seq 1 100); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "Server running on http://localhost:$PORT/ (log: $LOG)"
    exit 0
  fi
  sleep 0.2
done

echo "Server failed to start within 20s, see $LOG" >&2
exit 1
