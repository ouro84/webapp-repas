---
paths:
  - "integrations/chronodrive-mcp/**"
  - "docs/etudes/chronodrive.md"
  - "app/api/panier/**"
  - "lib/panier.ts"
---

# Exécuteur Chronodrive (#303, ADR-12)

Protocole et mesures : `docs/etudes/chronodrive.md`. PoC du spike #307 : `integrations/chronodrive-mcp/spike/` (jetable, remplacé par #308).

## API Chronodrive

- **Une clé `x-api-key` par service, et la route décide du service** : `GET v1/customers/me/carts` attend `CUSTOMERS`, pas `CARTS`. Pourquoi : la mauvaise clé renvoie 401 « API Key is not valid », à ne pas confondre avec un jeton expiré (ne pas relancer le login dessus).
- **Pas de refresh token** malgré `offline_access` : quand le jeton (7 200 s) a expiré, refaire le login complet. Pourquoi : la réponse `/oauth/token` ne contient que `id_token`, `access_token`, `expires_in`, `token_type`.
- **Confirmer un ajout en comparant la quantité du produit dans le panier avant et après**, jamais au seul `returnType` ni à la simple présence. Pourquoi : `NO_STOCK_AFTER` ajoute quand même le produit, et le produit peut déjà être dans le panier ; une erreur de lecture laisse l'article non coché et une relance le double (RG-83).
- `POST v1/carts/{id}/items` **incrémente** la quantité. Pourquoi : base de la règle de coche à l'ajout (RG-83).
- L'identifiant du drive se lit dans `GET v1/sites?size=500` (clé `SITES`, sans authentification). Pourquoi : il n'apparaît pas dans les URL du site.
- **Relire le panier courant (`v1/customers/me/carts`) à chaque run.** Pourquoi : après une commande validée, l'identifiant du panier peut changer ; le PoC le gardait en cache.

## Exécution sur le NAS

- Tout tourne dans le conteneur `hermes`, identifiants dans `/opt/data/chronodrive.env`, jamais dans Git ni dans `config.yaml`. Pourquoi : réseau host = IP résidentielle (Cloudflare), et les identifiants ne quittent pas l'exécuteur (ADR-12, CGV art. 3).
- **Funnel sur le port 10000**, chemin unique. Pourquoi : 443 et 8443 sont pris sur le NAS, Funnel y coupe le TLS.
- **Poser `host: 127.0.0.1`** dans `platforms.webhook.extra` de Hermes. Pourquoi : par défaut il écoute sur toutes les interfaces et expose le webhook au réseau local ; Funnel y accède en local.
- **OMQ signe le webhook au format Standard Webhooks** (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64>`). Pourquoi : c'est le format que vérifie Hermes, avec anti-rejeu et dédoublonnage par id.
- **Secret `whsec_<base64>` : la clé HMAC est le base64 décodé**, pas la chaîne entière (un secret sans préfixe est pris brut). Pourquoi : la signature calculée côté OMQ (Postgres) doit décoder exactement comme Hermes, sinon tout webhook est rejeté en 401.
- **Le prompt de l'exécuteur doit dire explicitement d'acheter les articles « à vérifier au placard » non cochés** (les prompts du spike ne le disent pas). Pourquoi : sans consigne, le LLM les écarte de lui-même (RG-82).

## Côté OMQ : demande de panier (#308)

- **L'exécuteur se déclare par `select enregistrer_executeur_panier('<foyer_id>', '<url>', '<secret>')`, en `service_role`** (SQL via `scripts/query-supabase.mjs`, jamais depuis le client). L'URL porte le port du Funnel (10000). Pourquoi : pas d'UI en v1, et le secret entre dans Vault sans passer par une table lisible.
- **`POST /api/panier/demande` ne lit aucun corps et vise toujours le cycle courant** (`ancreParDefaut(aujourdhuiParis(), jour_courses)`). Pourquoi : `cocher_article` et `lire_liste_courses` n'agissent que sur le cycle courant tant que #320 n'ajoute pas `ancre` ; une ancre libre ferait traiter un cycle que l'exécuteur ne peut pas cocher.
- **Un webhook refusé ou injoignable ferme la demande** (`echouer_envoi_demande_panier`, cause `injoignable`) **puis la route répond 502** ; si la fermeture échoue, elle est loggée et le 502 part quand même (l'expiration à 5 min prend le relais). Pourquoi : le bouton doit redevenir disponible sans attendre.
- **Le webhook s'envoie avec le corps signé par Postgres, tel quel** (`envoyerWebhook`, 10 s, aucune relance). Pourquoi : re-sérialiser le corps invaliderait la signature, et une relance rejouerait un réveil à vide.
