# OAuth 2.1 + serveur MCP + outils de lecture (#305) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un assistant IA (Hermes, Claude, Cursor, OpenCode ; ChatGPT en best effort) se connecte à OMQ par OAuth 2.1 (Supabase OAuth Server + DCR), via l'écran de consentement `/oauth/consent`, puis lit le planning, la liste de courses et une recette par le serveur MCP distant `/api/mcp`, en tant que l'utilisateur (RLS `mon_foyer()`), avec révocation depuis `/profil`.

**Architecture :** Supabase est le serveur d'autorisation (activé par l'API de management, sans code OMQ hormis l'écran de consentement). `/api/mcp` est un route handler `mcp-handler` v2 enveloppé par `withMcpAuth`, qui vérifie le JWT par `auth.getClaims()` de supabase-js (JWKS ES256 en cache, aucune dépendance JWT en plus) et exige le claim `client_id` (un JWT de session web est refusé). Chaque outil crée un `creerClientParJeton(jeton)` et compose les services du socle #304 (`chargerListeCoursesCycle`, `retirerArticlesCoches`, `chargerPlanningDistant`…) dans `lib/mcp/`. La metadata RFC 9728 est servie sous `/.well-known/oauth-protected-resource[/api/mcp]`.

**Tech Stack :** Next.js 16.2 (route handlers, proxy), `mcp-handler@^2.3.0` + `@modelcontextprotocol/server@^2` + `zod@^4`, `@supabase/supabase-js` 2.108 (`auth.oauth.*`, `auth.getClaims`), Upstash (rate-limit), Vitest 4, Playwright contre staging.

**Spec :** issues #302 (épopée) et #305 ; `SPECS_FONCTIONNELLES.md` US-50, US-51, RG-71→73, RG-78, RG-79 ; `ADR.md` ADR-10, ADR-11 (dont « Mise en œuvre #304 »). Cadrage arbitré le 2026-10-29 : on ne rouvre pas le design.

## Faits vérifiés le 2026-10-29 (fondent les choix)

- **CI** : crédits Actions revenus (run PR #313 de 8 min 12 vert). Procédure CI normale : `migrate-staging`/`e2e` sur PR. **#305 n'a aucune migration SQL** (les grants OAuth vivent dans le schéma `auth`, géré par Supabase).
- **Signature JWT** staging et prod : `ES256` `in_use`, `HS256` `previously_used`. Asymétrique déjà en place : rien à faire. JWKS : `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`.
- **Config OAuth exposée par l'API de management** (`GET/PATCH /v1/projects/<ref>/config/auth`) : `oauth_server_enabled`, `oauth_server_allow_dynamic_registration`, `oauth_server_authorization_path` (aujourd'hui `false`/`false`/`null` sur les deux projets). Le dashboard n'est qu'un repli si le PATCH est refusé.
- **URL de consentement = `site_url` + chemin.** Staging : `site_url = http://localhost:3000` (idéal pour l'e2e local). Prod : `https://webapp-repas.vercel.app/` (**slash final** : vérifier que la redirection ne produit pas `//oauth/consent`).
- **supabase-js 2.108.1** : `auth.oauth.getAuthorizationDetails(id)`, `approveAuthorization(id, { skipBrowserRedirect })`, `denyAuthorization(id, …)`, `listGrants()` → `{ client: { id, name, uri, logo_uri }, scopes, granted_at }[]`, `revokeGrant({ clientId })` (révoque le consentement, supprime les sessions du client et invalide ses refresh tokens). **Le repli v1 « Déconnecter tous les assistants » est inutile.**
- **Jeton d'accès** : JWT `authenticated`, claims `sub`, `role`, `client_id`, `exp` ; `jwt_exp = 3600` ⇒ un client révoqué garde son jeton d'accès au plus 1 h (RG-72 l'admet).
- **mcp-handler 2.3.0** : `createMcpHandler(init, options)`, `server.registerTool(nom, { title, description, inputSchema: z.object(…) }, async (args, ctx) => …)`, `ctx.http?.authInfo`, `withMcpAuth(handler, verifyToken, { required, resourceMetadataPath, requiredScopes, resourceUrl })`, `protectedResourceHandler({ authServerUrls, resourceUrl })`, `metadataCorsOptionsRequestHandler()`, `getPublicOrigin(req)`. Sans état (pas de Redis) ; spec 2026-07-28 + repli Streamable HTTP 2025.
- **Vercel** : previews sous **Vercel Authentication** (`all_except_custom_domains`) ; variables Preview distinctes de Production pour `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` (cible présumée staging, à confirmer en Task 12). **`UPSTASH_REDIS_REST_*` absentes de Vercel** : le rate-limit est NO-OP en prod aujourd'hui, `generer` compris.

## Global Constraints

- Code, identifiants, commentaires, messages d'erreur et textes UI **en français**, commentaires citant `RG-xx` / `US-xx`. Apostrophe typographique `’` dans le texte JSX.
- **Jamais de `service_role` sur le chemin MCP** (RG-71) : seul `creerClientParJeton` (clé anon + Bearer) ; aucun import de `lib/supabase/admin.ts` sous `lib/mcp/`, `app/api/mcp/`, `app/oauth/`, `app/.well-known/`.
- **Toujours passer le client par jeton** aux lectures côté serveur ; ne jamais s'appuyer sur `clientParDefaut()` hors navigateur.
- **Composer, ne pas réimplémenter** : `chargerListeCoursesCycle`, `retirerArticlesCoches`, `chargerPlanningDistant`, `chargerJourCoursesFoyer`, `chargerLongueurCycle`, `chargerReglages`, `retirerCreneauxDesactives`, `joursDuCycle`, `dateVersSemaineJour`, `formaterQuantite`. Tout calcul déjà fait inline dans un composant est extrait dans `lib/` et le composant le réutilise (règle du jumeau).
- Noms d'outils exacts : `lire_planning`, `lire_liste_courses`, `lire_recette`. Créneaux : `midi` | `soir` (`midi` ↔ `dejeuner`, `soir` ↔ `diner`). Dates ISO `AAAA-MM-JJ`, semaines `AAAA-Www`. Plage : −12 / +6 semaines (`SEMAINES_PASSEES`, `SEMAINES_FUTURES`, RG-73).
- Erreurs d'outil : résultat MCP `isError: true` + texte français qui dit **quoi faire ensuite**. Une erreur inattendue est loggée (`console.error`) et renvoie « Erreur interne d'OMQ. Réessaie dans un instant. ».
- Rate-limit MCP : préfixe Upstash `rl:mcp`, **60 requêtes / 60 s / utilisateur** (`sub`), NO-OP sans env, fail-open.
- Tout écran gère loading / error / empty. Mobile-first. Tokens `DESIGN.md` / `ui.md` ; réutiliser `ConfirmationModale` et les styles de bouton existants de `/profil`.
- Pas de nouvelle migration. TypeScript strict.
- **Jamais `npm run test:e2e` en local.** E2E : `npm run test:e2e:staging -- …`.
- **Toute action prod** (config OAuth Supabase prod, variables Vercel, protection de déploiement, merge) est soumise à l'utilisateur avec l'ordre exact, avant exécution.
- Hors périmètre : outils d'écriture et dettes notées pour #306 (`recette_id` du foyer dans `sauvegarder_cycle`/`sauvegarder_slots`, ancre-date impossible), épopée #303, article d'aide Notion.
- Flaky connus sur `main` (pas des régressions) : `planning-edition` « annuler une régénération restaure aussi les coches », « restaure le planning précédent à l'identique », fiche favori/évitée ; `planning.spec` « sélection manuelle conserve les coches » ; `courses.spec` #111 « catégorie entièrement cochée » et :582 « cocher puis tout décocher un article manuel ».

## Décisions prises dans ce plan (à valider avec le plan)

1. **Vérification du jeton par `auth.getClaims(jeton)`** (supabase-js, JWKS mis en cache globalement) plutôt que `jose` : zéro dépendance, signature ES256 vérifiée localement. Exigences en plus : `role === "authenticated"`, `sub` et **`client_id` présents** (un JWT de session web n'ouvre pas le MCP, RG-71 « toute requête exige un jeton OAuth 2.1 »).
2. **Texte du consentement annonçant aussi les modifications** : un grant accordé maintenant couvrira les outils d'écriture de #306 sans nouveau consentement (Supabase ne distingue pas de scope lecture/écriture). Le dire dès #305 est la version honnête de RG-72.
3. **Retour après login** : le proxy redirige `/oauth/*` non connecté vers `/login?suivant=<chemin+query>`, et `FormulaireAuth` y revient après succès si le chemin est sûr. Restreint à `/oauth` pour ne rien changer aux autres parcours.
4. **Onboarding non terminé** : la garde proxy existante redirige vers `/bienvenue` (RG-72 respecté). L'autorisation en cours est perdue ; l'assistant relance. Assumé en v1.
5. **Metadata RFC 9728** servie aux deux chemins `/.well-known/oauth-protected-resource` et `/.well-known/oauth-protected-resource/api/mcp`, `resource` = `<origine>/api/mcp` dans les deux cas ; `WWW-Authenticate` pointe la variante suffixée.
6. **Proxy** : retour immédiat `NextResponse.next()` pour `/api/mcp` et `/.well-known/*` (aucun client Supabase à cookies, aucune garde d'onboarding).
7. **CSP inchangée** : le consentement n'appelle que `*.supabase.co` (déjà dans `connect-src`) et redirige par `window.location.assign`, que la CSP ne régit pas (pas de `form-action` vers le client OAuth). `/api/mcp` et la metadata sont appelés de serveur à serveur. Pas de CORS sur `/api/mcp` en v1 (clients navigateur type MCP Inspector hors cible).

## Review Focus

1. **Un JWT de session web (sans `client_id`) ou un jeton `anon` envoyé à `/api/mcp`** → `401` avec `WWW-Authenticate`, jamais une lecture. Test : Task 3.
2. **Date impossible ou hors plage** (`2026-02-30`, `demain`, `2027-12-01`, semaine `2026-W60`) → erreur française actionnable, pas d'exception ni de lecture. Test : Task 5.
3. **Créneau désactivé, repas absent ou repas « restes »** pour `lire_recette` / `lire_planning` : pas de recette fantôme ; les restes sont signalés. Test : Task 5.
4. **Cycle de 14 j sur 3 semaines ISO avec jours de semaine répétés** : chaque date du cycle porte le repas de **sa** semaine ISO. Test : Task 4.
5. **`suivant` malveillant** (`//evil.com`, `https://evil.com`, `/\evil.com`, `javascript:…`) → retour `/planning` (anti open-redirect). Test : Task 7.

---

## Préalable

- [ ] `git switch main && git pull && git switch -c feat/305-oauth-mcp-lecture`
- [ ] `npm run test:run` → tout vert ; noter le nombre de tests (référence).
- [ ] Commit du plan : `git add docs/superpowers/plans/2026-10-29-oauth-mcp-lecture-305.md && git commit -m "docs: plan d'implémentation OAuth + MCP lecture (#305)"`

---

### Task 1 : script de configuration OAuth Supabase, activation sur staging

**Files :**
- Create : `scripts/configurer-oauth-supabase.mjs`

**Interfaces :**
- Produces : `node scripts/configurer-oauth-supabase.mjs <ref> [--appliquer]`. Sans drapeau : affiche `site_url`, les trois clés `oauth_server_*`, les algos des clés de signature et le statut du projet (lecture seule). Avec `--appliquer` : `PATCH /v1/projects/<ref>/config/auth` avec `{ oauth_server_enabled: true, oauth_server_allow_dynamic_registration: true, oauth_server_authorization_path: "/oauth/consent" }`, puis relit et affiche. Token : `SUPABASE_ACCESS_TOKEN` de l'env, sinon lu dans `.env.local` (même lecture que `scripts/e2e-staging.mjs`). Refuse `--appliquer` sur la ref prod `gabyhlcwahzquolwxmgd` sans `--prod-valide` (garde-fou).

- [ ] **Step 1 : écrire le script** (Node pur, `fetch`, messages français, sortie non nulle si HTTP ≠ 2xx).
- [ ] **Step 2 : lecture staging** : `node scripts/configurer-oauth-supabase.mjs upxoxrjumxpzumakawiv` → attendu `oauth_server_enabled = false`, `ES256 in_use`.
- [ ] **Step 3 : activation staging** : `… upxoxrjumxpzumakawiv --appliquer` → relecture `true` / `true` / `"/oauth/consent"`. Si le PATCH est refusé (bêta non exposée), **s'arrêter et demander à l'utilisateur** de l'activer au dashboard (Authentication → OAuth Server : activer, Authorization Path `/oauth/consent`, Dynamic Client Registration ON).
- [ ] **Step 4 : vérifier la découverte** : `curl -s https://upxoxrjumxpzumakawiv.supabase.co/.well-known/oauth-authorization-server/auth/v1` → JSON avec `issuer` = `https://upxoxrjumxpzumakawiv.supabase.co/auth/v1`, `registration_endpoint` présent, `code_challenge_methods_supported` contient `S256`. Noter la valeur exacte d'`issuer` (elle sert d'`authServerUrls`, Task 6).
- [ ] **Step 5 : commit** `chore: script de configuration du serveur OAuth Supabase (#305)`

---

### Task 2 : dépendances et rate-limit MCP dédié

**Files :**
- Modify : `package.json`, `package-lock.json`, `lib/rate-limit.ts`, `lib/rate-limit.test.ts`

**Interfaces :**
- Produces : `limiteMcp(identifiant: string): Promise<{ autorise: boolean }>` (préfixe `rl:mcp`, `slidingWindow(60, "60 s")`). `limiteGeneration` inchangé (`rl:generer`, 10/60 s). Les deux reposent sur une fabrique interne `creerLimiteur(prefixe, requetes, fenetre)` qui renvoie `null` sans env.

- [ ] **Step 1 : installer** `npm install mcp-handler@^2.3.0 @modelcontextprotocol/server@^2 zod@^4`. Vérifier `node_modules/mcp-handler/package.json` et `node_modules/@modelcontextprotocol/server/package.json` présents (piège Avast/OneDrive).
- [ ] **Step 2 : tests** (`lib/rate-limit.test.ts`, en suivant le mock Upstash existant) :
  - `"limiteMcp : NO-OP sans variables Upstash"` → `{ autorise: true }`.
  - `"limiteMcp : préfixe rl:mcp et 60 requêtes / 60 s"` → `Ratelimit` construit avec `prefix: "rl:mcp"` et `slidingWindow(60, "60 s")`.
  - `"limiteMcp : fail-open si Upstash lève"` → `{ autorise: true }` + `console.error`.
  - `"limiteGeneration inchangé (rl:generer, 10/60 s)"`.
- [ ] **Step 3 : vérifier l'échec**, puis **implémenter** ; **vérifier le succès** : `npx vitest run lib/rate-limit.test.ts`.
- [ ] **Step 4 : commit** `feat: rate-limit MCP dédié par utilisateur (#305, RG-78)`

---

### Task 3 : vérification du jeton OAuth (`lib/mcp/auth.ts`)

**Files :**
- Create : `lib/mcp/auth.ts`, `lib/mcp/auth.test.ts`

**Interfaces :**
- Consumes : `creerClientParJeton(jeton)` (`lib/supabase/par-jeton.ts`).
- Produces :
  - `emetteurOAuth(): string` → `` `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1` `` (doit égaler l'`issuer` relevé en Task 1, Step 4).
  - `verifierJetonMcp(req: Request, jeton?: string): Promise<AuthInfo | undefined>` (type `AuthInfo` de `@modelcontextprotocol/server`) → `{ token: jeton, clientId: claims.client_id, scopes: (claims.scope ?? "").split(" ").filter(Boolean), expiresAt: claims.exp, extra: { userId: claims.sub } }`. Appelle `creerClientParJeton(jeton).auth.getClaims(jeton)`. Renvoie `undefined` (jamais d'exception) si : jeton absent, `error` de `getClaims`, `role !== "authenticated"`, `sub` absent, `client_id` absent.

- [ ] **Step 1 : tests** (mock de `@/lib/supabase/par-jeton` dont `auth.getClaims` est un espion) :
  - `"accepte un jeton OAuth authenticated et expose userId, clientId, expiresAt"`.
  - `"refuse l'absence de jeton sans créer de client"`.
  - `"refuse un JWT de session web sans client_id (RG-71)"`.
  - `"refuse un jeton anon (role anon)"`.
  - `"refuse un jeton dont getClaims renvoie une erreur (signature, expiration)"`.
  - `"ne lève jamais : une exception de getClaims donne undefined"` (+ `console.error`).
- [ ] **Step 2 : vérifier l'échec** ; **implémenter** ; **vérifier le succès** : `npx vitest run lib/mcp/auth.test.ts`.
- [ ] **Step 3 : commit** `feat: vérification du jeton OAuth du serveur MCP (#305, RG-71)`

---

### Task 4 : briques pures partagées (dates des repas, plage, échelle, libellés)

**Files :**
- Create : `lib/mcp/repas.ts`, `lib/mcp/repas.test.ts`
- Modify : `lib/generation.ts` (+ test existant), `lib/personnes.ts` (+ `lib/personnes.test.ts`), `components/planning/fiche-recette.tsx`, `lib/courses.ts` (+ test), `app/courses/page.tsx`

**Interfaces :**
- Produces :
  - `semaineDansPlage(semaineCourante: string, semaine: string): boolean` (`lib/generation.ts`, −`SEMAINES_PASSEES` ≤ décalage ≤ `SEMAINES_FUTURES`) ; les trois contrôles inline de `genererPourUtilisateur` l'utilisent (messages et codes inchangés).
  - `ingredientsAEchelle(ingredients: Ingredient[], personnes: number): Ingredient[]` (`lib/personnes.ts`, `×facteurEchelle` puis `arrondirQuantite`) ; `fiche-recette.tsx` l'utilise à la place de son calcul inline.
  - `LIBELLES_CATEGORIES: Record<CategorieIngredient, string>` déplacé de `app/courses/page.tsx` vers `lib/courses.ts` (mêmes valeurs), importé par la page.
  - `type Creneau = "midi" | "soir"` et `TYPE_REPAS: Record<Creneau, "dejeuner" | "diner">` (`lib/mcp/repas.ts`).
  - `type RepasDate = { date: string; creneau: Creneau; jour: Jour; jp: JourPlanning }`.
  - `repasAuxDates(plannings: Planning[], dates: string[]): RepasDate[]` : pour chaque date (ordre), `dateVersSemaineJour` puis le `JourPlanning` de **sa** semaine ; un élément par créneau qui porte une recette (`midi` avant `soir`) ; dates sans planning omises.
  - `datesDeSemaine(semaine: string): string[]` : les 7 dates ISO lundi→dimanche (via `lundiDeSemaine`).
  - `validerDate(date: string): string | null` (`null` si `AAAA-MM-JJ` valide **et** réelle : `2026-02-30` refusée).

- [ ] **Step 1 : tests**
  - `repas.test.ts` : `"repasAuxDates : cycle de 14 j ancré un dimanche, 3 semaines ISO, chaque date lit sa semaine"` (recettes distinctes par semaine pour un même jour de semaine) ; `"omet les créneaux sans recette et les dates sans planning"` ; `"ordonne midi avant soir"` ; `"datesDeSemaine('2026-W44') → 2026-10-26 … 2026-11-01"` ; `"validerDate refuse 2026-02-30, 26-10-29, demain"`.
  - `lib/personnes.test.ts` : `"ingredientsAEchelle : 4 personnes double et arrondit par unité (RG-17)"`, `"ne mute pas l'entrée"`.
  - `lib/generation.test.ts` : `"semaineDansPlage : bornes −12 et +6 incluses, −13 et +7 exclues"`.
- [ ] **Step 2 : vérifier l'échec** ; **implémenter** ; refactorer `fiche-recette.tsx`, `app/courses/page.tsx`, `genererPourUtilisateur`.
- [ ] **Step 3 : vérifier** : `npm run test:run` (tout vert, dont les tests existants de génération, fiche et courses).
- [ ] **Step 4 : commit** `refactor: briques partagées pour les lectures MCP (échelle, plage, libellés) (#305)`

---

### Task 5 : outils de lecture (`lib/mcp/lecture.ts`)

**Files :**
- Create : `lib/mcp/erreurs.ts`, `lib/mcp/lecture.ts`, `lib/mcp/lecture.test.ts`

**Interfaces :**
- Consumes : Task 4 (`repasAuxDates`, `datesDeSemaine`, `validerDate`, `TYPE_REPAS`, `semaineDansPlage`, `ingredientsAEchelle`, `LIBELLES_CATEGORIES`), socle #304, `retirerCreneauxDesactives`, `estRestes`, `estCoche`, `formaterQuantite`, `libelleCycle`, `ancreParDefaut`, `joursDuCycle`, `semaineISO`.
- Produces :
  - `class ErreurOutil extends Error` (message destiné à l'assistant).
  - `lirePlanning(supabase, args: { semaine?: string }, aujourdhui?: Date): Promise<PlanningMcp>` : sans `semaine`, cycle courant (`ancreParDefaut` + `chargerLongueurCycle` + `joursDuCycle`) ; avec `semaine`, ses 7 dates. Réglages appliqués par `retirerCreneauxDesactives` (comme `/planning`).
    `PlanningMcp = { periode: { du: string; au: string; libelle: string }; repas: Array<{ date; creneau; jour; recette: string; personnes: number; restes: boolean; vegetarien: boolean; temps_preparation: TempsPreparation }> }`.
  - `lireListeCourses(supabase, args: { inclure_coches?: boolean }, aujourdhui?: Date): Promise<ListeMcp>` : `chargerListeCoursesCycle(supabase, { aujourdhui })`, puis `retirerArticlesCoches` sauf si `inclure_coches`.
    `ListeMcp = { cycle: { du; au; libelle }; categories: Array<{ categorie: string; articles: Array<{ nom: string; quantite: string; manuel: boolean; coche?: boolean }> }>; a_verifier_au_placard: Array<{ nom; quantite; manuel; coche? }>; nombre_articles: number }` (`coche` présent seulement si `inclure_coches`).
  - `lireRecette(supabase, args: { date: string; creneau: Creneau }, aujourdhui?: Date): Promise<RecetteMcp>`.
    `RecetteMcp = { date; creneau; recette: string; personnes: number; restes: boolean; vegetarien: boolean; temps_preparation; ingredients: Array<{ nom; quantite: string }>; a_verifier_au_placard: Array<{ nom; quantite }>; etapes: string[] }`.

Messages d'erreur exacts (copie fixée) :
- semaine mal formée : `Semaine invalide : utilise le format AAAA-Www (ex. 2026-W44).`
- date mal formée ou impossible : `Date invalide : utilise le format AAAA-MM-JJ (ex. 2026-10-29).`
- hors plage : `Cette date est hors de la plage consultable (12 semaines en arrière, 6 en avant). Choisis une date plus proche.`
- aucun repas (`lireRecette`) : `Aucun repas prévu le <jour> <j> <mois> <au midi|au soir>. Appelle lire_planning pour voir les repas prévus.`
- planning vide (pas une erreur) : `repas: []` ; le texte rendu par le serveur (Task 6) dit `Aucun repas prévu sur cette période. L’utilisateur peut générer son planning depuis l’app OMQ.`

- [ ] **Step 1 : tests** (`creerSupabaseMock`, `aujourdhui` fixé à `new Date(2026, 9, 29)`, fixtures de `tests/fixtures/recettes.ts`) :
  - `"lirePlanning : cycle courant, repas avec date + créneau (RG-73)"`.
  - `"lirePlanning : semaine ISO donnée → 7 dates de la semaine"`.
  - `"lirePlanning : créneau désactivé dans les réglages → absent (RG-46)"`.
  - `"lirePlanning : semaine mal formée / hors plage → ErreurOutil (message exact)"`.
  - `"lireListeCourses : non cochés par défaut, groupés par libellé de catégorie, manuels inclus (RG-78)"`.
  - `"lireListeCourses : inclure_coches → articles cochés présents avec coche: true"`.
  - `"lireListeCourses : passe le client injecté à chargerListeCoursesCycle (jamais le défaut)"` (espion).
  - `"lireRecette : ingrédients à l'échelle des personnes du repas et étapes"` (4 personnes → quantités doublées).
  - `"lireRecette : repas de restes → restes: true"`.
  - `"lireRecette : aucun repas / créneau désactivé → ErreurOutil (message exact)"`.
  - `"lireRecette : 2026-02-30, demain, 2027-12-01 → ErreurOutil (format ou plage)"`.
- [ ] **Step 2 : vérifier l'échec** ; **implémenter** ; **vérifier le succès** : `npx vitest run lib/mcp/lecture.test.ts`.
- [ ] **Step 3 : commit** `feat: outils de lecture MCP lire_planning, lire_liste_courses, lire_recette (#305, RG-73, RG-78)`

---

### Task 6 : serveur MCP, route `/api/mcp`, metadata RFC 9728, proxy

**Files :**
- Create : `lib/mcp/serveur.ts`, `app/api/mcp/route.ts`, `app/api/mcp/route.test.ts`, `app/.well-known/oauth-protected-resource/[[...ressource]]/route.ts`, `app/.well-known/oauth-protected-resource/route.test.ts`
- Modify : `proxy.ts`

**Interfaces :**
- Consumes : Tasks 2, 3, 5.
- Produces :
  - `enregistrerOutilsLecture(server: McpServer): void` : trois `registerTool` (noms exacts), `inputSchema` zod : `lire_planning { semaine?: string }`, `lire_liste_courses { inclure_coches?: boolean }`, `lire_recette { date: string, creneau: "midi" | "soir" }` ; descriptions françaises qui disent quand appeler l'outil (ex. lire_recette : « Ingrédients à l'échelle du repas et étapes d'une recette prévue, désignée par date et créneau. Appelle d'abord lire_planning si tu ne connais pas la date. »). Le handler lit `ctx.http?.authInfo?.token`, crée `creerClientParJeton`, appelle la lecture, renvoie `{ content: [{ type: "text", text: JSON.stringify(resultat) }], structuredContent: resultat }`. `ErreurOutil` → `{ isError: true, content: [{ type: "text", text: message }] }` ; autre exception → `console.error` + `Erreur interne d'OMQ. Réessaie dans un instant.`
  - Route : `createMcpHandler(s => enregistrerOutilsLecture(s), { serverInfo: { name: "omq", version: <package.json> } })`, enveloppé par `withMcpAuth(…, verifierJetonMcp, { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp" })`. Entre l'auth et le handler : `limiteMcp(req.auth.extra.userId)` → si refusé, `429` JSON-RPC `{ jsonrpc: "2.0", error: { code: -32000, message: "Trop de requêtes en peu de temps. Patiente une minute puis réessaie." }, id: null }` + `Retry-After: 60`. Export `GET`, `POST`, `DELETE`.
  - Metadata : `GET` → `protectedResourceHandler({ authServerUrls: [emetteurOAuth()], resourceUrl: \`${getPublicOrigin(req)}/api/mcp\` })(req)` ; `OPTIONS` → `metadataCorsOptionsRequestHandler()`.
  - `proxy.ts` : `export function sansSession(pathname: string): boolean` (vrai pour `/api/mcp` et ce qui commence par `/.well-known/`) ; en tête de `proxy`, `if (sansSession(pathname)) return NextResponse.next()`.

- [ ] **Step 1 : tests** (`// @vitest-environment node`, mock de `@/lib/mcp/auth`, `@/lib/rate-limit`, `@/lib/mcp/lecture`) :
  - `"POST sans Bearer → 401, WWW-Authenticate contient resource_metadata=…/.well-known/oauth-protected-resource/api/mcp"`.
  - `"jeton refusé par verifierJetonMcp → 401"`.
  - `"jeton valide : tools/list expose exactement lire_planning, lire_liste_courses, lire_recette"` (si le SDK exige `initialize` d'abord, l'envoyer dans le helper de test).
  - `"tools/call lire_recette : ErreurOutil → isError true et message français"`.
  - `"quota dépassé → 429 JSON-RPC et Retry-After"`.
  - `"le client des outils est créé avec le jeton de la requête"` (espion sur `creerClientParJeton`).
  - Metadata : `"les deux chemins renvoient resource = <origine>/api/mcp et authorization_servers = [<SUPABASE_URL>/auth/v1]"` ; `"OPTIONS renvoie les en-têtes CORS"`.
  - `proxy` : `"sansSession : /api/mcp et /.well-known/* vrais ; /api/planning/generer, /oauth/consent faux"` (dans `proxy.test.ts`, créé ici).
- [ ] **Step 2 : vérifier l'échec** ; **implémenter** ; **vérifier** : `npx vitest run app/api/mcp app/.well-known proxy.test.ts`.
- [ ] **Step 3 : vérif manuelle locale** (`next dev` sur `.env.local` = prod, lecture seule, sans jeton) : `curl -i -X POST localhost:3000/api/mcp` → `401` + `WWW-Authenticate` ; `curl -s localhost:3000/.well-known/oauth-protected-resource/api/mcp` → JSON attendu. Confirme que Next sert bien le dossier `app/.well-known`.
- [ ] **Step 4 : commit** `feat: route /api/mcp (mcp-handler v2, withMcpAuth) et metadata RFC 9728 (#305, RG-71)`

---

### Task 7 : retour après login et protection de `/oauth`

**Files :**
- Create : `lib/redirection.ts`, `lib/redirection.test.ts`
- Modify : `proxy.ts`, `proxy.test.ts`, `components/auth/formulaire-auth.tsx`

**Interfaces :**
- Produces :
  - `cheminDeRetour(brut: string | null): string` → `brut` s'il commence par `/`, sans `//`, sans `\`, sans `:` avant le premier `/` ; sinon `"/planning"`.
  - `proxy.ts` : `"/oauth"` ajouté à `protectedRoutes` ; pour un chemin `/oauth/*` non connecté, redirection vers `/login?suivant=<encodeURIComponent(pathname + search)>` (le code d'invitation reste préservé). Connecté, onboardé et sur `/login` avec `suivant` : redirection vers `cheminDeRetour(suivant)` au lieu de `/planning`.
  - `FormulaireAuth` : après succès, `window.location.assign(cheminDeRetour(new URLSearchParams(window.location.search).get("suivant")))`.

- [ ] **Step 1 : tests** : `redirection.test.ts` → `"accepte /oauth/consent?authorization_id=abc"`, `"refuse //evil.com, https://evil.com, /\\evil.com, javascript:alert(1), null, chaîne vide → /planning"`. `proxy.test.ts` → `"chemin /oauth non connecté → /login?suivant=…"` si le proxy est testable avec un client mocké (`vi.mock("@supabase/ssr")`) ; sinon couverture par l'e2e de Task 10.
- [ ] **Step 2 : vérifier l'échec** ; **implémenter** ; **vérifier** : `npx vitest run lib/redirection.test.ts proxy.test.ts`.
- [ ] **Step 3 : commit** `feat: retour vers le consentement OAuth après connexion (#305, RG-72)`

---

### Task 8 : écran de consentement `/oauth/consent`

**Files :**
- Create : `app/oauth/consent/page.tsx`, `components/oauth/ecran-consentement.tsx`, `components/oauth/ecran-consentement.test.tsx`

**Interfaces :**
- Consumes : `createClient()` (`lib/supabase/client.ts`), `auth.oauth.getAuthorizationDetails` / `approveAuthorization` / `denyAuthorization` avec `{ skipBrowserRedirect: true }` puis `window.location.assign(data.redirect_url)`.
- Produces : `EcranConsentement({ authorizationId }: { authorizationId: string | null })` ; la page lit `authorization_id` (frontière `<Suspense>` si `useSearchParams`).

Comportement et copie fixée :
- **Chargement** : « Chargement de la demande… ».
- **Erreur** (id absent, `error`, demande expirée) : « Cette demande d’autorisation est invalide ou a expiré. Relance la connexion depuis ton assistant. »
- **Déjà autorisé** (réponse `redirect_url`) : redirection immédiate, sans écran.
- **Consentement** : titre « Autoriser <client.name> ? » ; « <client.name> pourra, en ton nom et seulement pour ton foyer : » puis la liste « consulter ton planning, ta liste de courses et tes recettes » / « générer ou modifier ton planning et ta liste de courses, et ajouter des recettes » ; « Connecté en tant que <user.email>. » ; hôte de `client.uri` s'il existe ; « Tu pourras retirer cet accès à tout moment depuis ton profil, section « Assistants connectés ». » ; boutons « Autoriser » (primaire) et « Refuser ».
- Pendant l'envoi : boutons désactivés ; échec d'approve/deny → message d'erreur affiché + `console.error`.

- [ ] **Step 1 : tests** (mock de `@/lib/supabase/client`, `window.location.assign` espionné) :
  - `"affiche le nom du client, les droits et l'email"`.
  - `"Autoriser → approveAuthorization(id, { skipBrowserRedirect: true }) puis redirection vers redirect_url"`.
  - `"Refuser → denyAuthorization puis redirection"`.
  - `"déjà autorisé → redirection immédiate"`.
  - `"authorization_id absent ou erreur → message d'erreur actionnable"`.
  - `"échec d'approbation → erreur affichée, boutons réactivés"`.
- [ ] **Step 2 : vérifier l'échec** ; **implémenter** ; **vérifier** : `npx vitest run components/oauth`.
- [ ] **Step 3 : commit** `feat: écran de consentement OAuth /oauth/consent (#305, US-50, RG-72)`

---

### Task 9 : « Assistants connectés » dans `/profil`

**Files :**
- Create : `components/profil/assistants-connectes.tsx`, `components/profil/assistants-connectes.test.tsx`
- Modify : `app/profil/page.tsx` (section après `PanneauFoyer`, même séparateur)

**Interfaces :**
- Consumes : `createClient().auth.oauth.listGrants()` / `revokeGrant({ clientId })`, `ConfirmationModale`.
- Produces : `AssistantsConnectes()`, section `aria-labelledby="titre-assistants"`, titre « Assistants connectés ».

Copie fixée : vide → « Aucun assistant connecté. » ; erreur → « Impossible de charger les assistants connectés. Réessaie plus tard. » ; ligne → nom du client + « autorisé le <date fr> » + bouton « Déconnecter » ; modale → « Déconnecter <nom> ? Il ne pourra plus accéder à ton compte et devra redemander ton autorisation. » ; succès → toast « <nom> est déconnecté. » et retrait de la ligne ; échec → toast d'erreur + `console.error`.

- [ ] **Step 1 : tests** : `"liste les grants (nom, date)"`, `"état vide"`, `"état d'erreur"`, `"Déconnecter → confirmation → revokeGrant({ clientId }) et ligne retirée"`, `"échec de révocation → ligne conservée, toast d'erreur"`.
- [ ] **Step 2 : vérifier l'échec** ; **implémenter** ; **vérifier** : `npx vitest run components/profil/assistants-connectes.test.tsx`.
- [ ] **Step 3 : commit** `feat: assistants connectés et révocation dans /profil (#305, RG-72)`

---

### Task 10 : e2e staging — consentement, isolation à deux foyers, révocation

**Files :**
- Create : `e2e/oauth.ts` (helpers), `e2e/oauth-mcp.spec.ts`
- Modify : `playwright.config.ts` (`oauth-mcp` ajouté à `SPECS_JETABLE`)

**Interfaces :**
- Produces (`e2e/oauth.ts`) :
  - `genererPkce(): { verifier: string; challenge: string }` (S256, `node:crypto`).
  - `enregistrerClientOAuth(request, nom: string): Promise<{ clientId: string }>` → `POST <SUPABASE_URL>/auth/v1/oauth/clients/register` (DCR, `redirect_uris: ["http://127.0.0.1:9999/callback"]`, `token_endpoint_auth_method: "none"`, `client_name: nom`) ; chemin exact repris du `registration_endpoint` de la découverte.
  - `urlAutorisation(clientId, challenge, state): string` → `<SUPABASE_URL>/auth/v1/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…`.
  - `capturerRedirection(page): Promise<URL>` → `page.route("http://127.0.0.1:9999/**")` qui répond 200 et résout l'URL reçue.
  - `echangerCode(request, clientId, code, verifier): Promise<{ access_token: string; refresh_token: string }>` et `rafraichir(request, clientId, refreshToken): Promise<APIResponse>` (`/auth/v1/oauth/token`).
  - `appelerOutilMcp(request, jeton, nom, args): Promise<{ statut: number; resultat?: { isError?: boolean; structuredContent?: unknown; content: { text: string }[] } }>` → `POST /api/mcp` (`Accept: application/json, text/event-stream`), `initialize` d'abord si requis, lecture JSON ou ligne SSE `data:`.
- Comptes : jetables (`inscrire` + `marquerOnboardingCompletDistant`, cf. `suppression-compte.spec`), emails `claude-e2e-oauth-<RUN>-a@example.com` / `-b@` / `-c@`.

- [ ] **Step 1 : tests** (`import { test, expect } from "./fixtures"`, contextes vierges + `attacherGardeCrash`) :
  - `"sans jeton : 401 + WWW-Authenticate, metadata RFC 9728 cohérente"`.
  - `"non connecté : authorize → /login?suivant=… → connexion → retour sur le consentement"`.
  - `"consentement : nom du client affiché, Autoriser → code → jeton → lire_planning OK (US-50)"`.
  - `"refus : Refuser → redirection avec error=access_denied"`.
  - `"isolation à deux foyers (RG-71)"` : B enregistre un planning de la semaine courante (RPC `sauvegarder_planning` avec deux recettes du catalogue, cf. `sauvegarderPlanningDistant`) ; le jeton OAuth de A → `lire_planning` sans les recettes de B et `lire_liste_courses` vide ; A enregistre son propre planning → `lire_planning` le renvoie.
  - `"onboarding non terminé : le consentement redirige vers /bienvenue"` (compte C sans `marquerOnboardingCompletDistant`).
  - `"révocation (RG-72)"` : `/profil` liste le client, « Déconnecter » + confirmation → la ligne disparaît ; `rafraichir` → réponse non OK (`invalid_grant`).
- [ ] **Step 2 : lancer** : `npm run test:e2e:staging -- e2e/oauth-mcp.spec.ts` → vert (staging configuré en Task 1, `site_url` = `http://localhost:3000`).
- [ ] **Step 3 : commit** `test: e2e OAuth + MCP (consentement, isolation deux foyers, révocation) (#305)`

---

### Task 11 : documentation dans la même PR

**Files :**
- Create : `.claude/rules/mcp.md` (frontmatter `paths: ["app/api/mcp/**", "app/oauth/**", "app/.well-known/**", "lib/mcp/**", "components/oauth/**", "scripts/configurer-oauth-supabase.mjs"]`)
- Modify : `CLAUDE.md` (ligne `mcp.md` dans le tableau des règles), `ADR.md` (ADR-11 : statut « accepté », section « Mise en œuvre #305 » ; arbre de dossiers : `app/api/mcp`, `app/oauth/consent`, `app/.well-known`, `lib/mcp/`, `components/oauth/`, `scripts/configurer-oauth-supabase.mjs`), `CHANGELOG.md` (`[Unreleased]` → Ajouté), `.claude/rules/next-react.md` (proxy : `sansSession`, `/oauth` protégé avec `suivant` ; rate-limit `limiteMcp`), `.claude/rules/foyer-compte.md` (section « Assistants connectés », `cheminDeRetour`), `.claude/rules/e2e.md` (spec jetable `oauth-mcp`, helpers `e2e/oauth.ts`, clients DCR qui s'accumulent sur staging).

Contenu imposé de `mcp.md` (format règle + pourquoi) : vérification par `getClaims` + `client_id` exigé ; client par jeton toujours injecté, jamais `service_role` ; composer les services `lib/` ; contrats RG-73/78 (`date` + `creneau`, non cochés par défaut) ; erreurs `ErreurOutil` actionnables ; URL de consentement = `site_url` + chemin (staging `http://localhost:3000` pour l'e2e, à restaurer après tout test sur preview) ; activation par `scripts/configurer-oauth-supabase.mjs` ; révocation effective au plus tard à `jwt_exp` (3600 s) ; Upstash requis pour que `limiteMcp` agisse ; ChatGPT exige `aud` = URL MCP, non émis par Supabase.

- [ ] **Step 1 : rédiger** ; ADR-11 cite les choix effectifs (getClaims, `client_id` requis, metadata aux deux chemins, `listGrants`/`revokeGrant`, rate-limit `rl:mcp` 60/min, texte de consentement incluant les écritures).
- [ ] **Step 2 : commit** `docs: règle mcp.md, ADR-11 et CHANGELOG pour OAuth + MCP lecture (#305)`

---

### Task 12 : livraison (ordre imposé), puis rapport de risque

- [ ] **a.** Branche `feat/305-oauth-mcp-lecture` (Préalable).
- [ ] **b.** `npm run test:run` → vert ; `npm run lint` → 0 erreur ; `npx tsc --noEmit` ; `npm run build` → OK (piège Turbopack).
- [ ] **c.** Staging configuré (Task 1) ; **suite e2e complète** : `npm run test:e2e:staging -- --retries=2`. Classer chaque échec : régression / flaky connu (liste des Global Constraints) / autre.
- [ ] **d.** `git push -u origin feat/305-oauth-mcp-lecture` puis `gh pr create` (corps : périmètre, « Closes #305 », « Part of #302 », décisions du plan, résultats de tests, actions prod à valider, attribution). Attendre `gh pr checks <n> --watch`.
- [ ] **e.** Confirmer la cible Supabase des previews Vercel : demander à l'utilisateur l'accord pour `vercel env pull --environment=preview` dans le scratchpad (déchiffre les valeurs ; on ne compare que l'hôte de `NEXT_PUBLIC_SUPABASE_URL` à `upxoxrjumxpzumakawiv`), ou qu'il le vérifie au dashboard.
- [ ] **f.** Présenter le **rapport de risque** : résultats e2e (dont flaky), impact prod, actions prod à valider, tests manuels restants. **L'utilisateur décide de la suite.**

---

## Annexe A — Actions prod, à soumettre avant exécution (ordre exact)

Aucune n'est exécutée sans accord explicite.

1. **CI verte sur la PR** (prérequis).
2. **Activer OAuth Server + DCR en prod**, juste avant le merge : `node scripts/configurer-oauth-supabase.mjs gabyhlcwahzquolwxmgd --appliquer --prod-valide`, puis relecture et `curl` de la découverte prod. Sans effet visible tant que le code n'est pas déployé (personne n'appelle encore l'URL d'autorisation).
3. **Vérifier la redirection** : un `authorize` de test sur prod doit rediriger vers `https://webapp-repas.vercel.app/oauth/consent?authorization_id=…` sans double slash. Sinon : corriger `site_url` (retirer le slash final) ou le chemin, sur décision de l'utilisateur.
4. **Merge** (`gh pr merge`), seulement CI verte.
5. **Après déploiement Vercel** : `curl -i -X POST https://webapp-repas.vercel.app/api/mcp` → `401` ; `GET /.well-known/oauth-protected-resource/api/mcp` → metadata prod ; `/profil` affiche « Aucun assistant connecté. ».
6. **Décision séparée** (hors merge) : provisionner Upstash sur Vercel Production (`UPSTASH_REDIS_REST_URL` / `_TOKEN`), sans quoi `limiteMcp` et `limiteGeneration` restent NO-OP (RG-78, ADR-10 F-04).
7. **Rollback** : désactiver OAuth Server (`PATCH oauth_server_enabled: false`) coupe tout nouvel accès ; revert du merge si besoin. Aucune donnée à restaurer (pas de migration).

## Annexe B — Tests de connexion réelle : URL publique et étapes utilisateur

**URL recommandée avant merge : l'alias de branche du preview Vercel, branché sur staging** : `https://webapp-repas-git-feat-305-oauth-mcp-lecture-ouro84s-projects.vercel.app/api/mcp` (alias exact à relever dans le déploiement). Deux obstacles, levés temporairement et à remettre ensuite :
- **Vercel Authentication** protège les previews : un client MCP ne peut pas la franchir (ni la metadata, ni `/api/mcp`). → la désactiver pendant la fenêtre de test (Settings → Deployment Protection → Vercel Authentication : Disabled), puis la réactiver.
- **Le `site_url` staging vaut `http://localhost:3000`** : le consentement serait servi en local. → le passer temporairement à l'alias de preview (`PATCH site_url`, via le script ou au dashboard), puis le **remettre à `http://localhost:3000`** avant tout push ou relance de CI (sinon l'e2e `oauth-mcp` échoue).

Alternative : tester en prod après merge (aucun réglage temporaire, mais le premier test réel se fait en prod).

**Étapes pour l'utilisateur, dans l'ordre :**
1. Confirmer que les previews pointent staging (Task 12 e).
2. Désactiver Vercel Authentication sur les previews ; je bascule `site_url` staging sur l'alias de preview (avec ton accord).
3. Te connecter à OMQ sur l'alias de preview avec un compte staging (le compte e2e partagé ou un compte créé sur le preview).
4. **Claude Code** : `claude mcp add --transport http omq <URL>/api/mcp`, puis `/mcp` → login → consentement → demander « qu'est-ce qu'on mange demain soir ? ».
5. **Claude.ai** : Paramètres → Connecteurs → Ajouter un connecteur personnalisé → `<URL>/api/mcp` → Connecter → consentement → poser les trois questions d'US-51.
6. **Cursor** : `~/.cursor/mcp.json` → `{ "mcpServers": { "omq": { "url": "<URL>/api/mcp" } } }` → Connect → consentement → question.
7. **OpenCode** : `opencode.json` → `"mcp": { "omq": { "type": "remote", "url": "<URL>/api/mcp" } }` → `opencode mcp auth omq` → consentement → question.
8. **Hermes (Docker sur NAS)** : publier le port 27890 du conteneur en `127.0.0.1:27890`, ajouter le serveur `omq` (`<URL>/api/mcp`) à la config MCP de Hermes, ouvrir `ssh -L 27890:127.0.0.1:27890 nas` depuis le PC, lancer `docker exec -it hermes hermes mcp login omq`, ouvrir l'URL affichée dans le navigateur du PC, autoriser, puis tester depuis WhatsApp/Telegram. Échec → noter le message ; repli Bearer statique seulement à ce stade (ADR-11).
9. **ChatGPT (best effort)** : mode développeur → connecteur MCP `<URL>/api/mcp`. S'il bloque sur `aud`, ouvrir une issue de suivi.
10. **Révocation** : dans `/profil`, déconnecter un assistant ; vérifier qu'il échoue au plus tard 1 h après (expiration du jeton d'accès) et qu'il doit redemander l'autorisation.
11. **Remise en état** : je remets `site_url` staging à `http://localhost:3000` ; tu réactives Vercel Authentication.
