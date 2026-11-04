#!/usr/bin/env bash
# Rafraîchit data/*.json depuis le GTFS IDFM (couvre ~30 jours, publié 3×/jour).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
cd "$D"
curl -sfL -o idfm.zip "https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip"
unzip -q idfm.zip agency.txt routes.txt trips.txt stop_times.txt stops.txt shapes.txt calendar.txt calendar_dates.txt
grep -E '^IDFM:(C01240|C01169|C01304|C01183),' trips.txt | cut -d, -f3 > tids.txt
grep -F -f tids.txt stop_times.txt > st4.txt
python3 "$HERE/extract.py" "$D" "$HERE/../data"
