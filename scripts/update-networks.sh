#!/usr/bin/env bash
# Reconstruit public/data/n/ (tous les réseaux de scripts/networks.json) + public/data/line-*.json (fiches 144/160/244/360).
# Les GTFS ne couvrent que quelques semaines et la fenêtre exportée est de 21 jours : à relancer au moins chaque semaine.
# Mémoire : ~0,9 Go pour l'IDFM (flux), quelques centaines de Mo pour les autres.
set -euo pipefail
cd "$(dirname "$0")/.."
NETS="${*:-$(node -e 'console.log(Object.keys(require("./scripts/networks.json").networks).join(" "))')}"
for n in $NETS; do node --max-old-space-size=2400 scripts/build-network.js "$n"; done
node scripts/build-network.js index
node --max-old-space-size=400 scripts/gtfs-build.js public/data
