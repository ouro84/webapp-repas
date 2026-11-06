# Coches horodatées, PR 2 : un seul moteur de coche (#362 phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lever les limites (a) et (b) des coches d'ingrédients et ne garder qu'un moteur de coche pour les ingrédients et les articles manuels.

**Architecture:**
- Décocher conserve la ligne (`coche = false`, `updated_at` serveur).
- `lib/moteur-coches.ts` (générique, sans React ni Supabase) porte l'écriture en vol par clé, l'arbitrage « dernier commit gagnant » sur `updated_at`, les événements différés et la file hors ligne persistée.
- Deux adaptateurs de transport (`etat_courses_article`, `article_manuel`) et deux vues (blob `courses_cochees`, store des articles manuels) ; `lib/sync.ts` ne fait que câbler.

**Tech Stack:** Supabase (migration, PostgREST, Realtime), Vitest + jsdom, Playwright staging (deux contextes navigateur).

**Spec:** `docs/superpowers/specs/2026-11-06-362-phase2-moteur-coches.md`.

**Prérequis :** PR 1 (`2026-11-06-362-phase2-pr1-colonne-coche.md`) mergée, **déployée en prod depuis au moins 1 h**.

## Global Constraints

- Français ; commentaires citant RG-10, RG-12, RG-13, RG-31, RG-32, RG-41, #362.
- `DELETE` sur `etat_courses_article` seulement dans les purges : `purgerCyclesAvant`, `supprimer_compte`, nettoyage de foyer de `quitter_foyer`, `e2e/helpers.ts`.
- Une coche n'affiche plus de toast d'échec : file + indicateur « hors ligne » (`definirEtat("hors-ligne")`).
- Blob `courses_cochees` conservé (format `{ "nom|unité": quantité }`) ; nouvelles clés localStorage : `coches_maj` (horodatages par clé) et `coches_en_attente` (file), purgées par `reinitialiserCacheFoyer`.
- CHANGELOG `[Unreleased] > Corrigé` : « Liste de courses : quand deux personnes du foyer cochent ou décochent le même article au même moment, toutes voient le même résultat, et une coche faite sans réseau (articles ajoutés à la main compris) est enregistrée au retour du réseau au lieu d'afficher une erreur (#362). »

## Review Focus

- « Tout décocher » pendant qu'une coche est en vol sur un article : état final décoché partout.
- Hors ligne → coche → rechargement de la page → retour réseau : la coche part, dans l'ancre où elle a été faite, même si un autre cycle est affiché.
- Annulation (US-09) d'une régénération qui restaure des coches : elles repartent en base.
- Article manuel supprimé par un autre membre pendant que sa coche est en file : file vidée, aucun message, aucune boucle de rejeu.
- Régénération du cycle (RG-13) reçue d'un autre membre : toutes les cases se décochent chez soi.

---

### Task 1: écritures horodatées en base

**Files:**
- Create: `supabase/migrations/<horodatage>_coches_decoche_conservee.sql`
- Modify: `lib/persistance.ts`
- Test: `lib/persistance.test.ts`

**Interfaces:**
- Produces (`lib/persistance.ts`) :
  ```ts
  export type EtatCocheDistant = { coche: boolean; valeur: number; maj: string }
  export async function chargerEtatCochesDistant(ancre: string, supabase?: ClientSupabase): Promise<Record<string, EtatCocheDistant>> // lignes cochées ET décochées
  export async function cocherArticleDistant(ancre: string, cle: string, quantite: number, supabase?: ClientSupabase): Promise<string> // upsert coche=true, renvoie updated_at
  export async function decocherArticleDistant(ancre: string, cle: string, supabase?: ClientSupabase): Promise<string> // upsert { coche: false, quantite: 0 }, renvoie updated_at
  export async function viderCochesDistantes(ancre: string): Promise<Array<{ cle: string; maj: string }>> // update coche=false where ancre and coche, returning
  export async function basculerCocheArticleManuelDistant(id: string, coche: boolean, supabase?: ClientSupabase): Promise<string | null> // inchangée : null = article disparu
  ```
- Migration : `create or replace function sauvegarder_cycle` recopiée de `20261029200000_rpc_slots_recettes_visibles.sql`, avec la purge RG-13 remplacée par `update etat_courses_article set coche = false where foyer_id = v_foyer and ancre = v_ancre and coche`.

- [ ] **Step 1: Tests qui échouent** (`lib/persistance.test.ts`, mock existant) : `decocherArticleDistant` fait un `upsert` `{ ancre, cle, quantite: 0, coche: false }` avec `onConflict: "foyer_id,ancre,cle"` et `select("updated_at")`, sans `delete` ; `cocherArticleDistant` renvoie l'`updated_at` lu ; `viderCochesDistantes` fait `update({ coche: false })`, `eq("ancre")`, `eq("coche", true)`, `select("cle, updated_at")` ; `chargerEtatCochesDistant` lit `cle, quantite, coche, updated_at` sans filtre `coche`.
- [ ] **Step 2:** `npx vitest run lib/persistance.test.ts` → échec.
- [ ] **Step 3:** Implémenter, écrire la migration, l'appliquer sur staging. Adapter les appelants existants au nouveau type de retour (`lib/sync.ts` ignore encore la valeur ; MCP et exécuteur inchangés).
- [ ] **Step 4:** `npx vitest run --exclude ".claude/**"` et `npx tsc --noEmit` verts.
- [ ] **Step 5:** Commit `feat: décoche conservée et écritures de coche horodatées (#362)`.

### Task 2: `lib/moteur-coches.ts`

**Files:**
- Create: `lib/moteur-coches.ts`, `lib/moteur-coches.test.ts`

**Interfaces:**
- Produces :
  ```ts
  export type Etat<V> = { coche: boolean; valeur: V }
  export type TransportCoches<V> = {
    ecrire(ancre: string, cle: string, etat: Etat<V>): Promise<string | null> // updated_at ; null = cible disparue → opération abandonnée
    vider(ancre: string): Promise<Array<{ cle: string; maj: string }>>
  }
  export type VueCoches<V> = { appliquer(cle: string, etat: Etat<V>): void; vider(): void } // écrit la vue sans repasser par le moteur
  export type StockageCoches = { lire(cle: string): string | null; ecrire(cle: string, valeur: string): void; effacer(cle: string): void }
  export type MoteurCoches<V> = {
    poser(ancre: string, cle: string, etat: Etat<V>, options?: { vueDejaAJour?: boolean }): void // geste local : vue (sauf vueDejaAJour), file, flush
    toutDecocher(ancre: string): void
    surEvent(ancre: string, cle: string, etat: Etat<V> | null, maj: string | null): void // null = DELETE (purge)
    hydrater(ancre: string, distant: Record<string, Etat<V> & { maj: string }>): void // dirty-first : une clé en file garde le local
    rejouer(): Promise<void> // file hors ligne (retour réseau, montage)
    enAttente(): boolean
  }
  export function creerMoteurCoches<V>(deps: {
    nom: string // préfixe des clés de stockage : `${nom}_maj`, `${nom}_en_attente`
    transport: TransportCoches<V>
    vue: VueCoches<V>
    stockage: StockageCoches
    surEtat: (etat: "sauvegarde" | "synchronise" | "hors-ligne") => void
    journal?: (message: string, erreur?: unknown) => void
  }): MoteurCoches<V>
  ```
- Règles (à coder exactement) :
  1. File persistée : au plus une opération par `(ancre, cle)` (le dernier geste remplace), plus des opérations `vider(ancre)`. Un `vider` efface les opérations de clé antérieures de la même ancre.
  2. Une seule écriture en vol par clé. À la réponse : horodatage connu de la clé = `maj` renvoyé ; puis jugement des événements différés de la clé.
  3. `surEvent` : ignoré si `maj` ≤ horodatage connu de la clé (écho ou périmé) ; différé si la clé a une écriture en vol ou une opération en file ; sinon appliqué à la vue, et l'horodatage connu devient `maj`. `etat === null` (DELETE) : décoche appliquée si rien n'est en vol ni en file pour la clé, horodatage connu effacé.
  4. Événement différé jugé à la fin de l'écriture : appliqué s'il est plus récent que l'horodatage renvoyé **et** qu'aucun nouveau geste n'est en file sur la clé ; sinon ignoré.
  5. Échec d'écriture : l'opération reste en file, `surEtat("hors-ligne")`, arrêt du flush ; pas de rejet vers l'appelant. `null` du transport : opération retirée, `journal(...)`.

- [ ] **Step 1: Tests qui échouent** (faux transport à promesses contrôlées, faux stockage `Map`), un `it` par ligne :
  - (a) écho tardif : poser coche (réponse T1), poser décoche (réponse T2), puis `surEvent(coche, T1)` → vue décochée ;
  - (b) commit concurrent intercalé : poser coche (en vol), `surEvent(décoche, T2)`, réponse T1 < T2 → vue décochée ;
  - commit concurrent antérieur : poser coche (en vol), `surEvent(décoche, T0)`, réponse T1 > T0 → vue cochée ;
  - événement d'un autre membre hors vol, plus récent → appliqué ; plus ancien → ignoré ;
  - trois gestes rapides pendant une écriture → deux écritures au total, la dernière vaut le dernier geste ;
  - échec réseau → `surEtat("hors-ligne")`, opération en file ; nouveau moteur sur le même stockage + `rejouer()` → écriture dans l'ancre d'origine même après `hydrater` d'une autre ancre ;
  - `ecrire` renvoie `null` → file vide, pas de nouvel essai ;
  - `toutDecocher` pendant une coche en vol → état final décoché ;
  - `hydrater` : une clé en file garde le local, les autres prennent le distant (tombstones compris) ;
  - DELETE (`surEvent(..., null, null)`) → décoche.
- [ ] **Step 2:** `npx vitest run lib/moteur-coches.test.ts` → échec.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Vert.
- [ ] **Step 5:** Commit `feat: moteur de coche générique horodaté (#362)`.

### Task 3: ingrédients sur le moteur

**Files:**
- Modify: `lib/sync.ts` (section coches : `flusherCoches`, `surChangementCoches`, `cochesConnues`, `clesEnVol`, `hydraterCoches`, `appliquerEventLocal`, `surEventCoche`, `reinitialiserCacheFoyer`, `attendreSync`, retour en ligne), `lib/coches-sync.ts` (garder `deriverOps` ; supprimer ce qui n'a plus d'appelant)
- Test: `lib/sync.test.ts`

**Interfaces:**
- Consumes : Task 1 (persistance), Task 2 (`creerMoteurCoches`).
- Adaptateur : transport sur `cocherArticleDistant` / `decocherArticleDistant` / `viderCochesDistantes` ; vue = blob via `ecrireBlob` sous `applicationDistanteEnCours` ; `surChangementCoches` dérive les opérations du diff blob ↔ dernier état connu, puis `poser(..., { vueDejaAJour: true })` (geste de la page, annulation US-09) ; blob vidé → `toutDecocher(ancre)`. Hydratation par `chargerEtatCochesDistant`. Événement Realtime : `updated_at` et `coche` du payload.

- [ ] **Step 1:** Ajouter dans `lib/sync.test.ts`, de bout en bout (événement Realtime rejoué via `realtime.rappels`), les scénarios suivants. Les deux premiers échouent.
  - (a) et (b) ;
  - régénération d'un autre membre (événements `UPDATE` `coche: false` sur toutes les clés, horodatages récents) → blob vide ;
  - annulation US-09 (`restaurerSnapshotAnnulation` qui remet des coches dans le blob) → `cocherArticleDistant` appelé pour chacune.
- [ ] **Step 2:** Câbler le moteur. Les tests existants des coches qui vérifient un **résultat** restent verts sans modification. Ceux qui vérifient une mécanique supprimée (op par op, `clesEnVol`, un seul `viderCochesDistantes`) sont réécrits sur le résultat équivalent ; chaque réécriture est listée dans le message de commit.
- [ ] **Step 3:** `npx vitest run --exclude ".claude/**"`, `npx tsc --noEmit`, `npx eslint lib app` verts.
- [ ] **Step 4:** Commit `refactor: coches d'ingrédients sur le moteur horodaté (#362)`.

### Task 4: articles manuels sur le moteur

**Files:**
- Modify: `lib/sync.ts` (`ecrituresCoche`, `ecrireCocheEnSerie`, `vidageCochesEnVol`, `basculerCocheArticleManuel`, `viderCochesArticlesManuels`, `surEventArticleManuel` pour la coche, `basculerCocheArticle`, `toutDecocher`), `app/courses/page.tsx` (retrait des toasts de coche, `.catch` gardé et loggé)
- Test: `lib/sync.test.ts`

**Interfaces:**
- Adaptateur : transport sur `basculerCocheArticleManuelDistant` / `viderCochesArticlesManuelsDistantes` (`majLe` → `maj`) ; vue = `definirArticlesManuels` ; clé = `id`, valeur `null`. Une deuxième instance du moteur (`nom: "coches_manuels"`).

- [ ] **Step 1:** Tests qui échouent : coche hors ligne d'un article manuel → pas de rejet, indicateur « hors ligne », écriture au retour en ligne ; article supprimé (transport `null`) → file vide ; (a) et (b) sur un article manuel.
- [ ] **Step 2:** Câbler ; les tests existants des articles manuels (écho dépassé, clics rapides, #343) restent verts sur leur résultat.
- [ ] **Step 3:** Suite complète, `tsc`, `eslint` verts.
- [ ] **Step 4:** Commit `refactor: coches des articles manuels sur le moteur horodaté (#362)`.

### Task 5: e2e à deux appareils, règles, CHANGELOG

**Files:**
- Create: `e2e/coches-concurrence.spec.ts`
- Doc: `.claude/rules/sync-planning.md` (section « Coches temps réel » : remplacer les puces « Fenêtre résiduelle » et « Limite connue (écriture concurrente) » par la règle du moteur ; retirer le renvoi à #358), `.claude/rules/courses-cycle.md` (articles manuels : moteur commun, file hors ligne, plus de toast), `CHANGELOG.md`

- [ ] **Step 1:** Spec deux contextes (`browser.newContext()` ×2, même foyer, helpers de `e2e/helpers.ts`) : A coche puis décoche « tomate » en moins de 300 ms pendant que B coche « tomate » ; attendre la stabilisation → même état chez A et chez B, égal à la ligne en base (`coche` lu par l'API REST staging). Plus : A hors ligne (`context.setOffline(true)`) coche un article manuel, pas de toast, retour en ligne → coché chez B.
- [ ] **Step 2:** `npm run test:e2e:staging -- e2e/coches-concurrence.spec.ts --retries=2` vert, puis `--repeat-each=5` vert (pas de flaky).
- [ ] **Step 3:** E2E staging spec par spec : `courses`, `coches-realtime`, `cycle-courses`, `mcp-ecriture`, `panier-demande`.
- [ ] **Step 4:** Règles + CHANGELOG ; commit `test: e2e de coches concurrentes à deux appareils (#362)` ; `graphify update .`.
