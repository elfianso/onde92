#!/usr/bin/env bash
# Superviseur minimal : serveur Node + tunnel Cloudflare, relancés automatiquement.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; LOG="$ROOT/logs"; mkdir -p "$LOG"; cd "$ROOT"
echo $$ > "$LOG/supervisor.pid"
trap 'kill 0' EXIT INT TERM
server_loop() { while true; do
  echo "[$(date -Is)] start node" >> "$LOG/server.log"
  ( set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a; exec node "$ROOT/server.js" ) >> "$LOG/server.log" 2>&1
  echo "[$(date -Is)] node exited ($?), restart in 3 s" >> "$LOG/server.log"; sleep 3; done; }
tunnel_loop() { while true; do
  echo "[$(date -Is)] start cloudflared" >> "$LOG/tunnel.log"
  "$ROOT/bin/cloudflared" tunnel --no-autoupdate --protocol http2 --url http://localhost:${PORT:-8092} 2>&1 | while IFS= read -r l; do
    echo "$l" >> "$LOG/tunnel.log"
    x=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' <<<"$l") && [ -n "$x" ] && u="$x"
    # l'URL n'est publiée qu'une fois le tunnel réellement connecté au réseau Cloudflare
    if [ -n "$u" ] && grep -q "Registered tunnel connection" <<<"$l"; then echo "$u" > "$ROOT/PUBLIC_URL.txt"; echo "[$(date -Is)] URL publique active : $u" >> "$LOG/tunnel.log"; fi
  done
  echo "[$(date -Is)] cloudflared exited, restart in 5 s" >> "$LOG/tunnel.log"; sleep 5; done; }
server_loop & tunnel_loop &
wait
