# Onde 92 — bus 144 · 160 · 244 · 360 en direct

Site (FR), un seul écran : le site demande ta position et affiche tout de suite les bus des 4 lignes autour de toi, avec une barre « Où vas-tu ? » pour trouver le bus qui t'y emmène. Les pages par ligne (schéma, fiche horaire, favoris) restent accessibles via « Lignes et horaires » (`/lignes.html`).

## Écran principal (`/`)
- `public/index.html` + `public/onde.js` + `public/onde.css`, moteur commun dans `public/core.js` (horaires, temps réel, marche, verdicts, itinéraire), partagé avec `/lignes.html`.
- Carte MapLibre GL 5 (vendorisée dans `public/vendor/maplibre/`, UMD), fond OpenFreeMap « liberty » (clair) / « dark » (sombre), bouton satellite (Esri World Imagery + noms de rues). Rotation et inclinaison désactivées.
- Chaque arrêt porte des pastilles colorées de ses lignes (images dessinées en canvas, couche symbole avec détection de collision : points dès z12, pastilles dès z13,4, noms dès z15,6 ; les arrêts proches passent en priorité). Toucher un arrêt → prochains bus par ligne et par direction.
- Rond fixe au centre de la carte : déplacer ou zoomer la carte choisit le nouvel endroit (liste recalculée), pastille bleue + cercle de précision pour le GPS réel. Recentrage sur le GPS (ou la dernière adresse). Bus en circulation interpolés le long du tracé avec halo « sonar ».
- Au chargement : GPS, sinon dernière position, sinon le secteur Rueil / Suresnes. Arrêts à moins de 800 m (élargi à 1,5 puis 2,5 km si rien), meilleure option par ligne et direction (« vers <terminus> »), minutes Live/Prévu, bus suivants, temps de marche et verdict ; toucher une ligne → arrêt, départs suivants, « fin ». Le nom du lieu dans la ligne de statut ouvre le changement de point de départ.
- « Où vas-tu ? » (arrêts des 4 lignes + lieux OpenStreetMap via Photon/Nominatim et adresses BAN : commerces, écoles, gares, parcs, adresses…) → itinéraire parmi les 4 lignes depuis le point au centre : montée, descente, prochain départ + verdict, durée ; sinon « aucune des 4 lignes ne t'y emmène ».
- Mobile : la carte est le héros ; une feuille bascule sur trois crans (aperçu / moitié / plein), avec « Où vas-tu ? » collé en tête, une ligne de statut courte, des filtres de ligne (144 / 160 / 244 / 360) et une liste groupée. Bureau (≥ 900 px) : panneau latéral stable à gauche + carte. Mode sombre, vue satellite et les pages « Lignes et horaires » sont dans un petit menu.
- Anciennes URL `#/ligne/…`, `#/arret`, `#/monbus` redirigées vers `/lignes.html`.

## Lancer
    node server.js                      # http://localhost:8092 — mode théorique
    PRIM_API_KEY=xxxx node server.js    # temps réel (clé gratuite sur prim.iledefrance-mobilites.fr)
    PRIM_MOCK=1 PORT=8093 node server.js  # démo du pipeline temps réel (données simulées, étiquetées « démo »)

Variables : `PORT` (8092), `PRIM_API_KEY`, `PRIM_DAILY_BUDGET` (900 ; 1400 si quotas augmentés), `PRIM_MIN_TTL` (60 s).
Aucune dépendance npm. La clé ne quitte jamais le serveur.

## Données
- `scripts/update-gtfs.sh` : télécharge le GTFS IDFM (~115 Mo) et régénère `public/data/line-XXX.json` (arrêts + coordonnées, tracés simplifiés, distances le long du tracé, toutes les courses avec leurs heures à chaque arrêt, calendrier par date). Le GTFS ne couvre que ~30 jours : relancer au moins chaque semaine (cron).
- Temps réel : PRIM « Prochains passages — requête ligne » (`/marketplace/estimated-timetable?LineRef=STIF:Line::C01169:`), 1 appel par ligne, cache ≥ 60 s et lissage automatique sur le quota journalier.

## « Est-ce que j'ai mon bus ? » (`/lignes.html#/monbus`)
Point de départ (géolocalisation ou adresse via api-adresse.data.gouv.fr, mémorisable « Maison » dans le navigateur) → choix de la ligne (tuiles) ou des arrêts les plus proches sur les 4 lignes → sens + arrêt. Trajet à pied OSRM (routing.openstreetmap.de, profil piéton), repli ligne droite ×1,3 à 4,8 km/h. Pour les 3 prochains bus (temps réel sinon théorique) : « Tu l'as — pars avant HH:MM » (marge 1 min), « Juste — pars maintenant en pressant le pas » (marche à 75 % du temps), « Raté — prochain à HH:MM », compte à rebours en direct.

## Logique « Autour de moi » / « On va où ? » (reprise par l'écran principal)
Adresse (BAN) ou « Me localiser » : carte des arrêts des 4 lignes à moins de 800 m (repli 1,5 km), triés par temps de marche (OSRM piéton, estimation sinon), et prochains bus par ligne et par direction (filtre « Je vais vers »), avec minutes, source (Live = estimation PRIM / Prévu = GTFS), verdict « Tu l'as / Juste / Raté » et le bus suivant. « On va où ? » cherche, pour chaque ligne et sens, l'arrêt de montée près du départ et l'arrêt de descente près de la destination (≤ 1 km, arrêts de même nom regroupés : « La Défense »), avec temps de trajet tiré des horaires GTFS de la course. Si aucune ligne ne convient, le site le dit. Aucun appel PRIM supplémentaire : le navigateur réutilise les endpoints `/api/rt/<ligne>` en cache CDN.

« fin » sous un horaire = dernier passage de la soirée à cet arrêt dans ce sens (prochain départ ≥ 3 h plus tard ; gère les courses après minuit qu'IDFM range dans la journée de service suivante).

## API locale
- `GET /api/status` — clé présente ?, budget consommé, état des données GTFS (`gtfs.source` = `commit` ou `live`).
- `GET /api/rt/144` — courses temps réel normalisées (ou `mode: "theorique"`).
- `GET /api/geocode?q=…[&near=lat,lon]` / `?lat=&lon=` — lieux OSM (Photon, repli Nominatim) + adresses BAN (cache 6 h).
- `GET /api/walk?from=lat,lon&to=lat,lon` — itinéraire piéton OSRM (distance, durée, tracé).

## Déploiement Vercel (Hobby, gratuit)
- Statique : `public/` (dont `public/data/*.json`, les horaires GTFS versionnés). Pas d'étape de build, pas de dépendance npm (`vercel.json` : `outputDirectory: public`, `installCommand: ""`, fonctions en région `cdg1`).
- Fonctions (`api/`, Node 22, CommonJS) : `api/status.js`, `api/rt/[line].js` (proxy PRIM), `api/geocode.js`, `api/walk.js`. Logique partagée avec `server.js` dans `lib/core.js`.
- Variable d'environnement : `PRIM_API_KEY` (Production + Preview). Optionnel : `RT_TTL_PEAK` (270), `RT_TTL_OFFPEAK` (900).
- Quota PRIM (1000 req/jour par défaut) en serverless, sans état partagé :
  - chaque réponse `/api/rt/:ligne` porte `Cache-Control: public, max-age=0, s-maxage=<reste>, stale-while-revalidate=60, stale-if-error=600` : le CDN Vercel ne rappelle la fonction qu'une fois par fenêtre et par ligne ;
  - fenêtre de 270 s de 06:30 à 20:30 (Paris), 900 s sinon ; aucune requête PRIM quand aucune course n'est prévue (±30 min) ;
  - cache mémoire identique dans l'instance chaude (s-maxage = temps restant, donc tous les caches expirent ensemble) ;
  - pire cas calculé sur les horaires réels : ~850 appels/jour (4 lignes en continu), affiché dans `/api/status` (`rtCache.worstCasePrimCallsToday`).
  - Limites : le cache CDN est régional (visiteurs hors Europe = autre cache) et chaque instance froide a son propre cache mémoire ; pour un usage local (Île-de-France) cela reste ≈ 1 région / 1 instance.
- Données : GitHub Actions `.github/workflows/update-gtfs.yml` (lundi 05:00 UTC + manuel) reconstruit `public/data` avec `scripts/gtfs-build.js` et committe si ça a changé → Vercel redéploie.
- Test local sans CLI Vercel : `node scripts/vercel-local.js` (sert `public/` + route `/api/*` vers les fonctions).

## Hébergement Node classique (optionnel)
- `npm start` = `node server.js` (écoute `PORT`). Sur un hôte sans cron, `GTFS_AUTO_REFRESH=1` reconstruit le GTFS au runtime (processus séparé, ~210 Mo RSS, résultat dans `$TMPDIR/onde92-data`, repli sur `public/data`).
