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
- Option de lobby `Precision des reponses` pour choisir un seuil de correspondance de `70%` a `100%`; `100%` conserve la validation stricte.
- Lecture synchronisee entre tous les joueurs d'un lobby
- Les manches demarrent avec une courte phase de prechargement serveur afin que les clients et le mode TV puissent charger le lecteur YouTube avant le vrai depart.
- Images de profil exposees par l'API MelodyQuest avec URL d'avatar normalisee depuis l'API Auth, affichees dans les listes de joueurs et le classement
- Partage direct d'un salon via URL `#/lobby?code=...`, utilisable depuis le lobby et depuis la partie
- Mode TV via `https://melodyquest.shinederu.ch/tv`: une TV genere un QR code/code court, puis un joueur connecte dans un salon peut la lier depuis `#/tv-link`, avec saisie manuelle ou scan du QR via la camera du telephone; la TV suit ensuite le salon, precharge les manches, joue le son sans bouton d'activation, affiche la video/solution au moment de la revelation et garde le classement visible
- Suggestions joueurs: correction/alias/URL pendant une partie, avec verrou temporaire de manche pendant la saisie, et page publique `#/suggest-track` pour proposer une nouvelle musique
- Administrateurs de catalogue definis par le droit central `melodyquest.catalog.manage` (`core_*`) ou par le super-admin global
- Administrateurs: gestion du catalogue (categories, familles, musiques) et suivi des suggestions joueurs

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
- l'ecran `tv` reste public et utilise un polling leger `getTvPairing` / `getTvState` avec un `device_token` temporaire, afin de ne pas exiger de session auth sur une television

## Etat client actuel

- Vue `public`: login/register
- Vue `suggest-track`: page publique de proposition de nouvelle musique, accessible avec ou sans session
- Vue `tv`: ecran public pour television/ecran dedie; genere un QR code et bascule en affichage de partie une fois lie a un salon
- Vue `tv-link`: liaison d'une TV au salon courant depuis le QR code scanne avec la camera, depuis un lien QR ouvert par l'appareil, ou depuis un code manuel; accessible depuis le lobby et la partie
- Vue `main`: menu principal (creer un salon public/prive, rejoindre par code, salons publics)
- Vue `lobby-list`: lobbies publics en cours + rejoindre par code
- Vue `lobby`: page lobby (joueurs avec avatars, reglages owner regroupes par salon/rythme/options/validation/categories, visibilite public/prive, categorie visible, vote de revelation, seuil de precision des reponses, presence maintenue pendant le chargement initial)
- Vue `game`: partie en cours avec lecteur YouTube synchronise a gauche sur desktop, reponse/classement/code lobby en colonne droite, solution lisible sous la video, vote de revelation anticipee unanime, autofocus du champ de reponse, timer visible apres une bonne reponse, pseudos verts quand un joueur a trouve, derniers essais rates visibles, proposition de correction et partage du salon, puis empilement responsive sur mobile
- Vue `management`: hub management global
- Vue `management-categories`: gestion categories
- Vue `management-families`: gestion familles
- Vue `management-tracks`: gestion musiques
- Vue `management-validation`: validation des musiques en attente, avec correction editable de la categorie, de l'oeuvre, des alias acceptes, du libelle, de l'artiste/licence et de l'ID ou URL YouTube avant validation
- Vue `management-suggestions`: revue des corrections, alias et nouvelles musiques envoyes par les joueurs

## Interface

- Systeme visuel sombre unifie applique globalement au frontend, sans ancien theme clair residuel.
- Les pages joueur privilegient les actions utiles: creer un salon, rejoindre par code, choisir un salon public, inviter les joueurs, regler rapidement la partie et relancer depuis les resultats.
- Les en-tetes de pages restent compacts par defaut afin de garder les actions principales visibles sans defilement inutile.
- Layout desktop de la page jeu concu pour tenir sur un ecran PC courant: scene video a gauche, actions et classement a droite.
- Layout mobile empile les sections et conserve le lecteur en ratio 16:9.
- La solution affiche l'oeuvre en grand sous la video, puis les infos de musique/artiste en plus petit; la categorie apparait uniquement si l'option du lobby est activee.
- L'option "suivant automatique" n'est plus persistee en stockage navigateur: elle repart desactivee a chaque nouvelle session de jeu.
- Le mode TV est pense pour une soiree IRL: pas de header/footer ni navigation visible, QR code/code lisible a distance au demarrage, son actif par defaut, prechargement de la video avant le depart de manche, puis grand timer, solution et classement visibles sur un ecran partage avec un layout adapte a la taille et au ratio du navigateur.
- Le scan camera de `tv-link` utilise d'abord `BarcodeDetector` quand disponible, puis le decodeur local vendore `assets/js/vendor/jsqr/` en fallback; le champ code reste toujours disponible.

## Lancer en local

Servir le dossier statique avec un serveur HTTP (ex: nginx, caddy, vite static, etc.), puis ouvrir:

- `index.html`

## Adaptation hebergement actuel

- Front route principalement en hash (`#/main`, `#/lobby-list`, etc.) pour eviter toute dependance au rewrite Nginx.
- Route lisible speciale `https://melodyquest.shinederu.ch/tv` pour le mode TV; le fallback Nginx vers `index.html` reste necessaire.
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
- `https://melodyquest.shinederu.ch/#/suggest-track`
- `https://melodyquest.shinederu.ch/tv`
- `https://melodyquest.shinederu.ch/#/tv-link?code=ABC123`
- `https://melodyquest.shinederu.ch/#/main`
- `https://melodyquest.shinederu.ch/#/lobby-list`
- `https://melodyquest.shinederu.ch/#/lobby?code=ABCDEFGH`
- `https://melodyquest.shinederu.ch/#/lobby`
- `https://melodyquest.shinederu.ch/#/management`


