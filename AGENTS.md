# Guide Agents - MelodyQuest

Ce depot contient le frontend statique MelodyQuest. Il doit rester simple a reprendre: pas de build, pas de dependances Node obligatoires, et pas de backend local dans ce repo.

## Lecture de demarrage

1. Lire `P:\AGENTS.md`.
2. Lire `P:\DEV\GitHub\AGENTS.md`.
3. Lire ce fichier.
4. Lire `README.md`.
5. Si le changement touche l'API ou la DB, lire aussi `P:\DEV\GitHub\API\melodyquest\README.md` et les migrations `P:\DEV\GitHub\API\melodyquest\sql\`.

## Source de verite

- Frontend DEV: `P:\DEV\GitHub\MelodyQuest`
- Frontend PROD: `P:\PROD\MelodyQuest`
- Backend actif: `P:\DEV\GitHub\API\melodyquest`
- Endpoint API: `https://api.shinederu.ch/melodyquest/`
- Endpoint front: `https://melodyquest.shinederu.ch/`

Le repo MelodyQuest actuel ne contient pas de dossier `client/` ou `backend/` actif. Ne pas recreer ces miroirs sans demande explicite.

## Organisation

- `index.html`: point d'entree statique et cache-bust global.
- `assets/css/main.css`: style global.
- `assets/views/*View.html`: fragments HTML charges par route.
- `assets/js/controller/*Controller.js`: logique par vue.
- `assets/js/model/`: modeles UI partages.
- `assets/js/utils/`: helpers HTTP, lobby, YouTube et QR.
- `assets/js/vendor/`: bibliotheques vendorees necessaires au navigateur.

Helpers partages a reutiliser avant de creer une logique locale:

- `assets/js/utils/ui.js`: HTML/attribut escaping, normalisation de recherche, slugs, dates, rangs, roles joueurs et avatars.
- `assets/js/utils/youtube.js`: extraction/build d'URL YouTube et chargement unique de l'API iframe.

Le dossier `output/` n'est pas requis par l'application. S'il reapparait vide, le supprimer.

## Routes frontend

Les routes sont gerees par hash dans `assets/js/controller/AppController.js`.

- Publiques: `#/public`, `#/suggest-track`, `/tv`
- Authentifiees: `#/main`, `#/lobby-list`, `#/lobby`, `#/game`, `#/result`, `#/tv-link`
- Admin catalogue: `#/management`, `#/management-categories`, `#/management-families`, `#/management-tracks`, `#/management-validation`, `#/management-suggestions`

Conserver les redirections existantes:

- utilisateur non connecte vers `#/public`;
- utilisateur connecte hors pages publiques vers `#/main`;
- non-admin hors pages management vers `#/main`;
- `#/lobby?code=...` et `#/tv-link?code=...` gardent le code en attente pendant la connexion.

## Fonctionnalites a preserver

- Login/register/logout via `shinederu-auth-core`.
- Creation/rejoindre lobby public ou prive.
- Reglages lobby: categories, timer, manches, visibilite, categorie visible, vote de revelation, seuil de precision.
- Jeu desktop/mobile avec video cachee, reponse, classement, timer, partage, suggestions de correction.
- Mode joueur de salon sans lecteur video local.
- Mode TV avec QR code, liaison `tv-link`, son actif, prechargement de la prochaine video.
- Administration catalogue et suggestions joueurs.

## Cache-bust

Quand un JS, une vue HTML ou le CSS change, mettre a jour la version:

- `index.html` pour `main.css` et `AppController.js`;
- imports de `AppController.js`;
- imports directs dans les autres modules touches (`PublicController`, `TvController`, `TvLinkController`, etc.).

Utiliser une valeur lisible du type `YYYYMMDD-sujet`.

## Verification

Verification minimale frontend:

```powershell
Get-ChildItem P:\DEV\GitHub\MelodyQuest\assets\js -Recurse -Filter *.js | % { node --check $_.FullName }
git -c safe.directory=* diff --check
rg -n "console\.|alert\(|debugger" P:\DEV\GitHub\MelodyQuest\assets
```

Smoke test recommande en production apres deploiement:

1. `#/public`: login et message d'erreur integre.
2. `#/main`: salons publics et creation/rejoindre.
3. `#/lobby`: chargement reglages/categories/joueurs.
4. `#/game`: layout desktop/mobile, champ reponse, timer, video cachee.
5. `/tv` + `#/tv-link`: QR/lien TV si le changement touche ces zones.
6. Pages management si le changement touche catalogue ou suggestions.

## Deploiement

Projet statique: copier les fichiers modifies depuis DEV vers `P:\PROD\MelodyQuest`.

Ne pas supprimer massivement en PROD. Si un nettoyage est necessaire, verifier d'abord les references dans `index.html` et les imports JS.

## Encodage

Les fichiers UI contiennent du texte francais avec accents. En PowerShell, preferer:

```powershell
Get-Content -Encoding UTF8 <fichier>
```

Cela evite l'affichage mojibake dans les terminaux qui lisent l'UTF-8 sans BOM comme ANSI.
