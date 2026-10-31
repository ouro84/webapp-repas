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

- **L'exécuteur se déclare par `enregistrer_executeur_panier`, via l'API de management**, jamais depuis le client. Pourquoi : pas d'UI en v1, et le secret entre dans Vault sans passer par une table lisible.
  - La fonction n'est exécutable que par `service_role` et par son propriétaire ; l'API de management (`scripts/query-supabase.mjs`) tourne en `postgres`, le propriétaire.
  - Le secret vient d'une variable d'environnement, jamais tapé en clair dans la commande (historique du shell) : `read -rs OMQ_WEBHOOK_SECRET`, puis `node scripts/query-supabase.mjs <ref> "select enregistrer_executeur_panier('<foyer_id>', 'https://<nas>.ts.net:10000/<chemin>', '$OMQ_WEBHOOK_SECRET')"`. L'URL porte le port du Funnel (10000).
  - Le secret transite dans le corps de la requête HTTPS vers l'API de management. Rotation : ré-enregistrer l'exécuteur avec le nouveau secret (le secret Vault existant est mis à jour), puis le poser côté Hermes.
- **`POST /api/panier/demande` ne lit aucun corps et vise toujours le cycle courant** (`ancreParDefaut(aujourdhuiParis(), jour_courses)`). Pourquoi : `cocher_article` et `lire_liste_courses` n'agissent que sur le cycle courant tant que RG-85 n'ajoute pas `ancre` ; une ancre libre ferait traiter un cycle que l'exécuteur ne peut pas cocher.
- **Un webhook refusé ou injoignable ferme la demande** (`echouer_envoi_demande_panier`, cause `injoignable`) **puis la route répond 502** ; si la fermeture échoue, elle est loggée et le 502 part quand même (l'expiration à 5 min prend le relais). Pourquoi : une nouvelle demande doit être possible aussitôt.
  - Si `echouer_envoi_demande_panier` renvoie `false`, la demande n'était plus `en_attente` : l'exécuteur l'a prise malgré le délai, et la route répond 202. Pourquoi : la demande suit son cours, ce n'est pas un échec.
  - **`envoyerWebhook` renvoie un motif français lisible** (« délai de 10 s dépassé », « réponse HTTP 500 », « erreur réseau ») ; la cause brute ne va qu'au log. Pourquoi : `motif_echec` est lisible par le foyer (§5.8) ; pour la cause `injoignable`, la carte de `/courses` montre seulement « Ton exécuteur n’a pas répondu… » (`messageEchec`), le motif reste en base.
  - Une redirection est un échec (`redirect: "error"`). Pourquoi : le webhook ne part que vers l'URL enregistrée.
- **`schemaRapport` (`lib/panier.ts`) est `strict()` à tous les niveaux** : un identifiant de produit ou un prix en trop est refusé, pas ignoré. Chaque liste est plafonnée à 200 éléments. Pourquoi : OMQ ne stocke aucun identifiant d'enseigne (RG-80, RG-84).
- **Le webhook s'envoie avec le corps signé par Postgres, tel quel** (`envoyerWebhook`, 10 s, aucune relance). Pourquoi : re-sérialiser le corps invaliderait la signature, et une relance rejouerait un réveil à vide.
