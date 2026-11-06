# Coches horodatées, PR 1 : colonne `coche` et lecteurs filtrés (#362 phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Préparer la décoche par ligne conservée. `etat_courses_article` gagne `coche`, et tout lecteur ne voit que les lignes `coche = true`, sans encore changer les écritures (toujours `DELETE`).

**Architecture:** Migration additive (`default true` : les lignes existantes restent cochées). `chargerCochesDistantes` filtre. Le clonage de `quitter_foyer` ne copie que les lignes cochées. Le temps réel traite un `UPDATE` portant `coche = false` comme une décoche : un client de cette PR reste juste quand la PR 2 commence à écrire `coche = false`.

**Tech Stack:** Supabase (migration SQL, PostgREST), Vitest (`lib/persistance.test.ts`, `lib/sync.test.ts`), Playwright staging.

**Spec:** `docs/superpowers/specs/2026-11-06-362-phase2-moteur-coches.md` (décisions 1, 2, 7).

## Global Constraints

- Migration `supabase/migrations/<AAAAMMJJhhmmss>_coches_colonne_coche.sql`, horodatage postérieur à `20261104120000`.
- `quitter_foyer` : partir de la définition **courante** (`20260715140000_recette_preference.sql`), ne changer que le `select … from etat_courses_article where foyer_id = v_old` (ajout `and coche`) ; grants inchangés.
- Appliquer la migration sur staging avant l'e2e (`node scripts/query-supabase.mjs upxoxrjumxpzumakawiv …` puis insertion dans `supabase_migrations.schema_migrations`, cf. `.claude/rules/supabase.md`).
- Pas d'entrée CHANGELOG (aucun effet visible).

## Review Focus

- Ligne `coche = false` écrite à la main en base : invisible pour `/courses`, `lire_liste_courses` et la prise de demande de l'exécuteur.
- Événement temps réel `UPDATE` avec `new.coche = false` : l'article se décoche à l'écran (pas « coché à quantité X »).
- Un membre quitte le foyer : ses coches `coche = false` ne sont pas clonées.
- Lignes existantes (sans valeur explicite) : toujours cochées après migration.

---

### Task 1: migration `coche` + clonage filtré

**Files:**
- Create: `supabase/migrations/<horodatage>_coches_colonne_coche.sql`
- Doc: `.claude/rules/supabase.md` (une ligne : « `etat_courses_article.coche` : une décoche conserve la ligne (`coche = false`, PR 2 de #362) ; tout lecteur filtre `coche = true` »)

- [ ] **Step 1:** Écrire la migration : `alter table etat_courses_article add column coche boolean not null default true;` puis `create or replace function quitter_foyer` recopiée de la définition courante, avec `and coche` dans le clonage.
- [ ] **Step 2:** Appliquer sur staging ; vérifier par `node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "select column_default, is_nullable from information_schema.columns where table_name='etat_courses_article' and column_name='coche'"` → `true`, `NO` ; et `select prosrc ~ 'and coche' from pg_proc where proname='quitter_foyer'` → `t`.
- [ ] **Step 3:** Commit `feat: colonne coche sur etat_courses_article (#362)`.

### Task 2: lecteurs et temps réel

**Files:**
- Modify: `lib/persistance.ts` (`chargerCochesDistantes`), `lib/sync.ts` (`surEventCoche`, normalisation du payload en `EventCoche`)
- Test: `lib/persistance.test.ts`, `lib/sync.test.ts`

**Interfaces:**
- Produces: `chargerCochesDistantes` inchangée en signature ; filtre `.eq("coche", true)`.

- [ ] **Step 1: Tests qui échouent :**
  - `lib/persistance.test.ts` : `chargerCochesDistantes` envoie `eq("coche", true)` (ops du mock) ;
  - `lib/sync.test.ts` : coche `lait|l` hydratée, puis événement Realtime `UPDATE` `new = { ancre, cle: "lait|l", quantite: 1, coche: false }` → blob sans `lait|l` ; un `UPDATE` `coche: true` reste une coche.
- [ ] **Step 2:** `npx vitest run lib/persistance.test.ts lib/sync.test.ts -t "coche"` → échec.
- [ ] **Step 3:** Implémenter (le payload `coche === false` devient `{ type: "supprime", cle }`).
- [ ] **Step 4:** `npx vitest run --exclude ".claude/**"` vert ; `npx tsc --noEmit` ; `npx eslint lib`.
- [ ] **Step 5:** E2E staging, spec par spec : `courses`, `coches-realtime`, `cycle-courses`, `mcp-ecriture`, `panier-demande` (`--retries=2`).
- [ ] **Step 6:** Commit `feat: lecteurs de coches filtrés sur coche = true (#362)` ; PR ; merge sur CI verte ; noter l'heure du déploiement prod (début du délai d'1 h de la PR 2).
