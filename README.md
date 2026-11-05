# Prochain — le prochain départ, partout

**Prochain** (ex-« Onde 92 ») affiche autour de toi les prochains bus, trams, métros, RER et trains, en temps réel quand la source le permet, avec le verdict « Tu l'as / Juste / Raté » selon ta marche.
Site : <https://onde92.vercel.app> (l'URL historique est conservée ; dépôt GitHub `onde92`).

## Couverture (données ouvertes)
| Réseau | Modes | Horaires | Temps réel |
|---|---|---|---|
| Île-de-France Mobilités (toute l'IDF, ~2 000 lignes) | métro, RER, Transilien/TER IDF, tram, bus, Noctilien, câble | GTFS IDFM | PRIM « prochains passages » (stop-monitoring, par zone d'arrêt affichée) ; 144 · 160 · 244 · 360 en « requête ligne » (positions des bus) |
| Ilévia (Métropole européenne de Lille : Lille, Roubaix, Tourcoing, Villeneuve-d'Ascq…) | métro, tram, bus | GTFS Ilévia | GTFS-RT Ilévia (proxy transport.data.gouv.fr) |
| SNCF (toute la France) | TGV INOUI, OUIGO, Intercités, TER, cars TER | GTFS SNCF | GTFS-RT SNCF (retards, suppressions) |

Hors de ces réseaux (ex. bus urbains de Lyon, Marseille…), l'appli le dit et montre seulement les gares SNCF proches. **Ajouter une ville = ajouter une entrée dans `scripts/networks.json`** (URL GTFS du Point d'accès national transport.data.gouv.fr, flux GTFS-RT éventuel), puis `scripts/update-networks.sh <id>` : l'appli est entièrement pilotée par `public/data/n/networks.json`.

## Écran principal (`/`)
Carte MapLibre (OpenFreeMap) en plein écran, rond fixe au centre : déplacer la carte choisit l'endroit (GPS par défaut). Feuille à crans (aperçu / moitié / plein), sur ordinateur panneau latéral.
- **Autour d'ici** : une carte par ligne (pastille aux couleurs officielles, forme par mode : rond métro, carré RER, rectangle train, tram encadré), ses arrêts proches, temps de marche (OSRM), et pour chaque sens le prochain départ en grand, `Live` (icône ondes) ou `Prévu`, le verdict, les deux suivants, l'étiquette « fin » (dernier de la soirée). Les lignes qui passent dans l'heure d'abord. Toucher un sens : tous ses départs, retards, et lien vers tous les départs de l'arrêt.
- **Filtres** : par mode (Métro, RER, Train, Tram, Bus…) puis par ligne.
- **Où vas-tu ?** : lieux OSM + adresses BAN, biaisés autour de toi ; options **directes** (une seule ligne) parmi les lignes chargées autour de toi, arrivée estimée, marche aux deux bouts. Pour les trajets avec correspondance, lien vers Google Maps (transports).
- Rayon : 800 m (élargi à 1,5 puis 2,5 km si vide) ; la gare SNCF la plus proche jusqu'à 3 km s'ajoute ; jusqu'à 6 km en zone sans réseau urbain.
- Liens directs : `/#at=50.6905,3.1817` (endroit) et `/#?to=La%20D%C3%A9fense` (destination).

## Architecture des données
- `scripts/build-network.js <réseau> [zip|-]` lit un GTFS **en flux** (stop_times traité course par course, ~0,9 Go de pointe pour l'IDFM) et écrit `public/data/n/<réseau>/` :
  - `lines.json` : catalogue (libellé, mode, couleurs, terminus) ;
  - `l/<id>.json` : une ligne = arrêts, motifs (tracé simplifié), calendrier sur **21 jours**, courses `[service, motif, départ, profil de temps]` (profils dédupliqués) — même moteur que l'ancienne version (départs, « fin », verdict, trajets directs, interpolation des véhicules) ;
  - `t/<y>_<x>.json` : tuiles d'arrêts (~2,2 × 2,2 km ; 11 × 11 km pour la SNCF) → « autour d'ici » ne télécharge que les tuiles et lignes proches, n'importe où.
  - `node scripts/build-network.js index` régénère `public/data/n/networks.json`.
- Tailles (nov. 2026) : IDFM 2 024 lignes / 56 Mo (≈ 14 Mo gzip), Ilévia 157 / 3 Mo, SNCF 961 / 8,5 Mo. Un écran typique charge 10–40 fichiers de quelques Ko à ~200 Ko.
- `scripts/update-networks.sh` reconstruit tout (+ fiches `public/data/line-*.json` des 4 lignes historiques, `scripts/gtfs-build.js`). **À relancer au moins chaque semaine** (fenêtre de 21 jours ; il n'y a pas encore de workflow automatique committé). Chaque reconstruction committée ajoute ~15–20 Mo compressés à l'historique git : à terme, publier les données ailleurs (Blob/R2) plutôt que dans le dépôt.

## Temps réel et quotas (honnêtement)
- **IDFM / PRIM** (clé `PRIM_API_KEY`, jamais renvoyée au client) :
  - `GET /api/sm/<zone>` : *stop-monitoring* d'une zone d'arrêt (toutes ses lignes en 1 appel). Le navigateur n'interroge que les ≤ 3 zones les plus proches du centre de la carte, toutes les 60 s. Cache CDN partagé par zone : 120 s de 06:30 à 20:30, 300 s sinon (`SM_TTL_PEAK`, `SM_TTL_OFFPEAK`) ; zone vide 10 min ; hors périmètre 6 h. Budget par instance `PRIM_SM_DAILY_BUDGET` (950/jour) puis repli sur l'horaire théorique.
  - Quota PRIM par défaut **1 000 appels/jour** pour ce service : soit ~8 zones suivies en continu en heure de pointe. Au-delà, l'appli affiche « Prévu ». **Demander l'augmentation gratuite** dans PRIM → « Ma consommation API » (jusqu'à 1 M/jour) est recommandé dès qu'il y a plusieurs utilisateurs dans des endroits différents.
  - `GET /api/rt/<144|160|244|360>` : *estimated-timetable* par ligne (quota séparé, ~850/jour au pire), pour les positions des bus de ces 4 lignes.
- **Ilévia et SNCF** : `GET /api/gtfsrt/<ilevia|sncf>` lit le flux GTFS-RT ouvert (décodeur protobuf maison `lib/gtfsrt.js`), cache 30 s / 60 s, sans quota. Les autres réseaux sont en horaires théoriques.
- Limites : caches CDN régionaux et mémoire par instance (pas d'état partagé) ; positions de véhicules = interpolation sur l'horaire (+ temps réel) des lignes proches, pas de GPS des véhicules.

## Lancer
    PORT=3000 node scripts/vercel-local.js   # comme sur Vercel (statique + /api/*) ; charger .env avant pour le temps réel
    node server.js                           # ancien serveur Node (4 lignes historiques uniquement)

Aucune dépendance npm.

## API
- `GET /api/status` — réseaux couverts, dates des données, état des caches et des quotas temps réel (jamais la clé).
- `GET /api/sm/<zone>` · `GET /api/gtfsrt/<réseau>` · `GET /api/rt/<ligne>` — temps réel normalisé (voir ci-dessus).
- `GET /api/geocode?q=…&near=lat,lon` / `?lat=&lon=` — lieux OSM (Photon, repli Nominatim) + adresses BAN, biaisés autour de `near` (Paris par défaut).
- `GET /api/walk?from=lat,lon&to=lat,lon` — itinéraire piéton OSRM.

## Déploiement Vercel (Hobby)
- `public/` servi tel quel (pas de build) ; fonctions `api/` (Node 22, région `cdg1`) qui n'embarquent que `public/data/*.json` + `n/networks.json` (pas les 6 800 fichiers de lignes).
- Variable : `PRIM_API_KEY` (Production + Preview).
- Nom : l'appli s'appelle « Prochain » dans l'interface ; le projet Vercel reste `onde92`. **Renommer le projet Vercel changerait le domaine par défaut** (`<nouveau-nom>.vercel.app`) et casserait les liens existants : pour un nouveau domaine, ajouter plutôt un domaine/alias dans Vercel en gardant `onde92.vercel.app`.

## Fiches des 4 lignes historiques (`/lignes.html`)
Fiches détaillées des lignes 144 · 160 · 244 · 360 (horaires, plan, « Est-ce que j'ai mon bus ? »).

## « Est-ce que j'ai mon bus ? » (`/lignes.html#/monbus`)
Point de départ (géolocalisation ou adresse via api-adresse.data.gouv.fr, mémorisable « Maison » dans le navigateur) → choix de la ligne (tuiles) ou des arrêts les plus proches sur les 4 lignes → sens + arrêt. Trajet à pied OSRM (routing.openstreetmap.de, profil piéton), repli ligne droite ×1,3 à 4,8 km/h. Pour les 3 prochains bus (temps réel sinon théorique) : « Tu l'as — pars avant HH:MM » (marge 1 min), « Juste — pars maintenant en pressant le pas » (marche à 75 % du temps), « Raté — prochain à HH:MM », compte à rebours en direct.

## Logique « Autour de moi » / « On va où ? » (historique, 4 lignes — reprise et généralisée par l'écran principal)
Adresse (BAN) ou « Me localiser » : carte des arrêts des 4 lignes à moins de 800 m (repli 1,5 km), triés par temps de marche (OSRM piéton, estimation sinon), et prochains bus par ligne et par direction (filtre « Je vais vers »), avec minutes, source (Live = estimation PRIM / Prévu = GTFS), verdict « Tu l'as / Juste / Raté » et le bus suivant. « On va où ? » cherche, pour chaque ligne et sens, l'arrêt de montée près du départ et l'arrêt de descente près de la destination (≤ 1 km, arrêts de même nom regroupés : « La Défense »), avec temps de trajet tiré des horaires GTFS de la course. Si aucune ligne ne convient, le site le dit. Aucun appel PRIM supplémentaire : le navigateur réutilise les endpoints `/api/rt/<ligne>` en cache CDN.

« fin » sous un horaire = dernier passage de la soirée à cet arrêt dans ce sens (prochain départ ≥ 3 h plus tard ; gère les courses après minuit qu'IDFM range dans la journée de service suivante).

