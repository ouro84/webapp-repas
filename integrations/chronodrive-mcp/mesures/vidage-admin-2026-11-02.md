# Recette de `vider_panier` (serveur `chronodrive-admin`, #320, PR-B) — 2026-11-02

Déploiement sur le NAS selon le README (étape 4 en trois temps) :

- sauvegardes `config.yaml.bak-avant-320-prb`, `webhook_subscriptions.json.bak-avant-320-prb`, `chronodrive-mcp.bak-avant-320-prb.tgz` ;
- code copié (empreintes identiques au dépôt), `chronodrive-admin` déclaré d'abord sans `env` (lecture seule, chargé à chaud) ;
- surfaces vérifiées par `_get_platform_tools` de Hermes : seul `telegram` voit `chronodrive-admin` ; `cron`, `homeassistant` et `discord` ont reçu une liste explicite sans `chronodrive` ni `chronodrive-admin` (ils voyaient jusque-là tous les serveurs MCP, `chronodrive` compris) ; `cli` garde `chronodrive` ; la route `panier-omq` garde `["chronodrive", "On Mange Quoi ?"]` ;
- `CHRONODRIVE_LECTURE_SEULE: '0'` ajouté à `chronodrive-admin`, puis gateway redémarrée sur accord explicite d'Arnaud.

## Déroulé

| Essai | Constat |
|-------|---------|
| 1 | KO : dans une session Telegram ouverte depuis le 29/10, l'assistant n'a pas appelé `vider_panier` ; il a pris le navigateur (`browser_navigate`, `camofox`), d'où un message sur le profil de navigateur déconnecté. `hermes mcp test chronodrive-admin` montrait pourtant le serveur connecté et `vider_panier` découvert. |
| 2 | Après `/new` sur Telegram et une demande qui nomme l'outil : recette validée par Arnaud. |

## Verdict d'Arnaud

Recette **validée**. Pour vider le panier depuis Telegram, ouvrir une session neuve (`/new`) et nommer l'outil (« Utilise l'outil vider_panier… ») : un assistant d'une ancienne session peut choisir le navigateur.

## Après coup

Mise à jour de Hermes en v0.22.6 (`config.yaml` migré en version 52) : surfaces revérifiées à l'identique, `chronodrive-admin` toujours armé, route `panier-omq` inchangée.
