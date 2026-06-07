# MelodyQuest

Repository MelodyQuest (frontend statique).

## Structure

- `index.html` : entrypoint frontend
- `assets/` : JS/CSS/views du client

## Mapping deploiement (serveur actuel)

- Dossier front deploye: `MelodyQuest/`
- Entry point front: `MelodyQuest/index.html`
- Assets front: `MelodyQuest/assets/*`
- API MelodyQuest: `https://api.shinederu.ch/melodyquest/` (dossier serveur `API/melodyquest/`)
- API Auth: `https://api.shinederu.ch/auth/` (dossier serveur `API/auth/`)

## Base de donnees

MelodyQuest partage la meme instance MySQL et le meme schema que les autres projets Shinederu:

- schema partage
- variables backend MelodyQuest: `MQ_DB_*`

L'API `auth` utilise aussi ce meme schema partage avec ses variables (`DB_*`).

## Cahier des charges produit

- Jeu: blindtest multijoueur
- Frontend: JS/CSS/HTML (sans framework)
- Connexion centralisee/partagee sur le domaine et sous-domaines
- Utilisateur connecte: creer/rejoindre un lobby
- Lobby configurable uniquement par son createur, avec visibilite public/prive modifiable depuis le lobby
- Musiques organisees en categories (films, dessins animes, series, animes, Disney, etc.)
- Musiques organisees en familles (ex: plusieurs themes d'une meme oeuvre)
- Aucune piste audio stockee en DB: uniquement des identifiants video YouTube
- Lecture via player YouTube avec video cachee
- Option de lobby pour afficher la categorie de la musique pendant la manche
- Option de lobby pour autoriser un vote de revelation anticipee si personne n'a trouve la reponse
- Lecture synchronisee entre tous les joueurs d'un lobby
- Images de profil issues de `users.avatar_url` affichees dans les listes de joueurs et le classement
- Administrateurs de catalogue definis par le droit central `melodyquest.catalog.manage` (`core_*`) ou par le super-admin global
- Administrateurs: gestion du catalogue (categories, familles, musiques)

## Authentification (client)

Le client utilise `shinederu-auth-core` (version browser embarquee):

- `assets/js/vendor/shinederu-auth-core/`
- `assets/js/utils/HttpService.js`

Les flux `login/register/logout/me` passent par ce client auth partage.

## Temps reel

- priorite: Mercure via `https://mercure.shinederu.ch/.well-known/mercure`
- fallback de transition: SSE historique sur `api.shinederu.ch/melodyquest`
- les ecrans `main`, `lobby-list`, `lobby` et `game` consomment `data.realtime` renvoye par l'API
- les topics Mercure MelodyQuest sont derives de `https://api.shinederu.ch/melodyquest/topics/...`

## Etat client actuel

- Vue `public`: login/register
- Vue `main`: menu principal (creer un salon public/prive, rejoindre par code, salons publics)
- Vue `lobby-list`: lobbies publics en cours + rejoindre par code
- Vue `lobby`: page lobby (joueurs avec avatars, reglages owner, visibilite public/prive, categorie visible, vote de revelation)
- Vue `game`: partie en cours avec lecteur YouTube synchronise a gauche sur desktop, reponse/classement/code lobby en colonne droite, solution lisible sous la video, vote de revelation anticipee, puis empilement responsive sur mobile
- Vue `management`: hub management global
- Vue `management-categories`: gestion categories
- Vue `management-families`: gestion familles
- Vue `management-tracks`: gestion musiques
- Vue `management-validation`: validation des musiques en attente, avec correction editable de la categorie, de l'oeuvre, des alias acceptes, du libelle, de l'artiste/licence et de l'ID ou URL YouTube avant validation

## Interface

- Systeme visuel sombre unifie applique globalement au frontend, sans ancien theme clair residuel.
- Les pages joueur privilegient les actions utiles: creer un salon, rejoindre par code, choisir un salon public, inviter les joueurs, regler rapidement la partie et relancer depuis les resultats.
- Les en-tetes de pages restent compacts par defaut afin de garder les actions principales visibles sans defilement inutile.
- Layout desktop de la page jeu concu pour tenir sur un ecran PC courant: scene video a gauche, actions et classement a droite.
- Layout mobile empile les sections et conserve le lecteur en ratio 16:9.
- La solution affiche l'oeuvre en grand sous la video, puis les infos de musique/artiste en plus petit; la categorie apparait uniquement si l'option du lobby est activee.

## Lancer en local

Servir le dossier statique avec un serveur HTTP (ex: nginx, caddy, vite static, etc.), puis ouvrir:

- `index.html`

## Adaptation hebergement actuel

- Front route en hash (`#/main`, `#/lobby-list`, etc.) pour eviter toute dependance au rewrite Nginx.
- API auth: `https://api.shinederu.ch/auth/`
- API MelodyQuest: `https://api.shinederu.ch/melodyquest/`
- Hub Mercure: `https://mercure.shinederu.ch/.well-known/mercure`
- Surcharge possible via `window.__SHINEDERU_API_ROOT__` dans `index.html`.

## Nginx (exemple)

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

Avec le routage hash, les pages sont accessibles via:

- `https://melodyquest.shinederu.ch/#/public`
- `https://melodyquest.shinederu.ch/#/main`
- `https://melodyquest.shinederu.ch/#/lobby-list`
- `https://melodyquest.shinederu.ch/#/lobby`
- `https://melodyquest.shinederu.ch/#/management`


