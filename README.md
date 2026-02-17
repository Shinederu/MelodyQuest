# MelodyQuest

Repository MelodyQuest (client + backend historique).

## Structure

- `client/` : client web principal (entrypoint `client/index.html`)
- `assets/` : copie racine conservee pour compatibilite historique
- `backend/` : backend historique du projet

## Base de donnees

MelodyQuest partage la meme instance MySQL que les autres projets Shinederu, mais avec son propre schema et ses propres credentials:

- schema MelodyQuest: `MelodyQuest`
- variables backend: `MQ_DB_*`

L'API `auth` utilise la meme instance MySQL avec un autre schema (`ShinedeCore`) et d'autres credentials (`DB_*`).

## Authentification (client)

Le client utilise maintenant `shinederu-auth-core` (version browser embarquee):

- `client/assets/js/vendor/shinederu-auth-core/`
- `client/assets/js/utils/HttpService.js`

Les flux `login/register/logout/me` passent par ce client auth partage.

## Lancer en local

Servir le dossier statique avec un serveur HTTP (ex: nginx, caddy, vite static, etc.), puis ouvrir:

- `client/index.html`

## Nginx (exemple)

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name melodyquest.shinederu.lol;
    root /var/www/MelodyQuest/client;

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
