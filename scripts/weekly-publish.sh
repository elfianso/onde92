#!/usr/bin/env bash
# Chaque semaine (cron de la box) : reconstruit les horaires de tous les réseaux puis publie (commit + push → Vercel redéploie).
# Le GTFS exporté couvre 21 jours : sans cette mise à jour, les horaires prévus s'arrêtent à la fin de la fenêtre.
# Jeton de push : .push_token (jamais affiché). S'il a expiré, le push échoue et le log le dit.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== $(date -Is) mise à jour des réseaux"
scripts/update-networks.sh
git add public/data
if git diff --cached --quiet; then echo "rien de neuf"; exit 0; fi
git -c user.name="Prochain bot" -c user.email="bot@prochain.invalid" commit -q -m "Horaires : mise à jour hebdomadaire des données GTFS ($(date +%F))"
T="$(cat .push_token)"
git push -q "https://x-access-token:${T}@github.com/elfianso/onde92.git" HEAD:main 2>&1 | sed "s/${T}/***/g"
echo "publié"
