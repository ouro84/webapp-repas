# Spike Chronodrive (#307) — PoC jetable

Sert à rendre le go / no-go de #307. Remplacé par le vrai MCP de #308 ; rien ici n'est déployé ni appelé par OMQ (ADR-12, RG-80).

Résultats et protocole : `docs/etudes/chronodrive.md`. Plan : `docs/superpowers/plans/2026-10-30-spike-chronodrive-307.md`.

## Fichiers

- `client.mjs` : login (password → PKCE → jeton), panier, favoris, recherche. Le code de refresh reste mais ne sert pas : Chronodrive ne délivre pas de refresh token, le client refait le login.
- `sonde.mjs` : CLI de test, `node sonde.mjs <login|panier|ajouter <id> [qté]|retirer <id>|favoris|recherche <terme>>`.
- `mcp.mjs` : MCP stdio pour Hermes, 5 outils, lecture seule si `CHRONODRIVE_LECTURE_SEULE=1`.

## Sur le NAS

Tout tourne dans le conteneur `hermes` (réseau host, donc IP résidentielle), dossier `/opt/data/chronodrive-spike` (`/share/CACHEDEV1_DATA/Container/hermes/data/chronodrive-spike` côté NAS).

- Identifiants : `/opt/data/chronodrive.env` (`chmod 600`), variables `CHRONODRIVE_EMAIL`, `CHRONODRIVE_MOT_DE_PASSE`, `CHRONODRIVE_SITE_ID`. Jamais dans Git ni dans `config.yaml`.
- Session : `/opt/data/chronodrive-session.json` (mode `600`), réécrite à chaque login.
- Installation : `npm install --omit=dev` dans le dossier, en utilisateur `1000`.

```sh
D=/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker
$D exec -u 1000 -w /opt/data/chronodrive-spike hermes node sonde.mjs login
```

## État laissé sur le NAS après le spike

- MCP `chronodrive-spike` branché dans `config.yaml` de Hermes, **en lecture seule** (`CHRONODRIVE_LECTURE_SEULE: '1'`), utile pour #308.
- Plateforme webhook de Hermes activée sur `127.0.0.1:8644`, **sans aucune route** ; secret HMAC gardé dans `/opt/data/chronodrive.env` (`OMQ_WEBHOOK_SECRET`).
- Tailscale Funnel **coupé**. Pour le rouvrir (#308) : port **10000** (443 et 8443 sont pris sur le NAS), `tailscale funnel --bg --https=10000 --set-path /webhooks/<route> http://127.0.0.1:8644/webhooks/<route>`.
- Sauvegardes : `config.yaml.bak-avant-spike-307`, `config.yaml.bak-avant-webhook-307`.
