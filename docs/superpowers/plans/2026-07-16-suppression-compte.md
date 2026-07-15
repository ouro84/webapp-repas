# Suppression de compte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un utilisateur de supprimer réellement son compte (auth + données), en préservant intégralement les données des autres membres d'un foyer partagé.

**Architecture:** RPC Postgres `SECURITY DEFINER` `supprimer_mon_compte()` (purge/réattribution SQL scopée foyer) appelée par une route serveur Next.js, qui enchaîne `admin.auth.admin.deleteUser()` via un client `service_role` dédié serveur-only. UI : nouvelle section « Zone dangereuse » sur `/profil` (ré-authentification + confirmation forte), nouvelle page publique `/compte-supprime`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Auth), `@supabase/supabase-js` (client admin), Playwright (e2e).

## Global Constraints

- Français partout (noms de fonctions/variables/commentaires/UI), cf. CLAUDE.md.
- TypeScript strict — pas de contournement de type.
- Aucun `try/catch` vide — toute erreur est loguée ou affichée.
- **Pas de TDD unitaire pour ce plan** : la logique vit dans une RPC SQL et une route serveur, aucune fonction pure isolable côté `lib/`. Vérification par (a) e2e réels sur comptes jetables (staging), (b) vérification SQL manuelle en transaction `rollback` — même approche que l'offboarding foyer (#56 PR6), qui est le précédent le plus proche de cette feature.
- `SUPABASE_SERVICE_ROLE_KEY` **jamais** importé par un fichier `"use client"` ni par un composant — uniquement par `lib/supabase/admin.ts`, lui-même importé uniquement par `app/api/compte/supprimer/route.ts`.
- Toute migration est appliquée sur **staging** (`upxoxrjumxpzumakawiv`) via `scripts/query-supabase.mjs` avant les e2e, jamais directement en prod hors du pipeline CI (`migrate-prod` au merge sur `main`).
- `npm run test:e2e:staging` obligatoire avant PR (règle CLAUDE.md — la feature touche UI, RLS/RPC, persistance).
- Secrets déjà en place (fait le 2026-07-15) : `SUPABASE_SERVICE_ROLE_KEY` sur Vercel (Production), `STAGING_SUPABASE_SERVICE_ROLE_KEY` dans les coffres GitHub Actions et Dependabot — aucune action secrets à prévoir dans ce plan.
- Spec de référence : `docs/superpowers/specs/2026-07-15-suppression-compte-design.md`.

---

### Task 1: Migration — RPC `supprimer_mon_compte()`

**Files:**
- Create: `supabase/migrations/20260716090000_suppression_compte.sql`

**Interfaces:**
- Produces: fonction Postgres `supprimer_mon_compte()` (RPC, aucun paramètre, `void`), appelable via `supabase.rpc("supprimer_mon_compte")` — nom exact réutilisé par la Task 3.

- [ ] **Step 1: Écrire la migration**

```sql
-- Migration — suppression de compte, droit à l'effacement RGPD (#237, US-31).
-- Date : 2026-07-16
--
-- RPC SECURITY DEFINER, même famille que quitter_foyer()/rejoindre_foyer()
-- (#56). Purge/réattribue les données AVANT que la route serveur
-- (app/api/compte/supprimer) n'appelle admin.auth.admin.deleteUser() via un
-- client service_role.
--
-- ⚠️ Piège vérifié sur staging (upxoxrjumxpzumakawiv, 2026-07-15) :
-- recette.user_id → auth.users(id) porte ON DELETE CASCADE. Appeler
-- deleteUser() AVANT cette RPC, pour un membre de foyer PARTAGÉ, détruirait en
-- cascade les recettes qu'il a créées — pas seulement pour lui, pour TOUT le
-- foyer. D'où la réattribution user_id=NULL en amont (branche partagée
-- ci-dessous), foyer_id inchangé (la visibilité ne dépend que de foyer_id
-- depuis #56).
--
-- profiles.foyer_id → foyers(id) porte ON DELETE RESTRICT : en solo, la ligne
-- profiles doit être supprimée AVANT la ligne foyers, pas l'inverse.
--
-- reglages (réglages de génération PAR UTILISATEUR, #45) n'a AUCUNE action à
-- prévoir ici : reglages.user_id → auth.users porte déjà ON DELETE CASCADE,
-- qui s'exécute correctement telle quelle dans les deux branches.
--
-- Idempotente : chaque étape est un DELETE/UPDATE conditionnel sur
-- mon_foyer()/auth.uid() — rejouer après un succès partiel ne trouve plus rien
-- à purger côté foyer.

create or replace function supprimer_mon_compte()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_membres int;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  select count(*) into v_membres from profiles where foyer_id = v_foyer;

  if v_membres <= 1 then
    -- ----- Solo : purge intégrale du foyer -----------------------------------
    delete from etat_courses_article where foyer_id = v_foyer;
    delete from article_manuel where foyer_id = v_foyer;
    delete from cycle_courses where foyer_id = v_foyer;
    delete from recette_preference where foyer_id = v_foyer;
    delete from recette_masquee where foyer_id = v_foyer;
    delete from planning where foyer_id = v_foyer; -- cascade planning_slot
    delete from recette where foyer_id = v_foyer;  -- cascade recette_ingredient
    delete from profiles where user_id = auth.uid();
    delete from foyers where id = v_foyer;
  else
    -- ----- Partagé : détache le partant, préserve le foyer -------------------
    update recette set user_id = null
      where foyer_id = v_foyer and user_id = auth.uid();
    delete from profiles where user_id = auth.uid();
  end if;
end;
$$;

revoke execute on function supprimer_mon_compte() from public;
grant execute on function supprimer_mon_compte() to authenticated;
```

- [ ] **Step 2: Appliquer sur staging**

```bash
export $(grep SUPABASE_ACCESS_TOKEN .env.local | xargs)
node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "$(cat supabase/migrations/20260716090000_suppression_compte.sql)"
node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "insert into supabase_migrations.schema_migrations (version, name, statements) values ('20260716090000', 'suppression_compte', array['-- applied out-of-band via query-supabase.mjs']) on conflict do nothing"
```

Demander confirmation à l'utilisateur avant chacune de ces deux commandes (pattern établi cette session — modification de ressource partagée staging).

- [ ] **Step 3: Vérifier**

```bash
node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "select proname from pg_proc where proname='supprimer_mon_compte'"
```

Expected: une ligne `{"proname": "supprimer_mon_compte"}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716090000_suppression_compte.sql
git commit -m "feat: RPC supprimer_mon_compte (#237, US-31)"
```

---

### Task 2: Client admin (`service_role`)

**Files:**
- Create: `lib/supabase/admin.ts`

**Interfaces:**
- Produces: `createAdminClient(): SupabaseClient` — lève une `Error` explicite si `SUPABASE_SERVICE_ROLE_KEY` est absente. Consommé par la Task 3 uniquement.

- [ ] **Step 1: Écrire le client**

```ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// Client Supabase ADMIN (service_role) — SERVEUR UNIQUEMENT (#237). Ne jamais
// importer depuis un fichier "use client" : la clé donne un accès complet,
// contournant toute RLS. Utilisé uniquement par
// app/api/compte/supprimer/route.ts pour admin.auth.admin.deleteUser().
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquante : impossible de supprimer un compte."
    )
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
```

- [ ] **Step 2: Vérifier le typecheck**

```bash
npx tsc --noEmit
```

Expected: aucune sortie (0 erreur).

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/admin.ts
git commit -m "feat: client Supabase admin service_role (#237)"
```

---

### Task 3: Route serveur `POST /api/compte/supprimer`

**Files:**
- Create: `app/api/compte/supprimer/route.ts`

**Interfaces:**
- Consomme : `createClient` de `@/lib/supabase/server` (session), `createAdminClient` de `@/lib/supabase/admin` (Task 2), `apiError` de `@/lib/errors` (existant), RPC `supprimer_mon_compte` (Task 1).
- Produces : `POST` renvoyant `{ ok: true }` (200) en succès, `{ error: string }` (401/500) sinon — format consommé par `parseApiError` (existant) côté client (Task 4).

- [ ] **Step 1: Écrire la route**

```ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiError } from "@/lib/errors"

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return apiError(
      "POST /api/compte/supprimer",
      authError,
      "Tu dois être connecté pour supprimer ton compte.",
      401
    )
  }

  const { error: erreurRpc } = await supabase.rpc("supprimer_mon_compte")
  if (erreurRpc) {
    return apiError(
      "POST /api/compte/supprimer",
      erreurRpc,
      "Suppression des données impossible. Réessaie dans quelques instants.",
      500
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (erreur) {
    return apiError(
      "POST /api/compte/supprimer",
      erreur,
      "Suppression indisponible pour l'instant. Réessaie plus tard ou contacte-nous.",
      500
    )
  }

  const { error: erreurDelete } = await admin.auth.admin.deleteUser(user.id)
  if (erreurDelete) {
    return apiError(
      "POST /api/compte/supprimer",
      erreurDelete,
      "Tes données ont été supprimées mais la fermeture du compte a échoué. Réessaie — l'opération est sûre à rejouer.",
      500
    )
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Vérifier typecheck + lint**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern ".understand-anything/**" app/api/compte/supprimer/route.ts lib/supabase/admin.ts
```

Expected: aucune sortie sur les deux commandes.

- [ ] **Step 3: Commit**

```bash
git add app/api/compte/supprimer/route.ts
git commit -m "feat: route de suppression de compte (#237)"
```

---

### Task 4: UI — section « Zone dangereuse » de `/profil`

**Files:**
- Create: `components/profil/supprimer-compte.tsx`
- Modify: `app/profil/page.tsx` (import + rendu, après le bloc de déconnexion existant)

**Interfaces:**
- Consomme : `createClient` de `@/lib/supabase/client`, `reinitialiserCacheFoyer` de `@/lib/sync` (existant), route `POST /api/compte/supprimer` (Task 3).
- Produces : composant `<SupprimerCompte />` sans props.

- [ ] **Step 1: Écrire le composant**

```tsx
"use client";

// Suppression de compte (#237, US-31) — droit à l'effacement RGPD. Section
// "Zone dangereuse" de /profil, même patron que ChangerMotDePasse : ré-auth
// par mot de passe + confirmation forte (saisie exacte de "SUPPRIMER"), pas de
// modale. Le mot "SUPPRIMER" est une confirmation UX — le contrôle de
// sécurité réel est la ré-authentification (RG design D6).

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reinitialiserCacheFoyer } from "@/lib/sync";

const MOT_CONFIRMATION = "SUPPRIMER";

export function SupprimerCompte() {
  const supabase = createClient();
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [suppression, setSuppression] = useState(false);

  const confirmationValide = confirmation === MOT_CONFIRMATION;

  async function soumettre(evenement: React.FormEvent): Promise<void> {
    evenement.preventDefault();
    setErreur(null);
    if (!confirmationValide) return;

    setSuppression(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) {
        setErreur("Session expirée. Reconnecte-toi pour supprimer ton compte.");
        return;
      }

      const { error: erreurAuth } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: motDePasse,
      });
      if (erreurAuth) {
        setErreur("Mot de passe incorrect.");
        return;
      }

      const reponse = await fetch("/api/compte/supprimer", { method: "POST" });
      if (!reponse.ok) {
        const corps = await reponse.json().catch(() => null);
        setErreur(corps?.error ?? "Suppression impossible. Réessaie dans quelques instants.");
        return;
      }

      reinitialiserCacheFoyer();
      await supabase.auth.signOut({ scope: "local" });
      window.location.assign("/compte-supprime");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setSuppression(false);
    }
  }

  return (
    <section className="mb-8" aria-labelledby="section-zone-dangereuse">
      <h2 id="section-zone-dangereuse" className="mb-4 text-lg font-semibold text-brand-900">
        Zone dangereuse
      </h2>
      <form onSubmit={soumettre} className="flex max-w-sm flex-col gap-4" noValidate>
        <p className="text-sm text-brand-700/85">
          Cette action supprime définitivement ton compte et tes données. Elle est irréversible.
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="suppr-mdp" className="text-sm font-medium text-brand-900">
            Mot de passe
          </label>
          <input
            id="suppr-mdp"
            type="password"
            autoComplete="current-password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            required
            className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="suppr-confirmation" className="text-sm font-medium text-brand-900">
            Tape SUPPRIMER pour confirmer
          </label>
          <input
            id="suppr-confirmation"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          />
        </div>

        {erreur !== null && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {erreur}
          </p>
        )}

        <button
          type="submit"
          disabled={!confirmationValide || suppression}
          aria-busy={suppression}
          className="self-start rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {suppression ? "Suppression…" : "Supprimer mon compte"}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Intégrer dans `/profil`**

Dans `app/profil/page.tsx`, ajouter l'import (à côté des autres imports de composants profil) :

```tsx
import { SupprimerCompte } from "@/components/profil/supprimer-compte";
```

Puis remplacer (fin du fichier — c'est le tout dernier bloc avant `</main>`) :

```tsx
      <div className="mt-8 border-t border-brand-100 pt-6">
        <button
          type="button"
          onClick={deconnecter}
          className="rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Se déconnecter
        </button>
      </div>
    </main>
  );
}
```

par :

```tsx
      <div className="mt-8 border-t border-brand-100 pt-6">
        <button
          type="button"
          onClick={deconnecter}
          className="rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Se déconnecter
        </button>
      </div>

      <div className="mt-8 border-t border-brand-100 pt-6">
        <SupprimerCompte />
      </div>
    </main>
  );
}
```

La suppression est l'action la plus sensible de la page : elle reste la toute dernière chose visible, après la déconnexion.

- [ ] **Step 3: Vérifier typecheck + lint**

```bash
npx tsc --noEmit
npx eslint --ignore-pattern ".understand-anything/**" components/profil/supprimer-compte.tsx app/profil/page.tsx
```

Expected: aucune sortie.

- [ ] **Step 4: Commit**

```bash
git add components/profil/supprimer-compte.tsx app/profil/page.tsx
git commit -m "feat: section Zone dangereuse sur /profil (#237)"
```

---

### Task 5: Page publique `/compte-supprime` + exemption proxy

**Files:**
- Create: `app/compte-supprime/page.tsx`
- Modify: `proxy.ts:84-84` (condition d'exemption de la garde d'onboarding)

**Interfaces:**
- Aucune (page statique, pas de props/état).

- [ ] **Step 1: Écrire la page**

```tsx
// Confirmation de suppression de compte (#237, US-31) — route PUBLIQUE,
// statique. Un compte qui vient d'être supprimé n'est plus authentifié :
// hors protectedRoutes ET hors garde d'onboarding du proxy (comme /legal/*,
// #235).

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Compte supprimé — On mange quoi ?",
};

export default function PageCompteSupprime() {
  return (
    <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center p-8 text-center">
      <h1 className="font-display text-2xl font-semibold text-brand-900">
        Ton compte a été supprimé
      </h1>
      <p className="mt-2 text-brand-700/85">
        Toutes tes données ont été effacées. Merci d&apos;avoir utilisé « On mange quoi ? ».
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
      >
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: Exempter la route dans `proxy.ts`**

Remplacer :

```ts
  if (
    user &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/legal")
  ) {
```

par :

```ts
  if (
    user &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/legal") &&
    !pathname.startsWith("/compte-supprime")
  ) {
```

- [ ] **Step 3: Build**

```bash
npx tsc --noEmit
npx next build
```

Expected: build réussi, `○ /compte-supprime` listée dans la sortie des routes statiques.

- [ ] **Step 4: Commit**

```bash
git add app/compte-supprime/page.tsx proxy.ts
git commit -m "feat: page publique /compte-supprime (#237)"
```

---

### Task 6: e2e réels (comptes jetables) — solo + foyer partagé

**Files:**
- Create: `e2e/suppression-compte.spec.ts`
- Modify: `playwright.config.ts:6` (ajouter au regex `SPECS_JETABLE`)

**Interfaces:**
- Consomme : `E2E_PASSWORD`, `lireEnvLocal`, `marquerOnboardingCompletDistant`, `fermerModaleDoublonsSiPresente` de `./helpers` (existants).

- [ ] **Step 1: Ajouter au regex des specs jetables**

Dans `playwright.config.ts` :

```ts
const SPECS_JETABLE = /(onboarding|acquisition|foyer-clonage|foyer-rg29|rgpd-signup|suppression-compte)\.spec\.ts$/;
```

- [ ] **Step 2: Écrire le test**

```ts
// Parcours #237 (US-31) — suppression de compte, droit à l'effacement RGPD.
//
// ⚠️ Crée des comptes JETABLES dédiés (emails uniques par run), disjoints du
// compte de test partagé. Contrairement aux autres specs jetables, les
// comptes ICI sont réellement supprimés en fin de test (c'est l'objet du
// test) — pas d'accumulation pour ceux-là.

import { test, expect, attacherGardeCrash } from "./fixtures";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import {
  E2E_PASSWORD,
  fermerModaleDoublonsSiPresente,
  lireEnvLocal,
  marquerOnboardingCompletDistant,
} from "./helpers";

const RUN = Date.now();
const CODE_RX = /^[A-HJ-NP-Z2-9]{8}$/;

async function inscrire(request: APIRequestContext, email: string): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const r = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  if (![200, 400, 422].includes(r.status())) {
    throw new Error(`Signup ${email} impossible : HTTP ${r.status()} — ${await r.text()}`);
  }
  await marquerOnboardingCompletDistant(request, email, E2E_PASSWORD);
}

async function connecter(
  context: BrowserContext,
  email: string,
  gardes?: { erreurs: string[] }[]
): Promise<Page> {
  const page = await context.newPage();
  gardes?.push(attacherGardeCrash(page));
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/planning");
  return page;
}

// Vérifie qu'un compte ne peut plus se reconnecter (compte réellement supprimé).
async function verifierCompteSupprime(
  request: APIRequestContext,
  email: string
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const r = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  expect(r.ok()).toBe(false);
}

async function supprimerCompte(page: Page): Promise<void> {
  await page.goto("/profil");
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel("Tape SUPPRIMER pour confirmer").fill("SUPPRIMER");
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await page.waitForURL("**/compte-supprime", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Ton compte a été supprimé" })).toBeVisible();
}

test("supprimer son compte en solo efface le compte et ses données (#237)", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const email = `suppr-solo-${RUN}@example.com`;
  await inscrire(request, email);

  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await connecter(contexte, email);
  await supprimerCompte(page);
  await contexte.close();

  await verifierCompteSupprime(request, email);
});

test("supprimer son compte en foyer partagé préserve les données des autres membres (#237)", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const emailX = `suppr-x-${RUN}@example.com`;
  const emailY = `suppr-y-${RUN}@example.com`;
  await inscrire(request, emailX);
  await inscrire(request, emailY);

  const vierge = { storageState: { cookies: [], origins: [] } };
  const ctxX = await browser.newContext(vierge);
  const ctxY = await browser.newContext(vierge);
  const gardes: { erreurs: string[] }[] = [];

  // --- X : génère un planning, invite ---
  const x = await connecter(ctxX, emailX, gardes);
  await x.getByRole("button", { name: "Générer mon planning" }).click();
  await expect(x.locator("main ul > li")).toHaveCount(7);
  await expect
    .poll(async () => x.evaluate(() => localStorage.getItem("planning_dirty")))
    .toBeNull();

  await x.goto("/profil");
  await x.getByRole("button", { name: "Inviter quelqu’un" }).click();
  await expect(x.getByText(CODE_RX)).toBeVisible();
  const code = (await x.getByText(CODE_RX).innerText()).trim();

  // --- Y : rejoint le foyer de X ---
  const y = await connecter(ctxY, emailY, gardes);
  await y.goto("/profil");
  await y.getByLabel("Rejoindre un foyer").fill(code);
  await y.getByRole("button", { name: "Rejoindre" }).click();
  await fermerModaleDoublonsSiPresente(y);
  await expect(y.getByRole("button", { name: "Quitter le foyer" })).toBeVisible();

  // --- Y : supprime son compte ---
  await supprimerCompte(y);
  await ctxY.close();
  await verifierCompteSupprime(request, emailY);

  // --- X : le foyer partagé et son planning sont intacts ---
  await x.reload();
  await x.goto("/planning");
  await expect(x.locator("main ul > li")).toHaveCount(7);

  await ctxX.close();
  const erreurs = gardes.flatMap((g) => g.erreurs);
  expect(erreurs, `Crash React détecté : ${erreurs.join(" | ")}`).toEqual([]);
});
```

- [ ] **Step 3: Lancer contre staging**

```bash
npm run test:e2e:staging -- suppression-compte.spec.ts --retries=2
```

Expected: `2 passed`. Si un sélecteur ne correspond pas exactement au rendu réel (ex. libellé de bouton), ajuster le test — pas l'implémentation — sauf si le comportement observé diverge du design (§7 de la spec).

- [ ] **Step 4: Commit**

```bash
git add e2e/suppression-compte.spec.ts playwright.config.ts
git commit -m "test: e2e suppression de compte, solo et foyer partagé (#237)"
```

---

### Task 7: Vérification SQL manuelle (transaction `rollback`)

Pas de fichier committé (même esprit que la vérification #56 PR6 — un contrôle ponctuel, pas un test automatisé). À exécuter une fois sur staging.

- [ ] **Step 1: Récupérer un `user_id` de test réel**

```bash
export $(grep SUPABASE_ACCESS_TOKEN .env.local | xargs)
node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "select id, email from auth.users where email = 'claude-e2e-p1@example.com'"
```

Noter l'`id` renvoyé (`<USER_ID>` ci-dessous).

- [ ] **Step 2: Vérifier la branche SOLO en transaction annulée**

Demander confirmation à l'utilisateur avant d'exécuter (accès élevé sur staging) :

```bash
node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "
begin;
set local role authenticated;
set local request.jwt.claims = '{\"sub\":\"<USER_ID>\",\"role\":\"authenticated\"}';
select supprimer_mon_compte();
select count(*) as profil_restant from profiles where user_id = '<USER_ID>';
select count(*) as foyer_restant from foyers where id = (select foyer_id from profiles where user_id = '<USER_ID>');
rollback;
"
```

Expected : `profil_restant` = 0, aucune ligne `recette`/`planning`/`etat_courses_article` pour ce foyer (à vérifier avec des `select count(*)` similaires avant le `rollback`) — puis le `rollback` restaure l'état initial (aucune mutation réelle sur staging).

- [ ] **Step 3: Vérifier la branche PARTAGÉE avec un foyer à 2 membres**

Répéter avec un couple de `user_id` appartenant à un même foyer partagé (créer temporairement via 2 comptes jetables + invitation si aucun n'existe déjà) : vérifier qu'après `supprimer_mon_compte()` pour l'un des deux, ses `recette.user_id` passent à `NULL` (`foyer_id` inchangé) et que `planning`/`foyers` du foyer existent toujours — puis `rollback`.

- [ ] **Step 4: Consigner le résultat**

Aucun commit de code ici — juste confirmer dans la conversation que les deux vérifications sont conformes avant de passer à la Task 8.

---

### Task 8: Documentation (CLAUDE.md, SPECS_FONCTIONNELLES.md, CHANGELOG.md, memory)

**Files:**
- Modify: `CLAUDE.md` (nouveau piège, avant `### Tests & CI`)
- Modify: `SPECS_FONCTIONNELLES.md` (US-31 après US-30 ; RG-70 après RG-69)
- Modify: `CHANGELOG.md` (section `### Ajouté` de `[Unreleased]`)

- [ ] **Step 1: CLAUDE.md**

Ajouter un paragraphe piège couvrant : premier usage de `service_role` dans ce projet (fichier `lib/supabase/admin.ts`, jamais importé côté client) ; le piège FK `recette.user_id` CASCADE vérifié sur staging et sa parade (réattribution `user_id = NULL` AVANT `deleteUser`) ; `profiles.foyer_id` RESTRICT (ordre profil-puis-foyer) ; confirmation forte texte = UX seulement, pas un contrôle de sécurité (c'est la ré-authentification) ; secrets déjà déployés le 2026-07-15 (Vercel prod + GitHub Actions/Dependabot staging).

- [ ] **Step 2: SPECS_FONCTIONNELLES.md**

Ajouter `### US-31 — Suppression de compte (#237, épopée B2C #234)` juste après la section US-30 (avant le `---` qui suit), avec 3-4 scénarios BDD (case ré-auth+confirmation, solo purge tout, partagé préserve les autres, erreur si mot de passe incorrect). Ajouter `### RG-70 — Suppression de compte, droit à l'effacement (US-31, #237)` juste après le bloc RG-64→69 (avant `### RG-22`), décrivant les deux branches (solo/partagé) et le piège FK.

- [ ] **Step 3: CHANGELOG.md**

Ajouter en tête de `### Ajouté` :

```markdown
- Supprimer mon compte (#237) : depuis `/profil`, une nouvelle section **« Zone dangereuse »** permet de supprimer définitivement ton compte et tes données, après ré-authentification (mot de passe) et confirmation forte (taper **SUPPRIMER**). En **foyer partagé**, tes recettes restent visibles pour les autres membres (elles ne sont plus attribuées à personne) ; en solo, tout est effacé, y compris le foyer. Action **irréversible**.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md SPECS_FONCTIONNELLES.md CHANGELOG.md
git commit -m "docs: suppression de compte — CLAUDE.md, specs, changelog (#237)"
```

---

### Task 9: Vérification finale et vague de régression

- [ ] **Step 1: Suite complète**

```bash
npm run test:run
npx tsc --noEmit
npx eslint --ignore-pattern ".understand-anything/**"
npx next build
```

Expected: tous verts, build réussi.

- [ ] **Step 2: e2e ciblés + régression proche**

```bash
npm run test:e2e:staging -- suppression-compte.spec.ts profil.spec.ts auth.spec.ts --retries=2
```

Expected: tous verts. Si `profil.spec.ts` échoue à cause d'un élément de la page recouvert (cf. piège bandeau cookies #236 déjà corrigé), vérifier que la nouvelle section « Zone dangereuse » n'introduit pas un chevauchement similaire (elle est en flux normal, pas de position `fixed`).

- [ ] **Step 3: Ouvrir la PR, surveiller la CI, merger si vert**

Suivre le processus déjà établi cette session (branche `feat/237-suppression-compte`, déjà créée) : commit final si besoin, push, `gh pr create`, `gh pr checks --watch`, merge `--squash --delete-branch` une fois tout vert.
