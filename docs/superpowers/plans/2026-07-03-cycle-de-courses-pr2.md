# PR2 — Génération fenêtrée (« Générer mon cycle ») — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans. Steps en checkbox (`- [ ]`).
>
> **Prérequis : PR1 (#258) mergée** — ce plan consomme `lib/cycles.ts` (`joursDuCycle`, `dateVersSemaineJour`, `semainesDuCycle`), le cycle affiché (`useCycleAffiche`) et la migration cycle. La branche part de `main` après merge PR1.

**Goal:** Générer d'un seul clic tout le cycle de courses (jeudi→mercredi), même à cheval sur 2 semaines ISO, sans écraser les jours des cycles voisins.

**Architecture:** Nouvelle RPC `sauvegarder_slots` (upsert partiel de slots par semaine, atomique) ; la route `POST /api/planning/generer` accepte `{ancre, longueur}` ; le générateur reste inchangé (14 slots, saison = ancre du cycle) et ses résultats sont distribués dans les 1-2 semaines touchées.

**Tech Stack:** Next.js 16, TypeScript strict, Supabase (RPC SECURITY DEFINER), Vitest, Playwright.

## Global Constraints

- Français partout ; TypeScript strict ; commits `type: desc`.
- Migration = fichier `supabase/migrations/<timestamp>_<nom>.sql` (à merger avant tout usage).
- Génération = **serveur** (route API) ; le générateur (`lib/generateur.ts`) reste **inchangé** (RG-01/03/49).
- La RPC ne doit écrire QUE les slots fournis (préserver les jours des cycles voisins).

---

### Task 1 : RPC `sauvegarder_slots` (upsert partiel de semaine)

Aujourd'hui `sauvegarder_planning(p_semaine, p_slots)` **remplace toute la semaine** (delete→insert 14 slots) → écraserait les jours d'un cycle voisin. Nouvelle RPC qui **upsert uniquement les (jour, type) fournis**.

**Files:**
- Create: `supabase/migrations/20260710120000_sauvegarder_slots.sql`

**Interfaces:**
- Produces: `sauvegarder_slots(p_semaine text, p_slots jsonb) returns timestamptz` — upsert des slots fournis dans le planning de la semaine (créé si absent), sans toucher aux autres, bump `version`, renvoie `updated_at`.

- [ ] **Step 1 : Écrire la migration** (calquée sur `sauvegarder_planning`, cf. `20260611150000_foyer_scoping.sql`) :

```sql
-- Migration — RPC sauvegarder_slots (#259) : upsert PARTIEL des slots d'une
-- semaine (les seuls (jour, type) fournis), pour la génération fenêtrée du cycle
-- de courses. Contrairement à sauvegarder_planning (remplace 14 slots), préserve
-- les jours appartenant aux cycles voisins.
-- Date : 2026-07-10

create or replace function sauvegarder_slots(p_semaine text, p_slots jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foyer uuid := mon_foyer();
  v_planning uuid;
  v_maj timestamptz;
  v_slot jsonb;
begin
  if v_foyer is null then
    raise exception 'Aucun foyer rattaché à l''utilisateur courant';
  end if;

  -- Planning de la semaine (créé si absent), version incrémentée.
  insert into planning (foyer_id, semaine, version)
  values (v_foyer, p_semaine, 1)
  on conflict (foyer_id, semaine)
  do update set version = planning.version + 1
  returning id, updated_at into v_planning, v_maj;

  -- Upsert des slots fournis uniquement (jour, type_repas) — les autres restent.
  for v_slot in select * from jsonb_array_elements(p_slots) loop
    delete from planning_slot
      where planning_id = v_planning
        and jour = (v_slot->>'jour')
        and type_repas = (v_slot->>'type_repas');
    insert into planning_slot (planning_id, recette_id, jour, type_repas, personnes, restes)
    values (
      v_planning,
      (v_slot->>'recette_id')::uuid,
      v_slot->>'jour',
      v_slot->>'type_repas',
      coalesce((v_slot->>'personnes')::int, 2),
      coalesce((v_slot->>'restes')::boolean, false)
    );
  end loop;

  return v_maj;
end;
$$;

revoke execute on function sauvegarder_slots(text, jsonb) from public;
grant execute on function sauvegarder_slots(text, jsonb) to authenticated;
```

- [ ] **Step 2 : Test SQL en transaction (dev, staging+prod, rollback)** — vérifier que l'upsert d'un slot jeudi ne supprime pas un slot lundi existant de la même semaine (impersonation JWT `set local request.jwt.claims`, `rollback`). Sur le modèle des tests SQL de `#56 PR6`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260710120000_sauvegarder_slots.sql
git commit -m "feat: RPC sauvegarder_slots (upsert partiel pour génération fenêtrée #259)"
```

---

### Task 2 : `lib/persistance.ts` — `sauvegarderSlotsDistant`

**Files:**
- Modify: `lib/persistance.ts`

**Interfaces:**
- Consumes: `Planning`, `construireSlots` (l.137-164).
- Produces: `sauvegarderSlotsDistant(semaine: string, jours: JourPlanning[]): Promise<string>` — appelle la RPC `sauvegarder_slots`, renvoie `updated_at`.

- [ ] **Step 1 : Écrire un test** de construction du payload (les slots d'un jour → objets `{jour, type_repas, recette_id, personnes, restes}`), réutiliser/adapter `construireSlots`.

- [ ] **Step 2 : Implémenter** :

```ts
export async function sauvegarderSlotsDistant(
  semaine: string, jours: JourPlanning[],
): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("sauvegarder_slots", {
    p_semaine: semaine,
    p_slots: construireSlots({ semaine, jours }), // même sérialisation que sauvegarder_planning
  })
  if (error) throw new Error(`Sauvegarde des slots impossible : ${error.message}`)
  return data as string
}
```

- [ ] **Step 3 : Vérifier** — `npx tsc --noEmit`. Commit :

```bash
git add lib/persistance.ts
git commit -m "feat: sauvegarderSlotsDistant (upsert partiel #259)"
```

---

### Task 3 : Route `POST /api/planning/generer` — mode `{ancre, longueur}`

**Files:**
- Modify: `app/api/planning/generer/route.ts`

**Interfaces:**
- Consumes: `joursDuCycle`, `dateVersSemaineJour`, `semainesDuCycle`, `saisonDeSemaine` ; `genererPlanning` (inchangé).

- [ ] **Step 1 : Ajouter le mode cycle.** Le corps accepte soit `{semaine}` (existant), soit `{ancre, longueur}`. En mode cycle : valider `ancre` (regex `^\d{4}-\d{2}-\d{2}$`) et `longueur` (1..14, borne d'ancre via `cyclesSelectionnables` −12..+6). Générer les 14 slots du cycle : appeler `genererPlanning(recettes, semaineAncre, reglages, undefined, historique)` pour obtenir un planning candidat, puis **projeter** ses jours sur les dates du cycle et les regrouper par semaine ISO. (Le générateur raisonne par semaine ISO ; pour un cycle à cheval, générer par semaine touchée avec la saison de chaque semaine, OU générer un bloc de 7 jours dont on mappe les jours vers les dates du cycle — choisir la 2ᵉ voie : générer la fenêtre comme un planning de 7 jours indexés par les jours réels des dates.)

> Décision d'implémentation (à figer ici, pas en TBD) : **générer par semaine ISO touchée**. Pour chaque semaine de `semainesDuCycle(ancre, longueur)`, ne générer que les jours du cycle présents dans cette semaine (via `tempsEligibles`/`genererPlanning` restreint aux jours voulus), saison = `saisonDeSemaine(semaine)`. Puis `sauvegarderSlotsDistant(semaine, joursGeneres)` pour chaque semaine.

- [ ] **Step 2 : Réponse** — renvoyer le planning **projeté du cycle** (`planningDuCycle` des semaines regénérées) + les avertissements dérivés (`vegeNonHonore`/`mixNonHonore`/`saisonNonHonore`) calculés sur les slots du cycle.

- [ ] **Step 3 : Tests** — unitaire sur la logique de découpe cycle→semaines (extraire une fonction pure `slotsCycleParSemaine` dans `lib/cycles.ts`, testée) ; le reste = e2e (Task 5).

- [ ] **Step 4 : Commit**

```bash
git add app/api/planning/generer/route.ts lib/cycles.ts tests/cycles.test.ts
git commit -m "feat: génération fenêtrée sur le cycle (route + découpe par semaine) (#259)"
```

---

### Task 4 : `/courses` — bouton « Générer mon cycle »

**Files:**
- Modify: `app/courses/page.tsx`, `lib/sync.ts`

**Interfaces:**
- Consumes: `useCycleAffiche` ; POST `/api/planning/generer` en mode cycle.

- [ ] **Step 1 : Ajouter `genererCycle()` dans `lib/sync.ts`** — POST `{ancre, longueur}`, puis `chargerCycleDansCache(ancre, longueur)` (recharge le planning projeté + coches). Marque dirty pour push (comme la génération semaine).

- [ ] **Step 2 : Bouton dans l'en-tête `/courses`** (à côté de la navigation), `aria-label="Générer mon cycle"`, état loading, toasts d'avertissement (végé/mix/saison non honorés) réutilisant le patron de `/planning`.

- [ ] **Step 3 : Alerte « en magasin » (#56 PR5).** La génération de cycle bumpe la `version` de 1-2 semaines → l'abonnement planning realtime doit surveiller les semaines touchées par le cycle affiché. Adapter `synchroniserAbonnementPlanning` pour s'abonner aux semaines de `semainesDuCycle` quand on est en contexte courses (ou souscrire aux 2 topics). Vérifier qu'un écho de sa propre écriture est filtré via `updated_at`/`signaturePlanning` (mécanisme existant).

- [ ] **Step 4 : Build + lint** — `npm run lint && npx tsc --noEmit`. Commit :

```bash
git add app/courses/page.tsx lib/sync.ts
git commit -m "feat: bouton Générer mon cycle sur /courses (#259)"
```

---

### Task 5 : e2e génération fenêtrée (CI-only)

**Files:**
- Modify: `e2e/cycle-courses.spec.ts`

- [ ] **Step 1 : Test** — jour de courses = jeudi, « Générer mon cycle », vérifier une liste non vide couvrant la fenêtre ; vérifier que régénérer le cycle ne vide pas un autre cycle (naviguer au précédent, vérifier son planning intact). CI-only (staging seedé). Reset `jour_courses` en `afterAll`.

- [ ] **Step 2 : Commit**

```bash
git add e2e/cycle-courses.spec.ts
git commit -m "test: e2e génération fenêtrée du cycle (#259)"
```

---

### Task 6 : Documentation

- [ ] `CLAUDE.md` : piège « RPC `sauvegarder_slots` = upsert partiel (ne pas confondre avec `sauvegarder_planning` qui remplace la semaine) » + génération fenêtrée du cycle + adaptation abonnement planning aux semaines du cycle.
- [ ] `CHANGELOG.md` : `[Unreleased]` « Générer tout le cycle de courses d'un clic ».
- [ ] Commit `docs: génération fenêtrée du cycle (#259)`.

---

## Self-Review

- RPC upsert partiel (Task 1) préserve les jours voisins → test SQL rollback (Task 1 step 2) + e2e (Task 5) ✓.
- Générateur inchangé (Task 3, découpe par semaine) ✓.
- Alerte en magasin sur 1-2 semaines (Task 4 step 3) — edge case §9 du design ✓.
- Types : `sauvegarderSlotsDistant(semaine, jours)` ↔ RPC `sauvegarder_slots(p_semaine, p_slots)` ↔ `construireSlots` cohérents ✓.
- Point ouvert assumé : la découpe cycle→semaines dans la génération est figée sur « générer par semaine ISO touchée » (Task 3 step 1) — pas de TBD.
</content>
