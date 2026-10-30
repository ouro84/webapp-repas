# Spike Chronodrive (#307) — PoC jetable

Sert à rendre le go / no-go de #307. Remplacé par le vrai MCP de #308 ; rien ici n'est déployé ni appelé par OMQ (ADR-12, RG-80).

Résultats et protocole : `docs/etudes/chronodrive.md`. Plan : `docs/superpowers/plans/2026-10-30-spike-chronodrive-307.md`.

## Fichiers

- `client.mjs` : login (password → PKCE → jeton), refresh, panier, favoris, recherche.
- `sonde.mjs` : CLI de test, `node sonde.mjs <login|refresh|panier|ajouter <id> [qté]|retirer <id>|favoris|recherche <terme>>`.
- `mcp.mjs` : MCP stdio pour Hermes, 5 outils, lecture seule si `CHRONODRIVE_LECTURE_SEULE=1`.

## Sur le NAS

Tout tourne dans le conteneur `hermes` (réseau host, donc IP résidentielle), dossier `/opt/data/chronodrive-spike` (`/share/CACHEDEV1_DATA/Container/hermes/data/chronodrive-spike` côté NAS).

- Identifiants : `/opt/data/chronodrive.env` (`chmod 600`), variables `CHRONODRIVE_EMAIL`, `CHRONODRIVE_MOT_DE_PASSE`, `CHRONODRIVE_SITE_ID`. Jamais dans Git ni dans `config.yaml`.
- Session : `/opt/data/chronodrive-session.json` (mode `600`), réécrite à chaque login ou refresh.
- Installation : `npm install --omit=dev` dans le dossier, en utilisateur `1000`.

```sh
D=/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker
$D exec -u 1000 -w /opt/data/chronodrive-spike hermes node sonde.mjs login
```
