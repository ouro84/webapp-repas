---
paths:
  - "app/api/mcp/**"
  - "app/oauth/**"
  - "app/.well-known/**"
  - "lib/mcp/**"
  - "components/oauth/**"
  - "components/profil/assistants-connectes*"
  - "scripts/configurer-oauth-supabase.mjs"
  - "e2e/oauth*"
---

# Serveur MCP et OAuth 2.1 (#302, ADR-11)

## Autorisation

- **Le serveur d'autorisation est Supabase OAuth Server** (bêta), DCR activé, chemin `/oauth/consent`. OMQ ne code que l'écran de consentement. Configuration par `node scripts/configurer-oauth-supabase.mjs <ref> [--appliquer] [--site-url=<url>]` (écriture prod : `--prod-valide`, sur validation humaine). Pourquoi : les clés `oauth_server_*` sont exposées par l'API de management, pas besoin du dashboard.
- **URL de consentement = `site_url` + chemin.** Staging garde `site_url = http://localhost:3000` : c'est ce qui fait atterrir l'e2e local et la CI sur leur `next` local. Toute bascule temporaire (tests sur preview) se remet à `http://localhost:3000` avant de pousser ou de relancer la CI. Pourquoi : sinon `oauth-mcp.spec` échoue.
- **`verifierJetonMcp` exige `role = authenticated`, `sub` et `client_id`.** Pourquoi : un JWT de session web n'a pas de `client_id` ; sans ce contrôle, n'importe quelle session ouvrirait le MCP (RG-71). Vérifié en e2e.
- Vérification par `auth.getClaims(jeton)` (JWKS ES256 mis en cache par supabase-js), sans dépendance JWT. Elle ne lève jamais : un refus donne 401 + `WWW-Authenticate`, pas une 500.
- **Révocation** (`revokeGrant`) : refresh tokens invalidés tout de suite, jeton d'accès valable jusqu'à `jwt_exp` (3600 s). RG-72 l'admet ; ne pas promettre une coupure immédiate.
- ChatGPT exige `aud` = URL MCP (RFC 8707), que Supabase n'émet pas : best effort, pas de contournement côté OMQ.

## Route et metadata

- `/api/mcp` : `mcp-handler` v2 (sans état, pas de Redis), `withMcpAuth(…, { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp" })`, puis `limiteMcp` (préfixe `rl:mcp`, 60/min/utilisateur, 429 JSON-RPC). `limiteMcp` n'agit qu'avec les secrets Upstash sur Vercel.
- Metadata RFC 9728 servie aux deux chemins (`/.well-known/oauth-protected-resource` et `…/api/mcp`), `resource` = `<origine>/api/mcp`. Pourquoi : les clients sondent l'un ou l'autre.
- `proxy.ts` : `sansSession()` laisse passer `/api/mcp` et `/.well-known/oauth-protected-resource[/…]` seulement, sans client à cookies. Un futur fichier sous `/.well-known/` reste soumis au proxy : l'ajouter à `sansSession` s'il doit être public. `/oauth` est protégé ; l'espace OAuth se teste par `estCheminOAuth()` (`/oauth`, `/oauth/…`, pas `/oauthxyz`), et un visiteur non connecté revient au consentement via `/login?suivant=…`.
- **`cheminDeRetour` résout le chemin avec `new URL()` et exige la même origine**, après avoir refusé caractères de contrôle et antislash. Pourquoi : l'analyseur d'URL supprime tabulations et retours à la ligne, si bien que `/%09/evil.com` devenait `//evil.com` (open redirect post-login).
- **Le consentement affiche l'hôte du `redirect_uri` enregistré, jamais `client.uri`.** Pourquoi : en DCR, n'importe qui se déclare « Claude, claude.ai » ; seul le `redirect_uri` dit où part le code.

## Outils

- **Toujours créer `creerClientParJeton(jeton)` dans l'outil et le passer aux lectures**, jamais `clientParDefaut()` ni `service_role`. Pourquoi : la RLS `mon_foyer()` s'applique au JWT de l'utilisateur (RG-71).
- **Composer les services de `lib/`** (`chargerListeCoursesCycle`, `retirerArticlesCoches`, `chargerPlanningDistant`, `retirerCreneauxDesactives`, `ingredientsAEchelle`, `LIBELLES_CATEGORIES`) plutôt que réimplémenter. Pourquoi : règle du jumeau, `/courses` et la fiche recette affichent la même chose.
- **La date du jour côté serveur est celle de Paris** (`aujourdhuiParis()` de `lib/semaines.ts`, passée par `lib/mcp/serveur.ts` et par la route `/api/planning/generer`). Pourquoi : Vercel tourne en UTC ; entre minuit et 1-2 h, le serveur calculait un autre jour, donc une autre semaine ou un autre cycle que le navigateur autour du week-end.
- `lire_planning` refuse une semaine ISO inexistante (`2027-W53`, `2027-W00`) : elle passe le format mais la base n'a jamais cet identifiant.
- **`ancre` (lectures et `generer_cycle`) = une date quelconque du cycle visé, résolue par `ancreDemandee` (`lib/mcp/lecture.ts`)** : `validerDate`, ancre de cycle du jour de courses, contrôle de plage (`CYCLE_HORS_PLAGE`). `lire_planning` refuse `semaine` et `ancre` ensemble. Pourquoi : une seule résolution pour les trois outils (règle du jumeau), et `chargerListeCoursesCycle` attend une ancre de cycle, pas une date quelconque. Chaque repas porte `accompagnement` (`feculents` | `legumes` | null) pour que l'assistant raisonne sur les habitudes du foyer (#320, RG-85).
- Un repas `restes: true` garde le nom du plat d'origine ; les descriptions d'outils disent à l'assistant qu'il n'y a rien à cuisiner.
- Contrats RG-73/78 : un repas = `date` (AAAA-MM-JJ) + `creneau` (`midi` | `soir`), plage −12/+6 semaines (`semaineDansPlage`) ; liste de courses non cochée par défaut. Toute évolution d'un contrat se répercute dans la description de l'outil (`lib/mcp/serveur.ts`), que lit l'assistant.
- Erreurs attendues = `ErreurOutil` (message français qui dit quoi faire ensuite, renvoyé en `isError`). Toute autre exception est loggée et masquée derrière un message générique.
- **Une écriture MCP passe par les mêmes RPC et tables que l'UI** (`sauvegarder_cycle`, `sauvegarder_slots`, `etat_courses_article`, `article_manuel`, `recette`), via les fonctions de `lib/` rendues injectables. Pourquoi : temps réel et alerte US-21 viennent sans code dédié (RG-79), vérifié en e2e.
- **Une ambiguïté n'est pas une erreur** : `remplacer_repas` et `cocher_article` renvoient `{ modifie: false, candidats }` sans rien écrire (`remplacer_repas` : 10 candidats au plus, plus `total`). Un nom exact (casse et accents ignorés, `rechercherRecettes`) l'emporte sur les correspondances partielles ; entre homonymes exacts, la recette du foyer l'emporte (`homonymeDuFoyer`) ; des articles indiscernables (même libellé, même quantité) se traitent l'un après l'autre. Pourquoi : l'assistant ne doit jamais tourner en rond sur une ambiguïté qu'il ne peut pas lever.
- Un tirage de `remplacer_repas` renvoie `avertissements`, les mêmes messages que les toasts du site après « ↺ changer » (RG-26/27/28).
- **L'édition d'un repas n'envoie que le créneau visé** à `sauvegarder_slots` (`ecrireCreneau`). Pourquoi : la RPC upserte chaque slot fourni, renvoyer tout le jour réécrirait l'autre repas même s'il vient de changer ailleurs.
- `generer_cycle` refuse un cycle qui porte déjà un repas affiché, sauf `remplacer: true`, et consomme aussi `limiteGeneration(userId)` (seau `rl:generer` partagé avec le web), via le rappel `verifierQuota` appelé juste avant de générer. Pourquoi : un utilisateur n'a qu'un quota de génération, quel que soit le canal, et un refus « cycle existant » ne doit pas l'entamer.
- **`ajouter_recette` passe `auteurId` à `creerRecette`.** Pourquoi : le client par jeton n'a pas de session, `auth.getUser()` y échoue. `executer()` fournit `userId` (claim `sub`) à chaque outil.
- **Outils de l'exécuteur de panier** (`lib/mcp/panier.ts`, #308), appelés par Hermes sous son propre jeton, jamais par un humain. Toute la logique vit dans les RPC (`prendre_demande_panier`, `rapporter_panier`) ; le module traduit réponses et codes d'erreur. Pourquoi : un seul chemin pour l'expiration et le rapport tardif, quel que soit l'appelant.
  - `prendre_demande_panier` (sans argument) passe la plus ancienne demande `en_attente` du foyer en `en_cours` et renvoie `{ demande: { id, ancre } }`, ou `{ demande: null }` s'il n'y a rien à faire (webhook forgé ou rejoué, demande expirée) : l'exécuteur s'arrête. `null` n'est pas une erreur.
  - `rapporter_panier` (`demande_id`, `statut` `terminee` | `echec`, `motif`, listes `ajoutes` / `a_choisir` / `introuvables`) : un `echec` sans `motif` lève `ErreurOutil` avant tout appel ; `OMQ03` devient une `ErreurOutil` qui dit de s'arrêter sans réessayer (demande close, remplacée ou inconnue). Renvoie `{ statut, rapport_tardif }`. Son `inputSchema` étend `schemaRapport` (cf. `chronodrive.md`).
  - Les deux descriptions commencent par « Réservé à l’exécuteur de panier du foyer… ne l’appelle jamais pour consulter l’état d’un panier ». Pourquoi : tout assistant connecté voit ces outils (pas de filtrage par `client_id` en v1), et `prendre` ferait passer une vraie demande en cours.

## Tests

- Unitaires : `lib/mcp/*.test.ts` (client mocké, client navigateur qui lève), `app/api/mcp/route.test.ts` (vrai mcp-handler, auth, lectures et écritures mockées).
- e2e : `e2e/oauth-mcp.spec.ts` et `e2e/mcp-ecriture.spec.ts` (comptes jetables ; helpers `inscrire`, `connecter`, `autoriser` dans `e2e/oauth.ts`). Les boutons du consentement se ciblent dans la région « Autoriser <client> ? », car le bandeau cookies porte aussi un bouton « Refuser ».
