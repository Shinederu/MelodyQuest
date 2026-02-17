# MelodyQuest
A Blindtest project


# Nginx configuration
```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name melodyquest.shinederu.lol;
    root /var/www/MelodyQuest;

    index index.html;
    ssl_certificate /etc/nginx/ssl/*.shinederu.lol_shinederu.lol_P256/fullchain.cer;
    ssl_certificate_key /etc/nginx/ssl/*.shinederu.lol_shinederu.lol_P256/private.key;
    
    
    # Assets statiques (cache long)
    location ^~ /assets/ {
        try_files $uri =404;
        access_log off;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    # Page principale (évite de cacher agressivement l'HTML)
    location = /index.html {
        expires -1;
        add_header Cache-Control "no-store";
    }

    # SPA: /menu, /admin, /public -> index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}


# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name melodyquest.shinederu.lol;
    return 301 https://$host$request_uri;
}
```