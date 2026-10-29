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
- `proxy.ts` : `sansSession()` laisse passer `/api/mcp` et `/.well-known/*` sans client à cookies ; `/oauth` est protégé, et un visiteur non connecté revient au consentement via `/login?suivant=…`.
- **`cheminDeRetour` résout le chemin avec `new URL()` et exige la même origine**, après avoir refusé caractères de contrôle et antislash. Pourquoi : l'analyseur d'URL supprime tabulations et retours à la ligne, si bien que `/%09/evil.com` devenait `//evil.com` (open redirect post-login).
- **Le consentement affiche l'hôte du `redirect_uri` enregistré, jamais `client.uri`.** Pourquoi : en DCR, n'importe qui se déclare « Claude, claude.ai » ; seul le `redirect_uri` dit où part le code.

## Outils

- **Toujours créer `creerClientParJeton(jeton)` dans l'outil et le passer aux lectures**, jamais `clientParDefaut()` ni `service_role`. Pourquoi : la RLS `mon_foyer()` s'applique au JWT de l'utilisateur (RG-71).
- **Composer les services de `lib/`** (`chargerListeCoursesCycle`, `retirerArticlesCoches`, `chargerPlanningDistant`, `retirerCreneauxDesactives`, `ingredientsAEchelle`, `LIBELLES_CATEGORIES`) plutôt que réimplémenter. Pourquoi : règle du jumeau, `/courses` et la fiche recette affichent la même chose.
- **La date du jour des outils est celle de Paris** (`aujourdhuiParis()`, passée par `lib/mcp/serveur.ts`). Pourquoi : Vercel tourne en UTC ; entre minuit et 1-2 h, le MCP calculait un autre jour, donc un autre cycle que `/courses` autour du week-end.
- Contrats RG-73/78 : un repas = `date` (AAAA-MM-JJ) + `creneau` (`midi` | `soir`), plage −12/+6 semaines (`semaineDansPlage`) ; liste de courses non cochée par défaut. Toute évolution d'un contrat se répercute dans la description de l'outil (`lib/mcp/serveur.ts`), que lit l'assistant.
- Erreurs attendues = `ErreurOutil` (message français qui dit quoi faire ensuite, renvoyé en `isError`). Toute autre exception est loggée et masquée derrière un message générique.

## Tests

- Unitaires : `lib/mcp/*.test.ts` (client mocké, client navigateur qui lève), `app/api/mcp/route.test.ts` (vrai mcp-handler, auth et lectures mockées).
- e2e : `e2e/oauth-mcp.spec.ts` (comptes jetables, un client DCR par test). Les boutons du consentement se ciblent dans la région « Autoriser <client> ? », car le bandeau cookies porte aussi un bouton « Refuser ».
