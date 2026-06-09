# MelodyQuest

Repository MelodyQuest (frontend statique).

## Structure

- `index.html` : entrypoint frontend
- `assets/` : JS/CSS/views du client

## Mapping déploiement (serveur actuel)

- Dossier front déployé: `MelodyQuest/`
- Entry point front: `MelodyQuest/index.html`
- Assets front: `MelodyQuest/assets/*`
- API MelodyQuest: `https://api.shinederu.ch/melodyquest/` (dossier serveur `API/melodyquest/`)
- API Auth: `https://api.shinederu.ch/auth/` (dossier serveur `API/auth/`)

## Base de données

MelodyQuest partage la même instance MySQL et le même schéma que les autres projets Shinederu:

- schéma partagé
- variables backend MelodyQuest: `MQ_DB_*`

L'API `auth` utilise aussi ce même schéma partagé avec ses variables (`DB_*`).

## Cahier des charges produit

- Jeu: blindtest multijoueur
- Frontend: JS/CSS/HTML (sans framework)
- Connexion centralisée/partagée sur le domaine et sous-domaines
- Utilisateur connecté: créer/rejoindre un lobby
- Lobby configurable uniquement par son créateur, avec visibilité public/privé modifiable depuis le lobby
- Musiques organisées en catégories (films, dessins animés, séries, animés, Disney, etc.)
- Musiques organisées en familles (ex: plusieurs thèmes d'une même œuvre)
- Aucune piste audio stockée en DB: uniquement des identifiants vidéo YouTube
- Lecture via player YouTube avec vidéo cachée
- Option de lobby pour afficher la catégorie de la musique pendant la manche
- Option de lobby pour autoriser un vote de révélation anticipée si personne n'a trouvé la réponse
- Option de lobby `Précision des réponses` pour choisir un seuil de correspondance de `70%` à `100%`; `100%` conserve la validation stricte.
- Lecture synchronisée entre tous les joueurs d'un lobby
- Les manches utilisent une piste d'avance exposée par l'API (`next_track`) afin que les clients et le mode TV préchargent la prochaine vidéo YouTube en arrière-plan; le départ visible ne garde qu'une courte synchronisation.
- Images de profil exposées par l'API MelodyQuest avec URL d'avatar normalisée depuis l'API Auth, affichées dans les listes de joueurs et le classement
- Partage direct d'un salon via URL `#/lobby?code=...`, utilisable depuis le lobby et depuis la partie
- Mode TV via `https://melodyquest.shinederu.ch/tv`: une TV génère un QR code/code court, puis un joueur connecté dans un salon peut la lier depuis `#/tv-link`, avec saisie manuelle ou scan du QR via la caméra du téléphone; la TV suit ensuite le salon, précharge la prochaine manche avec un player caché, joue le son sans bouton d'activation, affiche la vidéo/solution au moment de la révélation et garde le classement visible
- Mode joueur de salon dans `#/game`: un téléphone ou PC peut basculer en interface de réponse seule quand une TV est liée, sans lecteur YouTube ni préchargement vidéo local.
- Suggestions joueurs: correction/alias/URL pendant une partie, avec verrou temporaire de manche pendant la saisie, et page publique `#/suggest-track` pour proposer une nouvelle musique
- Administrateurs de catalogue définis par le droit central `melodyquest.catalog.manage` (`core_*`) ou par le super-admin global
- Administrateurs: gestion du catalogue (catégories, familles, musiques) et suivi des suggestions joueurs

## Authentification (client)

Le client utilise `shinederu-auth-core` (version browser embarquée):

- `assets/js/vendor/shinederu-auth-core/`
- `assets/js/utils/HttpService.js`

Les flux `login/register/logout/me` passent par ce client auth partagé.

## Temps réel

- priorité: Mercure via `https://mercure.shinederu.ch/.well-known/mercure`
- fallback de transition: SSE historique sur `api.shinederu.ch/melodyquest`
- les écrans `main`, `lobby-list`, `lobby` et `game` consomment `data.realtime` renvoyé par l'API
- les topics Mercure MelodyQuest sont dérivés de `https://api.shinederu.ch/melodyquest/topics/...`
- l'écran `tv` reste public et utilise un polling léger `getTvPairing` / `getTvState` avec un `device_token` temporaire, afin de ne pas exiger de session auth sur une télévision

## État client actuel

- Vue `public`: login/register
- Vue `suggest-track`: page publique de proposition de nouvelle musique, accessible avec ou sans session
- Vue `tv`: écran public pour télévision/écran dédié; génère un QR code et bascule en affichage de partie une fois lié à un salon
- Vue `tv-link`: liaison d'une TV au salon courant depuis le QR code scanné avec la caméra, depuis un lien QR ouvert par l'appareil, ou depuis un code manuel; accessible depuis le lobby et la partie
- Vue `main`: menu principal (créer un salon public/privé, rejoindre par code, salons publics)
- Vue `lobby-list`: lobbies publics en cours + rejoindre par code
- Vue `lobby`: page lobby (joueurs avec avatars, réglages owner regroupés par salon/rythme/options/validation/catégories, visibilité public/privé, catégorie visible, vote de révélation, seuil de précision des réponses, présence maintenue pendant le chargement initial)
- Vue `game`: partie en cours avec lecteur YouTube synchronisé à gauche sur desktop, réponse/classement/code lobby en colonne droite, solution lisible sous la vidéo, mode joueur sans vidéo pour les soirées avec TV, vote de révélation anticipée unanime, autofocus du champ de réponse, timer visible après une bonne réponse, pseudos verts quand un joueur a trouvé, derniers essais ratés visibles, proposition de correction et partage du salon, puis empilement responsive sur mobile
- Vue `management`: hub management global
- Vue `management-categories`: gestion catégories
- Vue `management-families`: gestion familles
- Vue `management-tracks`: gestion musiques
- Vue `management-validation`: validation des musiques en attente, avec correction éditable de la catégorie, de l'œuvre, des alias acceptés, du libellé, de l'artiste/licence et de l'ID ou URL YouTube avant validation
- Vue `management-suggestions`: revue des corrections, alias et nouvelles musiques envoyés par les joueurs

## Interface

- Système visuel sombre unifié appliqué globalement au frontend, sans ancien thème clair résiduel.
- Les pages joueur privilégient les actions utiles: créer un salon, rejoindre par code, choisir un salon public, inviter les joueurs, régler rapidement la partie et relancer depuis les résultats.
- Les en-têtes de pages restent compacts par défaut afin de garder les actions principales visibles sans défilement inutile.
- Les retours utilisateur importants utilisent des statuts intégrés aux cartes, sans popups navigateur pour les flux de connexion/inscription.
- Layout desktop de la page jeu conçu pour tenir sur un écran PC courant: scène vidéo à gauche, actions et classement à droite.
- La page jeu possède des paliers responsive intermédiaires pour les tailles laptop/tablette large, avec une colonne de droite densifiée quand la hauteur disponible est limitée.
- Layout mobile compact: header réduit, lecteur en ratio 16:9, actions de réponse proches de la vidéo, contrôles de partage/TV et classement densifiés pour limiter le défilement pendant une partie.
- La solution affiche l'œuvre en grand sous la vidéo, puis les infos de musique/artiste en plus petit; la catégorie apparaît uniquement si l'option du lobby est activée.
- L'option "suivant automatique" n'est plus persistée en stockage navigateur: elle repart désactivée à chaque nouvelle session de jeu.
- Le mode joueur de salon masque le lecteur, le volume, le classement et les informations de partage afin de garder uniquement la réponse, l'état de manche, les votes et les corrections utiles; le choix est conservé localement sur l'appareil.
- Le mode TV est pensé pour une soirée IRL: pas de header/footer ni navigation visible, QR code/code lisible à distance au démarrage, son actif par défaut, préchargement de la prochaine vidéo via un player YouTube caché, puis grand timer, solution et classement visibles sur un écran partagé avec un layout adapté à la taille et au ratio du navigateur.
- Le scan caméra de `tv-link` utilise d'abord `BarcodeDetector` quand disponible, puis le décodeur local vendoré `assets/js/vendor/jsqr/` en fallback; le champ code reste toujours disponible.
- Les libellés d'administration doivent rester cohérents et lisibles côté utilisateur, avec accents et vocabulaire français ("œuvre", "piste", "catégorie").

## Lancer en local

Servir le dossier statique avec un serveur HTTP (ex: nginx, caddy, vite static, etc.), puis ouvrir:

- `index.html`

## Adaptation hébergement actuel

- Front route principalement en hash (`#/main`, `#/lobby-list`, etc.) pour éviter toute dépendance au rewrite Nginx.
- Route lisible spéciale `https://melodyquest.shinederu.ch/tv` pour le mode TV; le fallback Nginx vers `index.html` reste nécessaire.
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


