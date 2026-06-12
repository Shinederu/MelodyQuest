# MelodyQuest

Frontend statique du blindtest multijoueur MelodyQuest.

Ce depot contient uniquement le client navigateur. Le backend source vit dans `P:\DEV\GitHub\App-MelodyQuest-API` et expose `https://api.shinederu.ch/melodyquest/` une fois deploye sous `P:\PROD\API\melodyquest`.

## Etat de pause - 2026-06-12

Le projet est mis en pause dans un etat stable de reprise. Les derniers changements applicatifs avant cette pause ont restaure le mode TV sur un lecteur YouTube iframe simple:

- cache-bust frontend courant: `20260612-tv-basic-player`;
- commit frontend applicatif de reference: `295dd11 Restore basic MelodyQuest TV player`;
- commit API applicatif de reference: `2f468a9 Remove MelodyQuest TV ready playback flow`;
- fichiers deployes dans `P:\PROD\MelodyQuest` et `P:\PROD\API\melodyquest`.

Point sensible a reprendre plus tard: le chargement YouTube sur TV peut encore avoir des delais ou coupures selon la video/le navigateur. Les essais avec double lecteur TV, prechargement TV actif et signal backend "TV prete" ont ete abandonnes car ils ont provoque des cas sans video/son. Ne pas les remettre sans nouvelle piste verifiee. L'hebergement local de fichiers audio a ete refuse; YouTube doit rester la source principale.

Dernieres verifications connues:

- `Get-ChildItem .\assets\js -Recurse -Filter *.js | % { node --check $_.FullName }`
- `git -c safe.directory=* diff --check`
- `rg -n "console\.|alert\(|debugger" assets`
- smoke test `/tv`: QR affiche, script `20260612-tv-basic-player`, aucun conteneur `tv-video-preload-player`, aucune erreur console.

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
6. Copier les fichiers modifies vers `P:\PROD\MelodyQuest`, puis commit/push sur `main`.

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

## Mapping deploiement

- Front DEV: `P:\DEV\GitHub\App-MelodyQuest`
- Front PROD: `P:\PROD\MelodyQuest`
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

## Backend et base de donnees

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

## Cache-bust

Les assets sont servis avec cache long. En cas de changement frontend, mettre a jour la version dans:

- `index.html`;
- imports de `assets/js/controller/AppController.js`;
- imports directs des modules touches.

Convention conseillee: `YYYYMMDD-sujet-court`, par exemple `20260610-agent-audit`.

Le cache-bust `20260612-tv-basic-player` marque le rollback volontaire du mode TV vers un lecteur YouTube actif simple.

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
- Fichiers modifies copies en PROD.
- Commit et push effectues sur `main`.
