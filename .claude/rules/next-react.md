---
paths:
  - "app/**/*.ts"
  - "app/**/*.tsx"
  - "components/**/*.tsx"
  - "lib/**/*.ts"
  - "proxy.ts"
  - "next.config.ts"
  - "instrumentation*.ts"
  - "sentry.*.config.ts"
---

# Next.js 16 / React : conventions et pièges

## État client : stores `useSyncExternalStore`

- Tout état client persistant (localStorage, auth, `visualViewport`…) passe par un mini-store `useSyncExternalStore` avec snapshot serveur `null` (prérendu vide, puis hydratation). Pourquoi : la règle ESLint `react-hooks/set-state-in-effect` interdit le `setState` synchrone au montage, et le pattern évite les mismatches d'hydratation. Exemples : `lib/stockage.ts`, `lib/sync.ts`, `lib/theme.ts`, `lib/session.ts`, `lib/profil.ts`, `lib/clavier.ts`.
- **Un `getSnapshot` qui renvoie un objet doit mémoïser son parse.** On cache la chaîne brute et on ne re-parse que si elle change (cf. `lireCyclePlanning` / `lireCycleAffiche` de `lib/sync.ts`). Pourquoi : un `JSON.parse` à chaque appel produit une nouvelle référence, donc une boucle de rendu infinie (React #185) et l'error boundary. Le symptôme reste invisible tant que la valeur vaut `null` et apparaît dès que la clé est écrite. Test de verrouillage : « stabilité du snapshot » dans `lib/sync.test.ts`. Un store qui renvoie une primitive n'est pas concerné.
- **Chaque store notifie lui-même ses abonnés** (`Set` interne) à chaque écriture, car l'événement `storage` ne se déclenche que dans les *autres* onglets. Toute écriture localStorage passe donc par le store.
- Une page n'écrit pas `storePlanning` directement : elle passe par `sauvegarderPlanningComplet` (efface aussi les coches, RG-13) ou `sauvegarderRemplacementSlot` (les conserve).

## Routage et rendu

- **Proxy Next 16** : `proxy.ts` à la racine exporte une fonction nommée `proxy` (ex-`middleware`, déprécié) avec le même `export const config = { matcher }`. Il rafraîchit la session Supabase et gère les redirections. Ajouter une route protégée = éditer `protectedRoutes` de `proxy.ts`.
- **`useSearchParams` exige une frontière `<Suspense>`**, sinon le build casse. Ex. `app/recettes/page.tsx` isole `ContenuRecettes` dans un `<Suspense>`. Pour lire un paramètre sans Suspense : `window.location.search` dans un effet.
- **Code serveur et code client dans des fichiers séparés.** Un module qui importe `node:fs` (ex. `lib/legal-fs.ts`) n'exporte rien qu'un Client Component importe : les constantes partagées vivent dans un fichier client-safe (`lib/legal.ts`). Pourquoi : Turbopack casse le **build** (« the chunking context does not support external modules »), alors que ni le dev ni le typecheck ne le voient.
- **Rendu après hydratation** (`useHydratation`) pour tout ce qui dépend de la date ou de l'environnement du client (ex. navigateur de semaines), sinon mismatch SSR.

## Clients Supabase

`lib/supabase/client.ts` (navigateur, `createBrowserClient`), `lib/supabase/server.ts` (serveur, `createServerClient` + cookies), `lib/supabase/admin.ts` (`service_role`, serveur uniquement, jamais importé côté client), `lib/supabase/par-jeton.ts` (serveur, clé anon + `Authorization: Bearer <jwt>`, pour le MCP ; jamais `service_role`). Importer le mauvais client produit des erreurs de session.

- Les fonctions d'accès qui doivent tourner côté serveur prennent un client **injecté** typé `ClientSupabase` (`lib/supabase/types.ts`), avec le client navigateur par défaut. Pourquoi : avec le client par jeton, la RLS `mon_foyer()` s'applique au JWT de l'utilisateur (RG-71) et la même fonction sert le web et le MCP.

## Observabilité et sécurité HTTP

- **Sentry v10** : config client dans `instrumentation-client.ts` (les tutos citant `sentry.client.config.ts` sont obsolètes) ; serveur/edge dans `sentry.server.config.ts` / `sentry.edge.config.ts`, chargés par `instrumentation.ts`. Variable : `NEXT_PUBLIC_SENTRY_DSN` (le préfixe inline le DSN côté client, un DSN n'est pas un secret). Volontairement sans tracing, sans replay ni upload de source maps : les stack traces de prod sont minifiées, le digest Next fait référence.
- **En-têtes de sécurité dans `headers()` de `next.config.ts`** : `ENTETES_SECURITE` (statiques) + `CSP`. Vercel ajoute HSTS lui-même. La CSP est servie en `Content-Security-Policy-Report-Only` : elle journalise sans bloquer. `script-src 'unsafe-inline'` est voulu, car un nonce forcerait le rendu dynamique partout. La bascule en enforcement consiste à renommer la clé. **Toute nouvelle origine externe (CDN, API tierce) s'ajoute à `CSP`.**
- **Rate-limit** : `lib/rate-limit.ts` (Upstash, `limiteGeneration(user.id)`, 10/min/utilisateur sur `POST /api/planning/generer`). Il est **NO-OP si `UPSTASH_REDIS_REST_URL`/`_TOKEN` sont absentes**, ce qui est voulu en CI et en dev ; il n'est donc couvert qu'en unitaire. Il est fail-open si Upstash est injoignable. Un dépassement renvoie 429 via `apiError`, surfacé par `parseApiError`.

## Erreurs d'API

Les routes renvoient via `apiError(route, err, message, status)` ; le client traduit via `parseApiError` / `HTTP_ERROR_MESSAGES`.
