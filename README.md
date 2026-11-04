# Onde 92 — bus 144 · 160 · 244 · 360 en direct

Site (FR) : horaires précis + suivi des bus le long du tracé, carte Leaflet, schéma de ligne, favoris, recherche d'arrêt, fiche horaire par jour, thème clair/sombre.

## Lancer
    node server.js                      # http://localhost:8092 — mode théorique
    PRIM_API_KEY=xxxx node server.js    # temps réel (clé gratuite sur prim.iledefrance-mobilites.fr)
    PRIM_MOCK=1 PORT=8093 node server.js  # démo du pipeline temps réel (données simulées, étiquetées « démo »)

Variables : `PORT` (8092), `PRIM_API_KEY`, `PRIM_DAILY_BUDGET` (900 ; 1400 si quotas augmentés), `PRIM_MIN_TTL` (60 s).
Aucune dépendance npm. La clé ne quitte jamais le serveur.

## Données
- `scripts/update-gtfs.sh` : télécharge le GTFS IDFM (~115 Mo) et régénère `data/line-XXX.json` (arrêts + coordonnées, tracés simplifiés, distances le long du tracé, toutes les courses avec leurs heures à chaque arrêt, calendrier par date). Le GTFS ne couvre que ~30 jours : relancer au moins chaque semaine (cron).
- Temps réel : PRIM « Prochains passages — requête ligne » (`/marketplace/estimated-timetable?LineRef=STIF:Line::C01169:`), 1 appel par ligne, cache ≥ 60 s et lissage automatique sur le quota journalier.

## « Est-ce que j'ai mon bus ? » (`#/monbus`)
Point de départ (géolocalisation ou adresse via api-adresse.data.gouv.fr, mémorisable « Maison » dans le navigateur) → choix de la ligne (tuiles) ou des arrêts les plus proches sur les 4 lignes → sens + arrêt. Trajet à pied OSRM (routing.openstreetmap.de, profil piéton), repli ligne droite ×1,3 à 4,8 km/h. Pour les 3 prochains bus (temps réel sinon théorique) : « Tu l'as — pars avant HH:MM » (marge 1 min), « Juste — pars maintenant en pressant le pas » (marche à 75 % du temps), « Raté — prochain à HH:MM », compte à rebours en direct.

## API locale
- `GET /api/status` — clé présente ?, budget consommé, état des données GTFS (`gtfs.source` = `commit` ou `live`).
- `GET /api/rt/144` — courses temps réel normalisées (ou `mode: "theorique"`).
- `GET /api/geocode?q=…` / `?lat=&lon=` — proxy BAN (cache 6 h).
- `GET /api/walk?from=lat,lon&to=lat,lon` — itinéraire piéton OSRM (distance, durée, tracé).

## Déploiement Render.com (plan gratuit)
- `render.yaml` (Blueprint) : service web Node, `npm start`, health check `/api/status`, `PRIM_API_KEY` en `sync: false` (à saisir dans le tableau de bord, jamais dans git).
- Le serveur écoute `process.env.PORT`. Aucune dépendance npm. Les données `data/*.json` sont versionnées : le site marche dès le premier démarrage.
- Pas de cron sur Render : avec `GTFS_AUTO_REFRESH=1` (ou automatiquement si `RENDER` est défini), le serveur vérifie toutes les heures (et 20 s après le démarrage) si les données ont plus de 6 jours (`GTFS_REFRESH_DAYS`) ou si le calendrier couvre moins de 14 jours ; si oui il lance `scripts/gtfs-build.js` dans un processus séparé (Node pur, zip lu en flux, tas plafonné ~144 Mo, pic ≈ 210 Mo RSS, ~10 s). Résultat écrit atomiquement dans `$TMPDIR/onde92-data` (`GTFS_LIVE_DIR`) puis servi ; en cas d'échec, on garde les fichiers versionnés (nouvel essai 6 h plus tard).
- Disque éphémère et mise en veille après 15 min d'inactivité sur le plan gratuit : après un réveil, l'app repart des données versionnées puis se reconstruit si elles sont trop vieilles. Pour figer des données fraîches dans git : `npm run gtfs` puis commit/push.

## Mise en ligne / exploitation (box)
- `scripts/start.sh` lance (une seule fois) `scripts/supervise.sh` : boucle de relance pour `node server.js` (charge `.env`) et pour `bin/cloudflared tunnel --protocol http2 --url http://localhost:8092`. Logs : `logs/server.log`, `logs/tunnel.log`.
- L'URL `https://*.trycloudflare.com` est écrite dans `PUBLIC_URL.txt` seulement quand le tunnel est réellement connecté.
- crontab : mise à jour GTFS le lundi 05:00 UTC (`logs/update-gtfs.log`), `start.sh` toutes les 5 min et au démarrage (garde-fou).
- Temps réel PRIM : le flux « estimated-timetable » de ce réseau regroupe les prévisions par rang de passage et non par bus ; l'app traite chaque prévision par arrêt, en déduit la position des bus via les temps de parcours théoriques, puis les rattache aux courses GTFS (retard).
- Fonds de carte : Stadia sur localhost, Esri Canvas (sans clé) sur tout autre domaine.
