# MelodyQuest

## Role

Frontend statique du blindtest multijoueur MelodyQuest.

Ce depot contient uniquement le client navigateur. Le backend source vit dans `P:\DEV\GitHub\App-MelodyQuest-API` et expose `https://api.shinederu.ch/melodyquest/` une fois deploye sous `P:\PROD\API\melodyquest`.

## Etat de pause - 2026-06-12

Le projet est mis en pause dans un etat stable de reprise. Les changements applicatifs de reference ont restaure le mode TV sur un lecteur YouTube iframe simple, puis une passe player a reduit le buffering sans retenter le double lecteur:

- cache-bust JS courant: `20260613-player-subsecond-sync`;
- cache-bust CSS courant: `20260613-tv-hidden-video`;
- commit frontend applicatif de reference: `295dd11 Restore basic MelodyQuest TV player`;
- commit API applicatif de reference: `28dbdda Remove MelodyQuest TV ready playback flow`;
- fichiers deployes dans `P:\PROD\MelodyQuest` et `P:\PROD\API\melodyquest`.

Etat player 2026-06-13: la qualite YouTube n'est plus forcee en 1080p, les domaines YouTube sont preconnectes, l'API iframe est prechauffee en entrant dans le lobby/game/TV, les erreurs YouTube sont affichees clairement et la resynchronisation du player joueur est moins agressive. La TV garde un lecteur YouTube unique: elle limite les re-renders via la revision backend, poll moins vite hors phase d'ecoute, met son timer a jour toutes les 500 ms, peut preparer la prochaine piste avec `cueVideoById` seulement quand aucune manche n'est active et reduit la surface reelle de l'iframe quand la video est masquee. La cle de rendu TV inclut les champs de solution pour eviter qu'un snapshot revele mais encore masque bloque l'affichage de la reponse. Pendant la phase solution/vote, le lecteur courant n'est plus touche: avec un iframe unique, cue la piste suivante remplace visuellement la video revelee. La passe `20260613-player-clock-sync` ajoute une horloge navigateur corrigee par RTT pour les snapshots HTTP, puis limite les seeks en cours de manche aux recuperations bufferisees. La passe `20260613-player-subsecond-sync` resserre l'objectif sous la seconde: joueur `0.75s` au depart et `0.95s` en recuperation; TV `0.85s` au depart et `0.95s` en recuperation. Les seeks restent refuses si YouTube bufferise ou si la cible ne semble pas chargee. Point sensible a reprendre plus tard: le chargement YouTube sur TV peut encore avoir des delais ou coupures selon la video/le navigateur. Les essais avec double lecteur TV, prechargement TV actif et signal backend "TV prete" ont ete abandonnes car ils ont provoque des cas sans video/son. Ne pas les remettre sans nouvelle piste verifiee. L'hebergement local de fichiers audio a ete refuse; YouTube doit rester la source principale.

Dernieres verifications connues:

- `Get-ChildItem .\assets\js -Recurse -Filter *.js | % { node --check $_.FullName }`
- `git -c safe.directory=* diff --check`
- `rg -n "console\.|alert\(|debugger" assets`
- smoke test `/tv`: QR affiche, script `20260613-player-subsecond-sync`, CSS `20260613-tv-hidden-video`, aucun conteneur `tv-video-preload-player`, aucune erreur console.

## Reprise rapide agent

1. Lire `AGENTS.md`.
2. Verifier l'etat Git:

```powershell
git -c safe.directory=* status --short
```

3. Pour lire les fichiers avec accents dans PowerShell:

```powershell
Get-Content -Encoding UTF8 README.md
```

4. Lancer les checks apres modification:

```powershell
Get-ChildItem .\assets\js -Recurse -Filter *.js | % { node --check $_.FullName }
git -c safe.directory=* diff --check
rg -n "console\.|alert\(|debugger" assets
```

5. Si le changement touche l'API, lire aussi `P:\DEV\GitHub\App-MelodyQuest-API\README.md`.
6. Deployer uniquement les fichiers runtime publics (`index.html` et `assets\`) vers `P:\PROD\MelodyQuest`, puis commit/push sur `main`.

## Organisation du depot

- `index.html`: point d'entree HTML, configuration API publique et cache-bust principal.
- `assets/css/main.css`: style global sombre et responsive.
- `assets/views/*View.html`: fragments HTML charges par route.
- `assets/js/controller/*Controller.js`: logique de chaque vue.
- `assets/js/model/`: modeles UI transverses.
- `assets/js/utils/`: helpers HTTP, etat lobby, UI commune, YouTube et QR.
- `assets/js/vendor/`: dependances vendorees pour navigateur (`@shinederu/auth-core`, `jsQR`).

Les helpers reutilisables doivent rester dans `assets/js/utils/`:

- `ui.js`: echappement HTML/attribut, recherche normalisee, slug, dates, rangs, roles joueurs et avatars.
- `youtube.js`: extraction/build d'URL YouTube et chargement partage de l'API iframe.

Eviter de recopier ces helpers dans les controleurs.

Il n'y a plus de dossier `client/` ou `backend/` actif dans ce repo. L'API MelodyQuest est centralisee dans le repo `App-MelodyQuest-API`.

Le dossier `output/` n'est pas utilise par l'application. S'il reapparait vide, il peut etre supprime.

## Repo et deploiement

- Front DEV: `P:\DEV\GitHub\App-MelodyQuest`
- Front PROD: `P:\PROD\MelodyQuest`
- Repo GitHub: `https://github.com/Shinederu/App-MelodyQuest.git`

Le dossier PROD ne doit pas etre un clone du repo. Il ne doit contenir que:

- `index.html`;
- `assets\css\`;
- `assets\views\`;
- `assets\js\`;
- les assets publics necessaires au navigateur.

Ne pas deployer `README.md`, `AGENTS.md`, `.git`, `.github`, fichiers de test, caches, brouillons, dossiers `output\` ou autres documents internes.

## Endpoints

- Front public: `https://melodyquest.shinederu.ch/`
- API MelodyQuest: `https://api.shinederu.ch/melodyquest/`
- API Auth: `https://api.shinederu.ch/auth/`
- Hub Mercure: `https://mercure.shinederu.ch/.well-known/mercure`

Le serveur Nginx doit servir `P:\PROD\MelodyQuest` avec fallback vers `index.html`, notamment pour `/tv`.

## Routes client

Les routes principales sont gerees par `assets/js/controller/AppController.js`.

- `#/public`: connexion/inscription.
- `#/suggest-track`: proposition publique de musique.
- `/tv`: ecran TV public.
- `#/tv-link`: liaison d'une TV au salon courant.
- `#/main`: accueil joueur, creation/rejoindre salon et liste des salons publics.
- `#/lobby-list`: ancienne liste dediee des salons publics, conservee pour compatibilite.
- `#/lobby`: salon, joueurs, invitations et reglages.
- `#/game`: manche en cours.
- `#/result`: resultats.
- `#/management`: hub administration catalogue.
- `#/management-categories`: categories.
- `#/management-families`: oeuvres/reponses attendues.
- `#/management-tracks`: pistes jouables.
- `#/management-validation`: validation/correction des pistes en attente.
- `#/management-suggestions`: suggestions joueurs.

## Fonctionnalites produit

- Blindtest multijoueur en ligne.
- Authentification centralisee via le package `@shinederu/auth-core` fourni par `Module-Auth-Core`.
- Salons publics ou prives, rejoignables par code ou URL partagee.
- Reglages de lobby: nombre de manches, timer, categories, visibilite de la categorie, vote de revelation, precision de validation des reponses.
- Validation souple des reponses geree cote API selon le seuil du lobby.
- Jeu responsive desktop/mobile avec lecteur YouTube cache avant revelation.
- Mode joueur de salon: interface reponse seule quand une TV est liee.
- Mode TV: QR code, liaison depuis mobile, affichage plein ecran sans navigation et lecteur YouTube actif simple. Le lecteur d'avance et le signal "TV prete" sont des pistes abandonnees pour revenir a un comportement stable.
- Suggestions joueurs: alias, correction URL/libelle/artiste/licence, proposition publique de nouvelle musique.
- Administration catalogue: categories, oeuvres, musiques, validation, suggestions.

## Authentification et permissions

- Authentification navigateur via `@shinederu/auth-core`, vendore depuis `Module-Auth-Core`.
- Base API auth: `https://api.shinederu.ch/auth/`.
- Cookie session partage: `sid`, domaine `.shinederu.ch`.
- Le frontend ne decide pas des droits. Les pages management s'appuient sur l'etat utilisateur renvoye par les APIs; les controles reels restent cote API.
- Permission admin catalogue attendue cote backend: `melodyquest.catalog.manage`.

## Base de donnees

Le backend source est dans `P:\DEV\GitHub\App-MelodyQuest-API`.

La DB partagee est `ShinedeCore`. MelodyQuest utilise les tables `mq_*`.

Les migrations MelodyQuest sont dans:

```text
P:\DEV\GitHub\App-MelodyQuest-API\sql\
```

Les droits admin catalogue passent par les tables `core_*`. La permission stable attendue est:

```text
melodyquest.catalog.manage
```

En PHP, elle correspond a:

```php
hasPermission($userId, 'melodyquest', 'catalog.manage')
```

## Dossiers runtime et fichiers partages

- Le frontend ne possede aucun stockage persistant.
- Les fichiers publics servis sont uniquement dans `P:\PROD\MelodyQuest`.
- Aucun fichier utilisateur ne doit etre ecrit dans le dossier frontend public.
- Les propositions de musiques, suggestions, lobbies, scores et liaisons TV sont stockes en DB via l'API `melodyquest`.

## Temps reel et evenements

- Le frontend consomme Mercure quand `data.realtime.transport=mercure` est fourni par l'API.
- Topics documentes cote API:
  - `https://api.shinederu.ch/melodyquest/topics/public-lobbies`
  - `https://api.shinederu.ch/melodyquest/topics/lobbies/{LOBBY_CODE}`
- Il n'y a pas de fallback SSE supporte dans l'API actuelle.
- Apres une reconnexion ou une erreur temps reel, l'etat est reconstruit par API HTTP (`listPublicLobbies`, `getLobbyByCode`, `getRoundState`).

## Dependances inter-projets

- `App-MelodyQuest-API`: toutes les actions de jeu, catalogue, TV, suggestions et temps reel.
- `Module-Auth-API`: login, logout, session, details compte.
- `Module-Auth-Core`: client auth navigateur vendore.
- Mercure: snapshots lobbies publics/prives.
- YouTube iframe API: lecture des pistes, a partir d'identifiants video stockes par l'API.

Le frontend n'ecrit jamais directement en DB et ne communique pas avec un autre projet autrement que par API HTTP documentee ou abonnement Mercure.

## Configuration

La configuration publique est dans `index.html`:

```js
window.__SHINEDERU_API_ROOT__ = "https://api.shinederu.ch";
```

Changer cette valeur uniquement si l'hote API public change. Aucun secret ne doit etre ajoute au frontend.

## Cache-bust

Les assets sont servis avec cache long. En cas de changement frontend, mettre a jour la version dans:

- `index.html`;
- imports de `assets/js/controller/AppController.js`;
- imports directs des modules touches.

Convention conseillee: `YYYYMMDD-sujet-court`, par exemple `20260610-agent-audit`.

Le cache-bust `20260612-tv-basic-player` marque le rollback volontaire du mode TV vers un lecteur YouTube actif simple. Le cache-bust `20260613-player-warmup` garde ce lecteur simple, retire le 1080p force, prechauffe YouTube et ajoute les erreurs player explicites. Le cache-bust JS `20260613-tv-preload-loop` reduit la charge de la vue TV et ajoute le prechargement de la piste suivante via le lecteur unique. Le cache-bust JS `20260613-tv-reveal-fix` corrige l'affichage de la solution TV quand les champs de reponse arrivent dans un snapshot sans nouvelle revision. Le cache-bust JS `20260613-tv-no-reveal-cue` empeche le lecteur TV de cue la piste suivante pendant la phase solution/vote. Le cache-bust JS `20260613-player-clock-sync` ajoute la correction RTT de l'horloge client et rend les seeks de recuperation buffer-aware. Le cache-bust JS `20260613-player-subsecond-sync` resserre les seuils de recalage sous la seconde. Le cache-bust CSS `20260613-tv-hidden-video` force le rafraichissement du style qui reduit la surface de l'iframe TV quand la video est masquee.

## Diagnostics player

Les diagnostics de synchronisation sont desactives par defaut. Pour mesurer une partie sans ajouter de logs permanents, ouvrir le site avec `?mqDebugSync=1` ou executer dans la console navigateur:

```js
localStorage.setItem("mq_sync_diagnostics", "1")
```

Les evenements sont conserves en memoire dans `window.__mqSyncDiagnostics` avec les offsets d'horloge, derives et decisions de seek ignorees ou appliquees.

## Verifications

```powershell
Get-ChildItem P:\DEV\GitHub\App-MelodyQuest\assets\js -Recurse -Filter *.js | % { node --check $_.FullName }
git -c safe.directory=* diff --check
rg -n "console\.|alert\(|debugger" P:\DEV\GitHub\App-MelodyQuest\assets
```

Smoke test recommande:

1. `#/public`: login/register.
2. `#/main`: creation/rejoindre salon et liste publique.
3. `#/lobby`: reglages, categories, joueurs.
4. `#/game`: manche, champ reponse, timer, video cachee.
5. `/tv` + `#/tv-link`: QR/lien TV si la zone TV est touchee.
6. Pages `#/management*` si catalogue/suggestions sont touches.

## Deploiement

Copier uniquement le runtime public:

```powershell
Copy-Item P:\DEV\GitHub\App-MelodyQuest\index.html P:\PROD\MelodyQuest\index.html -Force
Copy-Item P:\DEV\GitHub\App-MelodyQuest\assets\* P:\PROD\MelodyQuest\assets -Recurse -Force
```

Apres copie, verifier qu'aucun fichier interne n'est present en PROD:

```powershell
Get-ChildItem P:\PROD\MelodyQuest -Force |
  Where-Object { $_.Name -in @('README.md','AGENTS.md','.git','.github','output') }
```

## Points a surveiller a la reprise

- Verifier que `P:\PROD` reflete bien le contenu servi par Nginx avant de conclure qu'un deploiement est live.
- Tester un vrai salon avec au moins deux joueurs si le changement touche `#/lobby`, `#/game`, les votes, suggestions ou scores.
- Tester `/tv` + `#/tv-link` uniquement avec le lecteur TV simple actuel, sans recreer de lecteur d'avance.
- Garder `#/lobby-list` pour compatibilite, meme si la liste publique est maintenant visible depuis `#/main`.
- Les optimisations de chargement YouTube TV restent ouvertes, mais doivent etre traitees comme une nouvelle recherche technique, pas comme une restauration du double lecteur precedent.

## Nginx attendu

Exemple minimal:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name melodyquest.shinederu.ch;
    root /var/www/MelodyQuest;

    index index.html;

    location ^~ /assets/ {
        try_files $uri =404;
        access_log off;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location = /index.html {
        expires -1;
        add_header Cache-Control "no-store";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Checklist avant livraison

- Aucun dossier temporaire vide inutile dans le repo.
- Aucun secret ajoute.
- Pas de `console.log`, `alert()` ou `debugger` dans le code applicatif.
- JS valide avec `node --check`.
- Cache-bust mis a jour si un asset deploye change.
- Fichiers runtime modifies copies en PROD, sans README/AGENTS/docs internes.
- Commit et push effectues sur `main`.
