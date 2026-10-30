---
paths:
  - "integrations/chronodrive-mcp/**"
  - "docs/etudes/chronodrive.md"
---

# Exécuteur Chronodrive (#303, ADR-12)

Protocole et mesures : `docs/etudes/chronodrive.md`. PoC du spike #307 : `integrations/chronodrive-mcp/spike/` (jetable, remplacé par #308).

## API Chronodrive

- **Une clé `x-api-key` par service, et la route décide du service** : `GET v1/customers/me/carts` attend `CUSTOMERS`, pas `CARTS`. Pourquoi : la mauvaise clé renvoie 401 « API Key is not valid », à ne pas confondre avec un jeton expiré (ne pas relancer le login dessus).
- **Pas de refresh token** malgré `offline_access` : à l'expiration (7 200 s), refaire le login complet. Pourquoi : la réponse `/oauth/token` ne contient que `id_token`, `access_token`, `expires_in`, `token_type`.
- **Confirmer un ajout en relisant le panier**, jamais au seul `returnType`. Pourquoi : `NO_STOCK_AFTER` ajoute quand même le produit ; le traiter en échec laisse l'article non coché et une relance le double (RG-83).
- `POST v1/carts/{id}/items` **incrémente** la quantité. Pourquoi : base de la règle de coche à l'ajout (RG-83).
- L'identifiant du drive se lit dans `GET v1/sites` (clé `SITES`, sans authentification). Pourquoi : il n'apparaît pas dans les URL du site.

## Exécution sur le NAS

- Tout tourne dans le conteneur `hermes` (réseau host = IP résidentielle) ; identifiants dans `/opt/data/chronodrive.env`, jamais dans Git ni dans `config.yaml`.
- **Funnel sur le port 10000**, chemin unique. Pourquoi : 443 et 8443 sont pris sur le NAS, Funnel y coupe le TLS.
- La plateforme webhook de Hermes écoute sur `127.0.0.1` (sinon toutes les interfaces) et vérifie le format **Standard Webhooks** : c'est ce qu'OMQ doit émettre.
- Le prompt de l'exécuteur dit explicitement d'acheter les articles « à vérifier au placard » non cochés. Pourquoi : sans consigne, le LLM les écarte de lui-même (RG-82).
