#!/usr/bin/env bash
# Lance le superviseur en arrière-plan s'il ne tourne pas déjà (idempotent, utilisable en @reboot).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; P="$ROOT/logs/supervisor.pid"; mkdir -p "$ROOT/logs"
if [ -f "$P" ] && kill -0 "$(cat "$P")" 2>/dev/null; then echo "déjà lancé (pid $(cat "$P"))"; exit 0; fi
pgrep -x cron >/dev/null || sudo -n /usr/sbin/cron 2>/dev/null
setsid nohup "$ROOT/scripts/supervise.sh" >> "$ROOT/logs/supervisor.log" 2>&1 < /dev/null &
echo "superviseur lancé"
