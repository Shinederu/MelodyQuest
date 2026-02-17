# MelodyQuest

Repository MelodyQuest (client + backend historique).

## Structure

- `client/` : client web principal (entrypoint `client/index.html`)
- `assets/` : copie racine conservee pour compatibilite historique
- `backend/` : backend historique du projet

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
