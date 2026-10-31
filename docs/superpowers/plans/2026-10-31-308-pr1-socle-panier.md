# #308 PR1 — Socle OMQ du panier Chronodrive : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OMQ sait enregistrer un exécuteur, créer une demande de panier, réveiller l'exécuteur par un webhook signé sans donnée, lui remettre la demande et recevoir son rapport via le MCP. Sans UI : PR2 posera le bouton.

**Architecture:** Tout l'état vit dans deux tables scopées foyer, manipulées **uniquement** par des RPC `SECURITY DEFINER`. La RPC de création lit le secret dans Supabase Vault et **signe le webhook dans Postgres** : elle renvoie URL, en-têtes et corps, jamais le secret. La route Next n'a donc ni secret ni `service_role`, elle transmet tel quel. L'expiration est paresseuse : chaque RPC du cycle de vie expire d'abord les demandes périmées du foyer. Le MCP expose `prendre_demande_panier` et `rapporter_panier` en composant ces RPC sous le JWT de l'utilisateur (RG-71).

**Tech Stack:** Supabase (Postgres, Vault 0.3.1, `pgcrypto`), Next.js 16 route handler, `mcp-handler` + `@modelcontextprotocol/server`, zod, Vitest, Playwright (staging).

**Spec:** `SPECS_FONCTIONNELLES.md` US-53, RG-80→84, §5.8 ; `ADR.md` ADR-12 (précisions du 2026-10-31) ; issue #308, section « Découpage et décisions ». Règles : `.claude/rules/supabase.md`, `mcp.md`, `chronodrive.md`.

**Branche :** `feat/308-socle-panier`, depuis `main` après merge de `docs/308-decisions`.

## Global Constraints

- Identifiants, commentaires et messages en français ; les commentaires citent les RG.
- OMQ n'appelle jamais l'enseigne et ne stocke aucun identifiant d'enseigne (RG-80).
- Corps du webhook exactement `{"evenement":"demande_panier"}` (RG-81).
- Signature Standard Webhooks : `webhook-id` = `msg_<uuid>`, `webhook-timestamp` = secondes Unix, `webhook-signature` = `v1,<base64 HMAC-SHA256 de "<id>.<timestamp>.<corps>">`. Secret `whsec_<base64>` → clé = base64 décodé ; sinon secret brut en UTF-8 (`integrations/chronodrive-mcp/spike/envoyer-webhook.mjs`).
- Expirations : `en_attente` > **5 min** → `echec`, cause `non_prise` ; `en_cours` > **30 min** → `echec`, cause `delai_depasse` (RG-83).
- Envoi du webhook : délai **10 s**, aucune nouvelle tentative ; échec → `echec`, cause `injoignable` (RG-81).
- Rapport : ni identifiant de produit ni prix ; `a_choisir[].candidats` 3 au plus (RG-84).
- Nouvelle RPC : `revoke execute … from public` **et** `from anon`, puis `grant … to authenticated`, ou `to service_role` pour l'enregistrement de l'exécuteur (`supabase.md`).
- `set search_path = public, extensions` dans toute fonction qui appelle `hmac`, `gen_random_uuid` ou Vault, et `vault` en plus pour celles qui lisent Vault.
- Jamais de `service_role` côté app pour ce flux. Le client par jeton (`creerClientParJeton`) sert aux outils MCP, le client à cookies (`createClient` de `lib/supabase/server`) à la route.
- **Décision de ce plan, à signaler à la revue :** une demande vise **toujours le cycle courant** (`ancreParDefaut(aujourdhuiParis(), jour_courses)`), et la route ne lit pas de corps. Pourquoi : `cocher_article` et `lire_liste_courses` n'agissent que sur le cycle courant tant que RG-85 (#320) n'a pas ajouté `ancre`. Une demande sur un autre cycle ne pourrait être ni lue ni cochée par l'exécuteur. PR2 n'affiche le bouton que sur le cycle courant.

## Review Focus

1. **Deux clics simultanés** (deux membres du foyer, ou double tap) → une seule demande créée, l'autre reçoit 409. Garanti par l'index unique partiel, pas par un `select` préalable. Test : Task 4, `deux créations concurrentes`.
2. **Secret `whsec_` contre secret brut** → la signature Postgres doit être identique à celle de Node pour les deux formes, sinon Hermes rejette tout en 401. Test : Task 1, vérification SQL des deux vecteurs ; Task 4, signature vérifiée par le récepteur.
3. **Rapport arrivé après l'expiration, alors qu'une nouvelle demande existe** → refusé (`OMQ03`) ; sans demande plus récente → accepté, `terminee`, `rapport_tardif = true`. Test : Task 4, `rapport tardif`.
4. **Exécuteur qui répond lentement (> 10 s) ou en 500** → la demande passe `echec` / `injoignable` et une nouvelle demande est aussitôt possible. Test : Task 2 (délai simulé) et Task 4 (récepteur qui répond 500).
5. **Membre d'un autre foyer** → ne voit ni ne prend ni ne rapporte la demande d'un foyer qui n'est pas le sien. `prendre` renvoie `null`, `rapporter` lève `OMQ03`. Test : Task 4, `isolation foyer`.

---

### Task 1 : migration (tables, Vault, RPC)

**Files:**
- Create: `supabase/migrations/20261031120000_demande_panier.sql`

**Interfaces:**
- Produces (SQL, schéma `public`) :
  - `executeur_panier (id uuid pk default gen_random_uuid(), foyer_id uuid not null references foyers(id) on delete cascade, enseigne text not null default 'chronodrive' check (enseigne = 'chronodrive'), url_webhook text not null check (url_webhook ~ '^https?://'), secret_id uuid not null, cree_le timestamptz not null default now(), unique (foyer_id, enseigne))`. RLS activée, **aucune policy** : l'existence de l'exécuteur se lit seulement via `etat_panier()`.
  - `demande_panier (id uuid pk default gen_random_uuid(), foyer_id uuid not null references foyers(id) on delete cascade, ancre date not null, statut text not null default 'en_attente' check (statut in ('en_attente','en_cours','terminee','echec')), cause_echec text check (cause_echec in ('injoignable','non_prise','delai_depasse','executeur')), motif_echec text, rapport jsonb, rapport_tardif boolean not null default false, cree_le timestamptz not null default now(), pris_le timestamptz, termine_le timestamptz)`. Index unique partiel `(foyer_id) where statut in ('en_attente','en_cours')`, index `(foyer_id, cree_le desc)`. RLS : policy select `foyer_id = mon_foyer()` seulement.
  - Trigger `after delete on executeur_panier` → `delete from vault.secrets where id = old.secret_id`. La cascade foyer le déclenche aussi.
  - `expirer_demandes_panier(p_foyer uuid) returns void` : helper interne, `execute` retiré à `public`, `anon` et `authenticated`.
  - `enregistrer_executeur_panier(p_foyer uuid, p_url text, p_secret text) returns uuid` : `grant` à `service_role` seulement. Crée le secret par `vault.create_secret`, ou le remplace par `vault.update_secret` s'il existe, car le `name` Vault est unique. Upsert sur `(foyer_id, 'chronodrive')`.
  - `etat_panier() returns jsonb` → `{"executeur": bool, "derniere": null | {id, ancre, statut, cause_echec, motif_echec, rapport, rapport_tardif, cree_le, pris_le, termine_le}}`, après expiration.
  - `creer_demande_panier(p_ancre date) returns jsonb` → `{"demande_id", "url", "entetes": {"webhook-id","webhook-timestamp","webhook-signature"}, "corps"}`. Erreurs : `OMQ01` aucun exécuteur, `OMQ02` demande déjà active (y compris la violation de l'index unique, rattrapée en `unique_violation`).
  - `echouer_envoi_demande_panier(p_demande uuid, p_motif text) returns void` : seulement une demande `en_attente` du foyer → `echec` / `injoignable`. No-op sinon.
  - `prendre_demande_panier() returns jsonb` → `null` ou `{"id","ancre"}`. Elle prend la plus ancienne `en_attente` du foyer et la passe `en_cours`, `pris_le = now()`.
  - `rapporter_panier(p_demande uuid, p_statut text, p_rapport jsonb, p_motif text) returns jsonb` → `{"statut","rapport_tardif"}`. Elle accepte une demande `en_cours`, ou une demande `echec` / `delai_depasse` du foyer sans demande plus récente : cette dernière devient `terminee` (ou reste `echec`) avec `rapport_tardif = true`. `p_statut = 'echec'` → `cause_echec = 'executeur'`, `motif_echec = p_motif`. Sinon `OMQ03`.
  - Codes d'erreur : `raise exception '<message français>' using errcode = 'OMQ0x'`.

- [ ] **Step 1 : écrire la migration.** En-tête de commentaire selon la convention des migrations récentes : quoi, pourquoi, RG. Le foyer vient toujours de `mon_foyer()` ; `null` → exception. Signature dans `creer_demande_panier` :

```sql
v_id := 'msg_' || gen_random_uuid();
v_ts := extract(epoch from now())::bigint::text;
v_corps := '{"evenement":"demande_panier"}';
v_cle := case when v_secret like 'whsec\_%'
              then decode(substr(v_secret, 7), 'base64')
              else convert_to(v_secret, 'UTF8') end;
v_sig := 'v1,' || encode(hmac(convert_to(v_id || '.' || v_ts || '.' || v_corps, 'UTF8'), v_cle, 'sha256'), 'base64');
```

`v_secret` vient de `vault.decrypted_secrets where id = secret_id`. Le corps est renvoyé tel quel (texte) : la route ne le resérialise pas.

- [ ] **Step 2 : appliquer sur staging.** Par un script Node ponctuel (dans le scratchpad, pas dans le dépôt) qui lit le fichier, l'envoie à `/v1/projects/upxoxrjumxpzumakawiv/database/query`, puis inscrit `(version '20261031120000', name 'demande_panier', statements)` dans `supabase_migrations.schema_migrations` (`supabase.md`, « Sans CI »).
Attendu : HTTP 201, aucune erreur.

- [ ] **Step 3 : vérifier la signature contre Node, sur staging, en transaction annulée.** Dans `begin; … rollback;`, appeler `enregistrer_executeur_panier` pour un foyer existant, avec le secret `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`, puis avec `secret-brut`. Pour chacun, impersonner un membre (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid membre>","role":"authenticated"}'`), puis appeler `creer_demande_panier(current_date)`. Recalculer en Node la signature des `webhook-id`/`webhook-timestamp` renvoyés avec l'algorithme de `envoyer-webhook.mjs`.
Attendu : les deux signatures sont identiques à celles de Node ; un second `creer_demande_panier` lève `OMQ02`.

- [ ] **Step 4 : commit**

```bash
git add supabase/migrations/20261031120000_demande_panier.sql
git commit -m "feat: tables et RPC des demandes de panier, signature Vault (#308)"
```

### Task 2 : `lib/panier.ts` (envoi du webhook, schéma du rapport)

**Files:**
- Create: `lib/panier.ts`
- Test: `lib/panier.test.ts`

**Interfaces:**
- Consumes : forme renvoyée par `creer_demande_panier` (Task 1).
- Produces :
  - `type EnvoiWebhook = { demande_id: string; url: string; entetes: Record<string, string>; corps: string }`
  - `const DELAI_WEBHOOK_MS = 10_000`
  - `envoyerWebhook(envoi: EnvoiWebhook, options?: { fetch?: typeof fetch; delaiMs?: number }): Promise<{ ok: true } | { ok: false; motif: string }>` : POST `content-type: application/json` + `entetes`, corps tel quel, `AbortSignal.timeout(delaiMs)`. `ok` seulement pour un 2xx. Ne lève jamais.
  - `schemaRapport` (zod) et `type RapportPanier = { ajoutes: { article: string; produit: string; marque: string; quantite: number }[]; a_choisir: { article: string; raison: string; candidats: string[] }[]; introuvables: { article: string }[] }`. Contraintes : `candidats` `max(3)`, chaînes `min(1).max(200)`, `quantite` entier ≥ 1, `strict()` sur chaque objet (un `productId` ou un `prix` en trop est refusé).
  - `MESSAGES_PANIER: Record<'OMQ01' | 'OMQ02' | 'OMQ03', string>` : messages français, réutilisés par la route et le MCP.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
it("envoie corps et en-têtes tels quels", …)        // fetch mocké : body === envoi.corps, headers ⊇ entetes
it("2xx → ok", …)                                     // 202 → { ok: true }
it("non 2xx → échec avec le statut dans le motif", …) // 500 → { ok: false, motif: expect.stringContaining("500") }
it("délai dépassé → échec sans lever", …)              // fetch qui n'aboutit jamais, delaiMs: 20 → ok false
it("erreur réseau → échec sans lever", …)              // fetch qui rejette → ok false
it("schemaRapport refuse productId et prix", …)       // ajoutes[0] avec productId → success false
it("schemaRapport refuse 4 candidats", …)
```

- [ ] **Step 2 :** `npx vitest run lib/panier.test.ts` → FAIL (module absent).
- [ ] **Step 3 : implémenter `lib/panier.ts`.**
- [ ] **Step 4 :** `npx vitest run lib/panier.test.ts` → PASS.
- [ ] **Step 5 : commit** `feat: envoi du webhook d'exécuteur et schéma du rapport de panier (#308)`.

### Task 3 : route `POST /api/panier/demande` et rate-limit

**Files:**
- Create: `app/api/panier/demande/route.ts`
- Test: `app/api/panier/demande/route.test.ts`
- Modify: `lib/rate-limit.ts` (ajout de `limitePanier`)

**Interfaces:**
- Consumes : `envoyerWebhook`, `MESSAGES_PANIER` (Task 2) ; RPC `creer_demande_panier`, `echouer_envoi_demande_panier` (Task 1) ; `chargerJourCoursesFoyer(supabase)` (`lib/foyer`), `ancreParDefaut` (`lib/cycles`), `aujourdhuiParis` (`lib/semaines`), `apiError` (`lib/errors`).
- Produces :
  - `limitePanier(identifiant: string): Promise<{ autorise: boolean }>`, préfixe `rl:panier`, **5 requêtes / 60 s**, mêmes règles no-op et fail-open.
  - Réponses : `202 { demande_id }` ; `401` non connecté ; `429` ; `409 { error }` pour `OMQ01` et `OMQ02` ; `502 { error: "Ton exécuteur est injoignable : vérifie qu'il est allumé, puis réessaie." }` après `echouer_envoi_demande_panier(demande_id, motif)` ; `500` sinon.
  - Pas de corps lu : ancre = `ancreParDefaut(aujourdhuiParis(), jourCourses)`.

- [ ] **Step 1 : écrire les tests qui échouent**, sur le modèle de `app/api/planning/generer/route.test.ts` (clients mockés) :

```ts
it("401 sans session")
it("429 quand limitePanier refuse")
it("crée la demande sur l'ancre du cycle courant et envoie le webhook → 202")   // rpc appelée avec { p_ancre: <ancreParDefaut> }
it("409 avec le message OMQ01 si aucun exécuteur")
it("409 avec le message OMQ02 si une demande est active")
it("webhook en échec → echouer_envoi_demande_panier puis 502")                 // rpc echouer appelée avec demande_id et motif
```

- [ ] **Step 2 :** `npx vitest run app/api/panier/demande/route.test.ts` → FAIL.
- [ ] **Step 3 : implémenter la route et `limitePanier`.** Commentaire d'en-tête : adaptateur HTTP, RG-81, pas de `service_role`.
- [ ] **Step 4 :** `npx vitest run app/api/panier lib/rate-limit` → PASS.
- [ ] **Step 5 : commit** `feat: route de demande de panier, webhook signé vers l'exécuteur (#308)`.

### Task 4 : outils MCP `prendre_demande_panier` et `rapporter_panier`

**Files:**
- Create: `lib/mcp/panier.ts`
- Test: `lib/mcp/panier.test.ts`
- Modify: `lib/mcp/serveur.ts` (enregistrement dans `enregistrerOutilsEcriture`)
- Modify: `app/api/mcp/route.test.ts` (les deux outils listés et appelables)

**Interfaces:**
- Consumes : RPC `prendre_demande_panier`, `rapporter_panier` (Task 1) ; `schemaRapport`, `MESSAGES_PANIER` (Task 2) ; `ErreurOutil`.
- Produces :
  - `prendreDemandePanier(supabase: ClientSupabase): Promise<{ demande: { id: string; ancre: string } | null }>`
  - `rapporterPanier(supabase: ClientSupabase, args: { demande_id: string; statut: "terminee" | "echec"; motif?: string } & RapportPanier): Promise<{ statut: "terminee" | "echec"; rapport_tardif: boolean }>` : `statut: "echec"` sans `motif` → `ErreurOutil` ; `OMQ03` → `ErreurOutil(MESSAGES_PANIER.OMQ03)`.
  - Outils : `inputSchema` de `rapporter_panier` = `schemaRapport` étendu de `demande_id` (uuid), `statut`, `motif`. Les descriptions disent :
    - pour `prendre_demande_panier` : à appeler au réveil ; `demande: null` → s'arrêter sans rien faire ; `ancre` = cycle à traiter, celui que lit `lire_liste_courses` ;
    - pour `rapporter_panier` : une fois en fin de run ; ni identifiant ni prix ; 3 candidats au plus ; cocher chaque article juste après son ajout, avant de rapporter (RG-83).

- [ ] **Step 1 : écrire les tests unitaires qui échouent** (client mocké, comme `lib/mcp/ecriture-courses.test.ts`) :

```ts
it("prendre : null → { demande: null }")
it("prendre : renvoie id et ancre")
it("rapporter : transmet statut, rapport et motif à la RPC")
it("rapporter : echec sans motif → ErreurOutil")
it("rapporter : OMQ03 → ErreurOutil avec MESSAGES_PANIER.OMQ03")
```

- [ ] **Step 2 :** `npx vitest run lib/mcp/panier.test.ts` → FAIL.
- [ ] **Step 3 : implémenter `lib/mcp/panier.ts` et enregistrer les outils.**
- [ ] **Step 4 :** `npx vitest run lib/mcp app/api/mcp` → PASS.
- [ ] **Step 5 : écrire l'e2e `e2e/panier-demande.spec.ts`** (comptes jetables ; l'ajouter à `SPECS_JETABLE` dans `playwright.config.ts`).
  - Préparation : récepteur HTTP Node sur `127.0.0.1:<port libre>`, qui note chaque requête et répond selon un mode réglable (202 ou 500).
  - Exécuteur enregistré par `enregistrer_executeur_panier` via REST avec `SUPABASE_SERVICE_ROLE_KEY` (`lireEnvLocal`), secret `whsec_…` connu du test.
  - Retour en arrière dans le temps : `update demande_panier set cree_le/pris_le = now() - interval …` en `service_role`, via un helper `vieillirDemandePanier(id, champ, minutes)` dans `e2e/helpers.ts`.

```ts
test("clic → webhook signé reçu, corps sans donnée")     // POST /api/panier/demande via page.request → 202 ; récepteur : corps === '{"evenement":"demande_panier"}', signature vérifiée en Node avec le secret
test("deux créations concurrentes → une 202, une 409")   // Promise.all de deux POST
test("prendre puis rapporter → terminee, rapport lu par etat_panier")
test("prendre sans demande → { demande: null }")
test("exécuteur en 500 → 502, demande echec/injoignable, nouvelle demande possible")
test("en_attente vieillie de 6 min → echec/non_prise à la lecture")
test("rapport tardif : accepté sans demande plus récente, refusé après une nouvelle demande")
test("isolation foyer : un autre compte ne prend ni ne rapporte la demande")
```

- [ ] **Step 6 :** `npm run test:e2e:staging -- e2e/panier-demande.spec.ts` → PASS ; puis `npm run test:e2e:staging -- e2e/panier-demande.spec.ts e2e/mcp-ecriture.spec.ts e2e/oauth-mcp.spec.ts --retries=2` → PASS.
- [ ] **Step 7 : commit** `feat: outils MCP prendre_demande_panier et rapporter_panier (#308)`.

### Task 5 : règles, specs, changelog, PR

**Files:**
- Modify: `.claude/rules/chronodrive.md`, `.claude/rules/mcp.md`, `.claude/rules/supabase.md`, `.claude/rules/e2e.md`
- Modify: `SPECS_FONCTIONNELLES.md` §5.8 (colonnes réelles `cause_echec`, `rapport_tardif`), `ADR.md` (structure de dossiers : `app/api/panier/`, `lib/panier.ts`, `lib/mcp/panier.ts`)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1 : compléter les règles**, une entrée = la règle + une ligne de « pourquoi » :
  - `supabase.md` : les tables panier sont en `on delete cascade` (exception à la checklist FK : rien à recréer dans `rejoindre_foyer`, `quitter_foyer` ou `supprimer_mon_compte`, et rien n'est cloné à la sortie : l'exécuteur appartient à l'installation, pas à la personne) ; codes d'erreur `OMQ0x` ; Vault (`name` unique, trigger de nettoyage) ;
  - `mcp.md` : les deux outils et leurs contrats ;
  - `chronodrive.md` : enregistrement de l'exécuteur par `select enregistrer_executeur_panier(...)` en `service_role` ; demande toujours sur le cycle courant ;
  - `e2e.md` : récepteur webhook local et `vieillirDemandePanier`.
- [ ] **Step 2 : mettre à jour specs, ADR et `CHANGELOG.md`.**
- [ ] **Step 3 : vérifications finales.** `npm run test:run`, `npx tsc --noEmit`, `npm run lint` → tout vert.
- [ ] **Step 4 : commit** `docs: règles et changelog du socle panier (#308)`, puis `graphify update .`.
- [ ] **Step 5 : pousser et ouvrir la PR** (corps via la skill `mattpocock-skills:pr`, lien vers #308), puis `gh pr checks <n> --watch`. Merge seulement sur CI verte.
