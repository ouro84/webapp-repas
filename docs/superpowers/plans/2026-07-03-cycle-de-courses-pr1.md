# PR1 — Socle cycle + liste de courses fenêtrée — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la liste de courses (`/courses`) fenêtrée sur un « cycle de courses » ancré sur le jour de courses du foyer, au lieu de la semaine calendaire ISO — une seule liste, zéro reliquat.

**Architecture:** Projection légère. Le stockage planning reste par semaine ISO ; un nouveau module pur `lib/cycles.ts` projette une fenêtre `ancre + longueur` par-dessus. Les coches passent de la clé `semaine` à la clé `ancre` (date). Rétro-compat : défaut `jour_courses = lundi` + longueur 7 ⇒ cycle ≡ semaine ISO ⇒ aucun changement observable avant opt-in.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Supabase (Postgres + RLS + Realtime), Vitest, Playwright, Tailwind v4.

## Global Constraints

- Tout en **français** (identifiants, commentaires, UI), citer les RG-xx/US-xx concernées.
- **TypeScript strict** : corriger les types, ne pas les contourner.
- **`app/` = UI, `lib/` = logique pure/données.** Cœur métier testable sans navigateur.
- **localStorage via `useSyncExternalStore`** (règle `react-hooks/set-state-in-effect`) ; écritures coches via `storeCoches`, jamais en direct.
- **Trois états UI** : loading / error / empty.
- **Mobile-first.**
- **Commits** : `type: description courte` (feat/fix/chore/refactor/test/docs).
- **Migration** : fichier `supabase/migrations/<timestamp 14 chiffres>_<nom>.sql`. Cette PR porte LA migration → la merger avant PR2/PR3 (staging partagé).
- Ancre de cycle = **date ISO `"AAAA-MM-JJ"`** (chaîne). `jour_courses` = smallint **ISO 1=lundi … 7=dimanche**.

---

### Task 1 : Cœur pur `lib/cycles.ts` + tests

Aucune dépendance réseau. Miroir d'esprit de `lib/semaines.ts`. À faire en premier : les tâches suivantes en dépendent.

**Files:**
- Create: `lib/cycles.ts`
- Test: `tests/cycles.test.ts`

**Interfaces:**
- Consumes: `semaineISO`, `formaterSemaine` de `lib/semaines.ts` ; type `Jour` de `types`.
- Produces (signatures que les tâches suivantes consomment) :
  - `ancreCourante(aujourdhui: Date, jourCourses: number): string` — date ISO de la dernière occurrence du jour de courses ≤ aujourd'hui.
  - `cycleDecale(ancre: string, n: number): string` — ancre ± n×7 jours.
  - `joursDuCycle(ancre: string, longueur: number): string[]` — dates ISO du cycle.
  - `semainesDuCycle(ancre: string, longueur: number): string[]` — semaines ISO distinctes touchées (ordre chronologique).
  - `dateVersSemaineJour(dateISO: string): { semaine: string; jour: Jour }`.
  - `libelleCycle(ancre: string, longueur: number): string` — ex. « Courses du 9 au 15 juillet ».
  - `cyclesSelectionnables(aujourdhui: Date, jourCourses: number, passe?: number, futur?: number): { ancre: string; offset: number }[]` — défaut passe=12, futur=6.
  - `LONGUEUR_DEFAUT = 7`, `LONGUEUR_MAX = 14`.

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// tests/cycles.test.ts
import { describe, it, expect } from "vitest"
import {
  ancreCourante, cycleDecale, joursDuCycle, semainesDuCycle,
  dateVersSemaineJour, libelleCycle, cyclesSelectionnables, LONGUEUR_DEFAUT,
} from "@/lib/cycles"

describe("ancreCourante", () => {
  it("renvoie aujourd'hui si on EST le jour de courses (jeudi=4)", () => {
    // jeudi 9 juillet 2026
    expect(ancreCourante(new Date("2026-07-09T10:00:00"), 4)).toBe("2026-07-09")
  })
  it("recule au dernier jour de courses passé (samedi → jeudi précédent)", () => {
    // samedi 11 juillet → dernier jeudi = 9 juillet
    expect(ancreCourante(new Date("2026-07-11T10:00:00"), 4)).toBe("2026-07-09")
  })
  it("la veille du jour de courses garde l'ancre de la semaine précédente", () => {
    // mercredi 8 juillet, jour de courses jeudi → ancre = jeudi 2 juillet
    expect(ancreCourante(new Date("2026-07-08T23:00:00"), 4)).toBe("2026-07-02")
  })
  it("défaut lundi (1) = début de semaine ISO", () => {
    // mercredi 8 juillet → lundi 6 juillet
    expect(ancreCourante(new Date("2026-07-08T10:00:00"), 1)).toBe("2026-07-06")
  })
})

describe("cycleDecale", () => {
  it("avance et recule de 7 jours", () => {
    expect(cycleDecale("2026-07-09", 1)).toBe("2026-07-16")
    expect(cycleDecale("2026-07-09", -1)).toBe("2026-07-02")
    expect(cycleDecale("2026-07-09", 0)).toBe("2026-07-09")
  })
})

describe("joursDuCycle", () => {
  it("longueur 7 = 7 dates consécutives", () => {
    expect(joursDuCycle("2026-07-09", 7)).toEqual([
      "2026-07-09","2026-07-10","2026-07-11","2026-07-12",
      "2026-07-13","2026-07-14","2026-07-15",
    ])
  })
  it("longueur 9 = 9 dates (étirement)", () => {
    expect(joursDuCycle("2026-07-09", 9)).toHaveLength(9)
    expect(joursDuCycle("2026-07-09", 9).at(-1)).toBe("2026-07-17")
  })
})

describe("semainesDuCycle", () => {
  it("un cycle jeudi→mercredi touche 2 semaines ISO", () => {
    expect(semainesDuCycle("2026-07-09", 7)).toEqual(["2026-W28", "2026-W29"])
  })
  it("un cycle lundi/7 ne touche qu'une semaine ISO (rétro-compat)", () => {
    expect(semainesDuCycle("2026-07-06", 7)).toEqual(["2026-W28"])
  })
})

describe("dateVersSemaineJour", () => {
  it("jeudi 9 juillet 2026 = semaine W28, jour jeudi", () => {
    expect(dateVersSemaineJour("2026-07-09")).toEqual({ semaine: "2026-W28", jour: "jeudi" })
  })
  it("dimanche 12 juillet 2026 = W28, dimanche", () => {
    expect(dateVersSemaineJour("2026-07-12")).toEqual({ semaine: "2026-W28", jour: "dimanche" })
  })
})

describe("libelleCycle", () => {
  it("formate la plage du cycle", () => {
    expect(libelleCycle("2026-07-09", 7)).toBe("Courses du 9 au 15 juillet")
  })
})

describe("cyclesSelectionnables", () => {
  it("borne -12 à +6 autour de l'ancre courante", () => {
    const opts = cyclesSelectionnables(new Date("2026-07-09T10:00:00"), 4)
    expect(opts).toHaveLength(19) // 12 passées + courante + 6 futures
    expect(opts.find((o) => o.offset === 0)?.ancre).toBe("2026-07-09")
  })
})

it("LONGUEUR_DEFAUT vaut 7", () => { expect(LONGUEUR_DEFAUT).toBe(7) })
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm run test:run -- tests/cycles.test.ts`
Expected: FAIL (module `@/lib/cycles` introuvable).

- [ ] **Step 3 : Implémenter `lib/cycles.ts`**

```ts
// lib/cycles.ts
// Cycle de courses (#257) — fenêtre `ancre + longueur` projetée par-dessus le
// stockage par semaine ISO. Cœur PUR, testable sans réseau (esprit lib/semaines).
//
// Ancre = date ISO "AAAA-MM-JJ" du jour de courses du foyer. Arithmétique
// calendaire en heure LOCALE (cohérent avec lib/semaines.ts, cf. #171) :
// semaineISO() reconstruit l'identifiant depuis les getters locaux.

import { semaineISO } from "@/lib/semaines"
import type { Jour } from "@/types"

export const LONGUEUR_DEFAUT = 7
export const LONGUEUR_MAX = 14

// ISO : lundi = 1 … dimanche = 7 (Date.getDay renvoie 0 pour dimanche).
const JOURS_ISO: Jour[] = [
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
]

function jourISO(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay()
}

function versISO(d: Date): string {
  const a = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const j = String(d.getDate()).padStart(2, "0")
  return `${a}-${m}-${j}`
}

function depuisISO(dateISO: string): Date {
  const [a, m, j] = dateISO.split("-").map(Number)
  return new Date(a, m - 1, j)
}

/** Date ISO de la dernière occurrence du jour de courses ≤ aujourd'hui (D8). */
export function ancreCourante(aujourdhui: Date, jourCourses: number): string {
  const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate())
  const recul = (jourISO(d) - jourCourses + 7) % 7
  d.setDate(d.getDate() - recul)
  return versISO(d)
}

/** Ancre décalée de n cycles (n×7 jours). */
export function cycleDecale(ancre: string, n: number): string {
  const d = depuisISO(ancre)
  d.setDate(d.getDate() + n * 7)
  return versISO(d)
}

/** Dates ISO concrètes du cycle. */
export function joursDuCycle(ancre: string, longueur: number): string[] {
  const base = depuisISO(ancre)
  return Array.from({ length: longueur }, (_, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    return versISO(d)
  })
}

/** Semaines ISO distinctes que le cycle touche (ordre chronologique). */
export function semainesDuCycle(ancre: string, longueur: number): string[] {
  const vues = new Set<string>()
  const ordonnees: string[] = []
  for (const jour of joursDuCycle(ancre, longueur)) {
    const s = semaineISO(depuisISO(jour))
    if (!vues.has(s)) { vues.add(s); ordonnees.push(s) }
  }
  return ordonnees
}

/** Pont vers le stockage par semaine ISO : une date → (semaine, jour). */
export function dateVersSemaineJour(dateISO: string): { semaine: string; jour: Jour } {
  const d = depuisISO(dateISO)
  return { semaine: semaineISO(d), jour: JOURS_ISO[jourISO(d) - 1] }
}

/** « Courses du 9 au 15 juillet ». */
export function libelleCycle(ancre: string, longueur: number): string {
  const jours = joursDuCycle(ancre, longueur)
  const debut = depuisISO(jours[0])
  const fin = depuisISO(jours[jours.length - 1])
  const memeMois = debut.getMonth() === fin.getMonth()
  const fmtJour = (d: Date) => d.getDate()
  const fmtMois = (d: Date) => d.toLocaleDateString("fr-FR", { month: "long" })
  return memeMois
    ? `Courses du ${fmtJour(debut)} au ${fmtJour(fin)} ${fmtMois(fin)}`
    : `Courses du ${fmtJour(debut)} ${fmtMois(debut)} au ${fmtJour(fin)} ${fmtMois(fin)}`
}

/** Plage de cycles navigables (miroir de semainesSelectionnables). */
export function cyclesSelectionnables(
  aujourdhui: Date, jourCourses: number, passe = 12, futur = 6,
): { ancre: string; offset: number }[] {
  const courante = ancreCourante(aujourdhui, jourCourses)
  const options: { ancre: string; offset: number }[] = []
  for (let offset = -passe; offset <= futur; offset++) {
    options.push({ ancre: cycleDecale(courante, offset), offset })
  }
  return options
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le vert**

Run: `npm run test:run -- tests/cycles.test.ts`
Expected: PASS (tous les cas).

- [ ] **Step 5 : Commit**

```bash
git add lib/cycles.ts tests/cycles.test.ts
git commit -m "feat: cœur pur lib/cycles.ts (fenêtre de courses #257)"
```

---

### Task 2 : Projection courses `planningDuCycle` + tests

Assemble un `Planning` synthétique limité aux jours du cycle, à partir des plannings par semaine chargés. Réutilise `genererListeCourses` sans le modifier.

**Files:**
- Modify: `lib/cycles.ts`
- Test: `tests/cycles.test.ts`

**Interfaces:**
- Consumes: `Planning`, `JourPlanning` de `types` ; `joursDuCycle`, `dateVersSemaineJour`.
- Produces: `planningDuCycle(plannings: Planning[], ancre: string, longueur: number): Planning` — planning synthétique (`semaine` = ancre, `jours` = slots du cycle, dans l'ordre des dates ; jours sans planning omis).

- [ ] **Step 1 : Écrire les tests**

```ts
// à ajouter dans tests/cycles.test.ts
import { planningDuCycle } from "@/lib/cycles"
import type { Planning } from "@/types"
import { genererListeCourses } from "@/lib/courses"

const recette = (nom: string) => ({
  id: nom, nom, tempsPreparation: "rapide" as const,
  ingredients: [{ nom: "pâtes", quantite: 200, unite: "g" as const,
    categorie: "epicerie" as const, fondDePlacard: false }],
})

describe("planningDuCycle", () => {
  const w28: Planning = { semaine: "2026-W28", jours: [
    { jour: "jeudi", diner: recette("A") },
    { jour: "vendredi", diner: recette("B") },
  ]}
  const w29: Planning = { semaine: "2026-W29", jours: [
    { jour: "lundi", diner: recette("C") },
    { jour: "mardi", diner: recette("D") },
  ]}

  it("recolle les jours des 2 semaines dans la fenêtre, sans reliquat", () => {
    const p = planningDuCycle([w28, w29], "2026-07-09", 7) // jeudi 9 → mercredi 15
    const jours = p.jours.map((j) => j.jour)
    // jeudi/vendredi (W28) + lundi/mardi (W29) ; PAS lundi..mercredi de W28
    expect(jours).toEqual(["jeudi", "vendredi", "lundi", "mardi"])
  })

  it("produit une seule liste de courses agrégée sur la fenêtre", () => {
    const p = planningDuCycle([w28, w29], "2026-07-09", 7)
    const liste = genererListeCourses(p)
    const epicerie = liste?.normal.find((c) => c.categorie === "epicerie")
    // 4 dîners × 200 g de pâtes = 800 g
    expect(epicerie?.ingredients[0].quantite).toBe(800)
  })

  it("jours hors planning omis (cycle partiellement vide)", () => {
    const p = planningDuCycle([w28], "2026-07-09", 7)
    expect(p.jours.map((j) => j.jour)).toEqual(["jeudi", "vendredi"])
  })
})
```

- [ ] **Step 2 : Vérifier l'échec** — `npm run test:run -- tests/cycles.test.ts` → FAIL (`planningDuCycle` non exporté).

- [ ] **Step 3 : Implémenter**

```ts
// à ajouter dans lib/cycles.ts
import type { Planning, JourPlanning } from "@/types"

/**
 * Planning synthétique limité aux jours du cycle, recollé depuis les plannings
 * par semaine chargés. Les doublons de `jour` (cycle > 7 j) sont conservés :
 * genererListeCourses agrège par ingrédient, pas par jour. Jours sans slot omis.
 */
export function planningDuCycle(
  plannings: Planning[], ancre: string, longueur: number,
): Planning {
  const parSemaine = new Map(plannings.map((p) => [p.semaine, p]))
  const jours: JourPlanning[] = []
  for (const dateISO of joursDuCycle(ancre, longueur)) {
    const { semaine, jour } = dateVersSemaineJour(dateISO)
    const jp = parSemaine.get(semaine)?.jours.find((j) => j.jour === jour)
    if (jp) jours.push(jp)
  }
  return { semaine: ancre, jours }
}
```

- [ ] **Step 4 : Vérifier le vert** — `npm run test:run -- tests/cycles.test.ts` → PASS.

- [ ] **Step 5 : Commit**

```bash
git add lib/cycles.ts tests/cycles.test.ts
git commit -m "feat: projection planningDuCycle pour la liste de courses (#257)"
```

---

### Task 3 : Migration Supabase (jour_courses, cycle_courses, re-clé coches, purge)

**Files:**
- Create: `supabase/migrations/20260703120000_cycle_de_courses.sql`

**Interfaces:**
- Produces (schéma consommé par persistance/sync) : `foyers.jour_courses smallint` ; table `cycle_courses(foyer_id, ancre date, longueur smallint, updated_at)` ; `etat_courses_article` re-clée sur `ancre date` (PK `(foyer_id, ancre, cle)`).

- [ ] **Step 1 : Écrire la migration**

```sql
-- Migration — cycle de courses (#257) : fenêtre non calendaire de la liste de
-- courses, ancrée sur le jour de courses du FOYER.
-- Date : 2026-07-03
--
-- 1) foyers.jour_courses (réglage foyer, éditable client via grant-colonne,
--    pattern profil #22 PR1). Défaut lundi (1) → cycle ≡ semaine ISO
--    (rétro-compatibilité : aucun changement observable avant opt-in).
-- 2) Table cycle_courses : longueur par cycle (création paresseuse, défaut 7).
-- 3) Re-clé etat_courses_article : semaine text → ancre date (PK, index,
--    realtime inchangés). Backfill : ancre = lundi de la semaine ISO existante.

-- ============================================================================
-- 1. Réglage foyer : jour de courses
-- ============================================================================
alter table foyers add column jour_courses smallint not null default 1
  check (jour_courses between 1 and 7); -- 1=lundi … 7=dimanche (ISO)

-- Écriture client restreinte à cette seule colonne (grant-colonne, cf.
-- 20260612140000_profil_colonnes.sql). code_invitation/expire_le restent
-- inaccessibles au client (gérés par RPC SECURITY DEFINER).
create policy "foyers: reglage jour_courses"
  on foyers for update
  using (id = mon_foyer())
  with check (id = mon_foyer());

grant update (jour_courses) on foyers to authenticated;

-- ============================================================================
-- 2. Table cycle_courses (longueur par cycle, paresseuse)
-- ============================================================================
create table cycle_courses (
  foyer_id   uuid     not null default mon_foyer() references foyers(id),
  ancre      date     not null,
  longueur   smallint not null default 7 check (longueur between 1 and 14),
  updated_at timestamptz not null default now(),
  primary key (foyer_id, ancre)
);

create trigger cycle_courses_set_updated_at
  before insert or update on cycle_courses
  for each row execute function set_updated_at();

alter table cycle_courses enable row level security;

create policy "cycle_courses: lecture foyer" on cycle_courses for select
  using (foyer_id = mon_foyer());
create policy "cycle_courses: insertion foyer" on cycle_courses for insert
  with check (foyer_id = mon_foyer());
create policy "cycle_courses: modification foyer" on cycle_courses for update
  using (foyer_id = mon_foyer()) with check (foyer_id = mon_foyer());
create policy "cycle_courses: suppression foyer" on cycle_courses for delete
  using (foyer_id = mon_foyer());

-- ============================================================================
-- 3. Re-clé etat_courses_article : semaine text → ancre date
-- ============================================================================
-- 3a. Nouvelle colonne, backfill = lundi de la semaine ISO "AAAA-Wnn".
--     Le 4 janvier appartient toujours à la semaine 1 (ISO) ; on en déduit le
--     lundi de la semaine 1 puis on avance de (n-1) semaines.
alter table etat_courses_article add column ancre date;

update etat_courses_article set ancre = (
  (date_trunc('week', make_date(
    (split_part(semaine, '-W', 1))::int, 1, 4))::date)
  + ((split_part(semaine, '-W', 2))::int - 1) * 7
);
-- date_trunc('week', …) renvoie le lundi (ISO) contenant le 4 janvier =
-- lundi de la semaine 1. + (n-1) semaines = lundi de la semaine n.

alter table etat_courses_article alter column ancre set not null;

-- 3b. Bascule de la clé primaire.
alter table etat_courses_article drop constraint etat_courses_article_pkey;
alter table etat_courses_article add primary key (foyer_id, ancre, cle);

-- 3c. Index + suppression de l'ancienne colonne.
drop index if exists etat_courses_article_foyer_semaine_idx;
create index etat_courses_article_foyer_ancre_idx
  on etat_courses_article (foyer_id, ancre);
alter table etat_courses_article drop column semaine;

-- (Realtime : la table est déjà publiée avec REPLICA IDENTITY FULL ; le payload
-- portera désormais `ancre` au lieu de `semaine`. Rien à refaire côté publication.)
```

- [ ] **Step 2 : Vérifier la syntaxe SQL (staging, en dev)**

Run: `node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "select 1"` (vérifie l'accès staging).
Puis, prudence : relire la migration manuellement (le `db push` réel se fait en CI). Vérifier qu'aucune coche staging résiduelle ne casse le backfill :
`node scripts/query-supabase.mjs upxoxrjumxpzumakawiv "select semaine, count(*) from etat_courses_article group by semaine"`
Expected: les `semaine` sont au format `AAAA-Wnn` (backfill applicable).

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/20260703120000_cycle_de_courses.sql
git commit -m "feat: migration cycle de courses (jour_courses foyer, cycle_courses, re-clé coches #257)"
```

> ⚠️ La CI appliquera cette migration sur staging (job `migrate-staging`) au push de la PR. Vérifier le vert avant de continuer les tâches qui écrivent en base (Tasks 5-9 e2e).

---

### Task 4 : Types — coches par ancre, cycle, foyer

**Files:**
- Modify: `types/index.ts` (bloc `DbEtatCourseArticle` l.226-232 ; ajout `DbCycleCourses`).

**Interfaces:**
- Produces: `DbEtatCourseArticle` avec `ancre: string` (au lieu de `semaine`) ; `DbCycleCourses = { foyer_id: string; ancre: string; longueur: number; updated_at: string }`.

- [ ] **Step 1 : Modifier `DbEtatCourseArticle`**

Remplacer dans `types/index.ts` la propriété `semaine: string` de `DbEtatCourseArticle` par :
```ts
  // Re-clé sur l'ancre du cycle de courses (#257) : la fenêtre n'est plus la
  // semaine ISO mais `ancre` (date "AAAA-MM-JJ" du jour de courses foyer).
  ancre: string;
```

- [ ] **Step 2 : Ajouter le type `DbCycleCourses`**

```ts
// Forme DB de `cycle_courses` (#257) — longueur par cycle (création paresseuse ;
// absent = LONGUEUR_DEFAUT). `cle` métier = (foyer_id, ancre).
export type DbCycleCourses = {
  foyer_id: string;
  ancre: string;    // date ISO "AAAA-MM-JJ"
  longueur: number; // 1..14
  updated_at: string;
};
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: des erreurs UNIQUEMENT dans les fichiers consommant `.semaine` des coches (persistance/sync) — corrigées aux tâches 5-6. (Noter les emplacements signalés.)

- [ ] **Step 4 : Commit**

```bash
git add types/index.ts
git commit -m "refactor: types coches par ancre + DbCycleCourses (#257)"
```

---

### Task 5 : `lib/persistance.ts` — accès coches par ancre + longueur de cycle + purge

**Files:**
- Modify: `lib/persistance.ts` (fonctions coches l.197-268 ; `purgerSemainesAvant` l.105-119).

**Interfaces:**
- Consumes: `DbCycleCourses`, `LONGUEUR_DEFAUT`.
- Produces:
  - `chargerCochesDistantes(ancre: string): Promise<Record<string, number>>`
  - `cocherArticleDistant(ancre: string, cle: string, quantite: number): Promise<void>`
  - `decocherArticleDistant(ancre: string, cle: string): Promise<void>`
  - `viderCochesDistantes(ancre: string): Promise<void>`
  - `chargerLongueurCycle(ancre: string): Promise<number>` (défaut `LONGUEUR_DEFAUT`)
  - `definirLongueurCycle(ancre: string, longueur: number): Promise<void>` (upsert si ≠7, delete si =7)
  - `purgerCyclesAvant(cutoffAncre: string): Promise<void>` (remplace le volet coches de `purgerSemainesAvant`)

- [ ] **Step 1 : Re-clé les 4 fonctions coches** (`etat_courses_article` : `semaine`→`ancre`, `onConflict: "foyer_id,ancre,cle"`, `.eq("ancre", …)`). Renommer le paramètre `semaine`→`ancre`. Exemple pour `cocherArticleDistant` (l.224-239) :

```ts
export async function cocherArticleDistant(
  ancre: string, cle: string, quantite: number,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from("etat_courses_article")
    .upsert({ ancre, cle, quantite }, { onConflict: "foyer_id,ancre,cle" })
  if (error) throw new Error(`Cochage impossible : ${error.message}`)
}
```
Appliquer le même remplacement à `chargerCochesDistantes` (`.eq("ancre", ancre)`), `decocherArticleDistant` (`.eq("ancre", ancre).eq("cle", cle)`), `viderCochesDistantes` (`.eq("ancre", ancre)`).

- [ ] **Step 2 : Scinder la purge.** Dans `purgerSemainesAvant` (l.105-119), le planning reste purgé par `semaine` (`< cutoff` semaine ISO) ; le volet coches déménage. Ajouter :

```ts
/** Purge des coches des cycles dont l'ancre est antérieure au cutoff (#257). */
export async function purgerCyclesAvant(cutoffAncre: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from("etat_courses_article").delete().lt("ancre", cutoffAncre)
  if (error) throw new Error(`Purge coches impossible : ${error.message}`)
  // cycle_courses : purge des longueurs obsolètes.
  await supabase.from("cycle_courses").delete().lt("ancre", cutoffAncre)
}
```
Retirer de `purgerSemainesAvant` la suppression sur `etat_courses_article` (l.116) — elle passe désormais par `purgerCyclesAvant`.

- [ ] **Step 3 : Ajouter longueur de cycle.**

```ts
import { LONGUEUR_DEFAUT } from "@/lib/cycles"

/** Longueur persistée d'un cycle (défaut LONGUEUR_DEFAUT si aucune ligne). */
export async function chargerLongueurCycle(ancre: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("cycle_courses").select("longueur").eq("ancre", ancre).maybeSingle()
  if (error) return LONGUEUR_DEFAUT // best-effort : défaut sur erreur
  return data?.longueur ?? LONGUEUR_DEFAUT
}

/** Écrit la longueur (upsert) ; supprime la ligne si retour au défaut. */
export async function definirLongueurCycle(ancre: string, longueur: number): Promise<void> {
  const supabase = createClient()
  if (longueur === LONGUEUR_DEFAUT) {
    const { error } = await supabase.from("cycle_courses").delete().eq("ancre", ancre)
    if (error) throw new Error(`Réglage cycle impossible : ${error.message}`)
    return
  }
  const { error } = await supabase
    .from("cycle_courses").upsert({ ancre, longueur }, { onConflict: "foyer_id,ancre" })
  if (error) throw new Error(`Réglage cycle impossible : ${error.message}`)
}
```

- [ ] **Step 4 : Vérifier la compilation** — `npx tsc --noEmit` (les erreurs restantes sont dans `lib/sync.ts`, tâche 6).

- [ ] **Step 5 : Commit**

```bash
git add lib/persistance.ts
git commit -m "refactor: persistance coches par ancre + longueur cycle + purge (#257)"
```

---

### Task 6 : `lib/sync.ts` — cycle actif, flush/hydrate/realtime coches par ancre, navigation cycle

Le fichier dérive aujourd'hui la clé des coches depuis `planning.semaine` via `semaineActive()` (l.247). On introduit un **cycle affiché** (ancre) porté par un store dédié, et on re-clé toute la chaîne coches dessus.

**Files:**
- Modify: `lib/sync.ts`

**Interfaces:**
- Consumes: `ancreCourante`, `cycleDecale`, `semainesDuCycle`, `planningDuCycle`, `LONGUEUR_DEFAUT` de `lib/cycles` ; `chargerLongueurCycle`, `purgerCyclesAvant` + fonctions coches re-clées (Task 5) ; `chargerFoyer`/jour de courses (Task 7 fournit `jourCoursesFoyer`).
- Produces:
  - `useCycleAffiche(): { ancre: string; longueur: number } | null`
  - `naviguerCycle(offset: number): Promise<void>`
  - `etirerCycle(longueur: number): Promise<void>`
  - `useSync()` (inchangé côté appelant) hydrate désormais aussi le cycle.

- [ ] **Step 1 : Écrire le test de dérivation d'ancre**

`lib/sync.ts` est difficile à tester unitairement (effets localStorage/Supabase). Extraire la logique testable dans `lib/cycles.ts` est déjà fait (Task 1). Ajouter un test de non-régression du diff coches par ancre dans `tests/coches-sync.test.ts` s'il n'existe pas déjà de couverture ; sinon, vérifier que `deriverOps` reste inchangé (il l'est). Étape légère : pas de nouveau test unitaire ici, la couverture est e2e (Task 9). Marquer cette étape faite après relecture.

- [ ] **Step 2 : Ajouter le store `cycle_affiche`.** Sur le modèle de `storeSemaine` (l.100-127), ajouter les clés et le store :

```ts
const CLE_CYCLE = "cycle_affiche"        // JSON { ancre, longueur }
const abonnesCycle = new Set<() => void>()
function definirCycleAffiche(ancre: string, longueur: number): void {
  localStorage.setItem(CLE_CYCLE, JSON.stringify({ ancre, longueur }))
  for (const rappel of abonnesCycle) rappel()
}
function lireCycleAffiche(): { ancre: string; longueur: number } | null {
  try { const b = localStorage.getItem(CLE_CYCLE); return b ? JSON.parse(b) : null }
  catch { return null }
}
const storeCycle = {
  sAbonner(rappel: () => void) {
    abonnesCycle.add(rappel); window.addEventListener("storage", rappel)
    return () => { abonnesCycle.delete(rappel); window.removeEventListener("storage", rappel) }
  },
  lire: lireCycleAffiche,
  lireServeur: (): null => null,
}
export function useCycleAffiche(): { ancre: string; longueur: number } | null {
  return useSyncExternalStore(storeCycle.sAbonner, storeCycle.lire, storeCycle.lireServeur)
}
```

- [ ] **Step 3 : Re-clé `semaineActive()` → `ancreActive()`.** Remplacer (l.246-249) :

```ts
// Les coches sont propres à un CYCLE (#257) : celui affiché sur /courses.
function ancreActive(): string | null {
  return lireCycleAffiche()?.ancre ?? null
}
```
Puis remplacer tous les appels `semaineActive()` de la chaîne COCHES par `ancreActive()` : `flusherCoches` (l.270), `hydraterCoches` (l.342). ⚠️ Ne PAS toucher les usages de `semaineActive()` liés au **planning** (l.585/590 `traiterChangementPlanningDistant`, l.878-879 `demarrerSync` pour l'abonnement planning) : le planning reste par semaine. Conserver `semaineActive()` pour eux.

- [ ] **Step 4 : Realtime coches par ancre.** Dans `majAbonnementCoches` (l.475-502) : topic `coches:${foyer}:${ancre}`, filtre `ancre=eq.${ancre}`. Renommer le paramètre `semaine`→`ancre` de `synchroniserAbonnementCoches` (l.468). Type `LigneArticle` (l.416-421) : `semaine`→`ancre`. `surEventCoche` (l.440) : filtrer sur `ligne.ancre !== ancre`.

- [ ] **Step 5 : Hydratation du cycle.** Dans `chargerSemaineDansCache` (l.769-796), le planning reste chargé par semaine. Ajouter une fonction sœur qui charge les coches par ancre et les 1-2 plannings du cycle :

```ts
/** Charge le cycle (jour de courses foyer) : plannings des semaines touchées +
 *  coches par ancre. Utilisé par /courses. */
async function chargerCycleDansCache(ancre: string, longueur: number): Promise<void> {
  const semaines = semainesDuCycle(ancre, longueur)
  const plannings = (await Promise.all(semaines.map((s) => chargerPlanningDistant(s))))
    .filter((p): p is Planning => p !== null)
  // Cache du planning projeté pour /courses (storePlanning porte le planning du cycle).
  const projete = planningDuCycle(plannings, ancre, longueur)
  storePlanning.ecrire(JSON.stringify(projete))
  appliquerBlobDistant(await chargerCochesDistantes(ancre))
  definirCycleAffiche(ancre, longueur)
  void synchroniserAbonnementCoches(ancre)
}
```
> Note : `/courses` lit le planning depuis `storePlanning` (cf. cartographie `app/courses/page.tsx`). Sur `/courses`, `storePlanning` contient donc le **planning projeté du cycle**. Sur `/planning`, il contient le planning de la semaine. Les deux pages ne sont jamais montées simultanément — mais pour éviter toute fuite, la page `/courses` recharge le cycle au montage (Task 8) et `/planning` recharge la semaine par défaut au montage (comportement existant `hydrater`).

- [ ] **Step 6 : Navigation + étirement.**

```ts
export async function naviguerCycle(offset: number): Promise<void> {
  const courant = lireCycleAffiche()
  if (!courant) return
  if (!(await attendreSync())) return
  const ancre = cycleDecale(courant.ancre, offset)
  const longueur = await chargerLongueurCycle(ancre)
  await chargerCycleDansCache(ancre, longueur)
}

export async function etirerCycle(longueur: number): Promise<void> {
  const courant = lireCycleAffiche()
  if (!courant) return
  await definirLongueurCycle(courant.ancre, longueur)
  await chargerCycleDansCache(courant.ancre, longueur)
}
```

- [ ] **Step 7 : Hydratation initiale `/courses`.** Ajouter un point d'entrée hydratant le cycle courant depuis le jour de courses foyer :

```ts
import { ancreCourante, LONGUEUR_DEFAUT } from "@/lib/cycles"
import { chargerJourCoursesFoyer } from "@/lib/foyer" // Task 7

/** Hydrate le cycle courant (appelé par /courses). */
export async function hydraterCycle(): Promise<void> {
  const jour = await chargerJourCoursesFoyer().catch(() => 1) // fail-open: lundi
  const aujourdhui = new Date()
  const ancre = ancreCourante(aujourdhui, jour)
  const longueur = await chargerLongueurCycle(ancre)
  await chargerCycleDansCache(ancre, longueur)
  // Purge rétention (best-effort, une fois par session) : cycles > 12 semaines.
  void purgerCyclesAvant(cycleDecale(ancre, -12)).catch(() => {})
}
```

- [ ] **Step 8 : Séparer `useSync` planning vs cycle.** `useSync()` (l.893-905) reste pour `/planning`. Ajouter `useSyncCourses()` qui démarre les abonnements coches et appelle `hydraterCycle()` au montage (au lieu de `hydrater()`), pour que `/courses` hydrate le cycle et non la semaine :

```ts
export function useSyncCourses(): void {
  useEffect(() => {
    const arreter = demarrerSync()
    void hydraterCycle()
    return arreter
  }, [])
}
```

- [ ] **Step 9 : Compilation + lint** — `npx tsc --noEmit && npm run lint`. Expected: PASS.

- [ ] **Step 10 : Commit**

```bash
git add lib/sync.ts
git commit -m "feat: sync coches par cycle (ancre) + navigation/étirement cycle (#257)"
```

---

### Task 7 : `lib/foyer.ts` — lecture/écriture du jour de courses

**Files:**
- Modify: `lib/foyer.ts` (type `EtatFoyer` l.16-26 ; `chargerFoyer` `.select(...)` l.33).

**Interfaces:**
- Produces:
  - `chargerJourCoursesFoyer(): Promise<number>` (défaut 1 si absent/erreur)
  - `definirJourCoursesFoyer(jour: number): Promise<void>` (`.update({ jour_courses })` sous grant-colonne)
  - `EtatFoyer` étendu de `jourCourses: number`.

- [ ] **Step 1 : Étendre `chargerFoyer`** pour lire `jour_courses` (ajouter au `.select`) et exposer `jourCourses` dans `EtatFoyer`. Ajouter les fonctions dédiées :

```ts
/** Jour de courses du foyer (ISO 1=lundi … 7=dimanche ; défaut 1). */
export async function chargerJourCoursesFoyer(): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("foyers").select("jour_courses").eq("id", await chargerFoyerId()).maybeSingle()
  if (error || !data) return 1
  return data.jour_courses
}

/** Écrit le jour de courses (grant-colonne : seule cette colonne est modifiable). */
export async function definirJourCoursesFoyer(jour: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from("foyers").update({ jour_courses: jour }).eq("id", await chargerFoyerId())
  if (error) throw new Error(`Réglage du jour de courses impossible : ${error.message}`)
}
```
> `chargerFoyerId()` existe déjà (`lib/persistance.ts:123`) — l'importer ou répliquer le pattern `mon_foyer()` via un select sur `profiles`. Vérifier qu'il est exporté ; sinon l'exporter.

- [ ] **Step 2 : Compilation** — `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add lib/foyer.ts lib/persistance.ts
git commit -m "feat: lecture/écriture du jour de courses foyer (#257)"
```

---

### Task 8 : `/courses` — vue cycle (en-tête, navigation, étirement)

**Files:**
- Modify: `app/courses/page.tsx`

**Interfaces:**
- Consumes: `useSyncCourses`, `useCycleAffiche`, `naviguerCycle`, `etirerCycle` de `lib/sync` ; `libelleCycle`, `LONGUEUR_MAX`, `LONGUEUR_DEFAUT` de `lib/cycles`.

- [ ] **Step 1 : Remplacer l'hydratation.** Remplacer `useSync()` (l.134) par `useSyncCourses()`. Remplacer l'en-tête de semaine (l.241-244 `formaterSemaine(semainePlanning)`) par le libellé de cycle et le navigateur.

- [ ] **Step 2 : Ajouter navigateur + étirement dans l'en-tête** (mobile-first, patron du navigateur de `app/planning/page.tsx`) :

```tsx
const cycle = useCycleAffiche()
// … dans l'en-tête, à la place de formaterSemaine(semainePlanning) :
{cycle && (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-2">
      <button type="button" aria-label="Cycle précédent"
        onClick={() => void naviguerCycle(-1)}
        className="rounded-full p-2 text-brand-700 transition hover:bg-brand-50 active:scale-95">
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      <span className="font-display text-lg font-semibold">
        {libelleCycle(cycle.ancre, cycle.longueur)}
      </span>
      <button type="button" aria-label="Cycle suivant"
        onClick={() => void naviguerCycle(1)}
        className="rounded-full p-2 text-brand-700 transition hover:bg-brand-50 active:scale-95">
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
    <div className="flex items-center gap-2 text-sm text-brand-700">
      <span>Couvre {cycle.longueur} j</span>
      <button type="button" aria-label="Réduire d'un jour"
        disabled={cycle.longueur <= 1}
        onClick={() => void etirerCycle(cycle.longueur - 1)}
        className="rounded-full border border-brand-200 px-2 transition active:scale-95 disabled:opacity-40">−</button>
      <button type="button" aria-label="Ajouter un jour"
        disabled={cycle.longueur >= LONGUEUR_MAX}
        onClick={() => void etirerCycle(cycle.longueur + 1)}
        className="rounded-full border border-brand-200 px-2 transition active:scale-95 disabled:opacity-40">+</button>
    </div>
  </div>
)}
```
Importer `ChevronLeft, ChevronRight` de `lucide-react` (règle no-emoji-icons ; le `−/+` du stepper suit le patron des steppers existants — vérifier s'il existe déjà un composant stepper à réutiliser, sinon garder ces boutons texte comme les steppers de personnes).

- [ ] **Step 3 : Retirer `semainePlanning`** (l.158-168) devenu inutile pour l'en-tête (le planning en cache est déjà le projeté du cycle ; la liste `genererListeCourses(JSON.parse(brutPlanning))` fonctionne telle quelle sur le planning projeté).

- [ ] **Step 4 : Vérifier les 3 états** loading/error/empty inchangés (le empty `liste === null` reste valable : cycle vide → planning projeté sans jours → `genererListeCourses` renvoie une liste vide, adapter le empty pour couvrir « aucun repas planifié sur ce cycle » avec lien `/planning`).

- [ ] **Step 5 : Vérifier build + lint** — `npm run lint && npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add app/courses/page.tsx
git commit -m "feat: /courses en vue cycle (navigation + étirement) (#257)"
```

---

### Task 9 : Réglage « jour de courses » dans `PanneauFoyer`

**Files:**
- Modify: `components/profil/panneau-foyer.tsx`

**Interfaces:**
- Consumes: `EtatFoyer.jourCourses`, `definirJourCoursesFoyer` de `lib/foyer`.

- [ ] **Step 1 : Ajouter une section « Jour de courses »** (patron `SegmentPlafond`/`SelecteurTheme`, `role="radiogroup"`), après le bandeau membres. Sélecteur segmenté 7 jours (L M M J V S D), écrit via `definirJourCoursesFoyer` puis `rafraichir()` :

```tsx
const JOURS = [
  { v: 1, l: "L", nom: "lundi" }, { v: 2, l: "M", nom: "mardi" },
  { v: 3, l: "M", nom: "mercredi" }, { v: 4, l: "J", nom: "jeudi" },
  { v: 5, l: "V", nom: "vendredi" }, { v: 6, l: "S", nom: "samedi" },
  { v: 7, l: "D", nom: "dimanche" },
]
// … dans le rendu chargé :
<section className="mb-6 rounded-2xl border border-brand-100 bg-surface p-4"
  aria-labelledby="titre-jour-courses">
  <h2 id="titre-jour-courses" className="mb-1 font-medium">Jour de courses</h2>
  <p className="mb-3 text-sm text-brand-700">
    Ta liste de courses couvre 7 jours à partir de ce jour.
  </p>
  <div role="radiogroup" aria-label="Jour de courses"
    className="inline-flex rounded-full border border-brand-200 bg-surface p-0.5">
    {JOURS.map((j) => {
      const actif = etat.jourCourses === j.v
      return (
        <button key={j.v} type="button" role="radio" aria-checked={actif}
          aria-label={j.nom} title={j.nom}
          onClick={async () => { await definirJourCoursesFoyer(j.v); await rafraichir()
            toast.success(`Jour de courses : ${j.nom}`) }}
          className={`min-w-9 rounded-full px-3 py-1.5 text-sm transition active:scale-95 ${
            actif ? "bg-primary text-white" : "text-brand-700 hover:bg-brand-50"}`}>
          {j.l}
        </button>
      )
    })}
  </div>
</section>
```

- [ ] **Step 2 : Vérifier lint + build** — `npm run lint && npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add components/profil/panneau-foyer.tsx
git commit -m "feat: réglage jour de courses dans le panneau foyer (#257)"
```

---

### Task 10 : e2e — projection cycle + reset du réglage foyer partagé

**Files:**
- Modify: `e2e/helpers.ts` (ajout `reinitialiserJourCoursesDistant`)
- Create: `e2e/cycle-courses.spec.ts`

**Interfaces:**
- Consumes: helpers REST existants (`nettoyerEtatDistant`, pattern PATCH).

- [ ] **Step 1 : Helper de reset (⚠️ `jour_courses` est FOYER-level sur le compte partagé).**

```ts
// e2e/helpers.ts — remet le jour de courses du foyer de test à lundi (1),
// sinon une spec le laisse à jeudi → les autres specs divergent.
export async function reinitialiserJourCoursesDistant(): Promise<void> {
  await fetch(`${URL}/rest/v1/foyers?id=eq.${await foyerIdDeTest()}`, {
    method: "PATCH",
    headers: { apikey: ANON, Authorization: `Bearer ${jetonDeTest()}`,
      "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ jour_courses: 1 }),
  })
}
```
> Adapter aux helpers existants (récupération du jeton/foyer). S'inspirer de `nettoyerReglagesDistants`.

- [ ] **Step 2 : Spec (CI-only, génération réelle sur staging seedé).**

```ts
// e2e/cycle-courses.spec.ts
import { test, expect } from "@playwright/test"
import { nettoyerEtatDistant, reinitialiserJourCoursesDistant } from "./helpers"

test.beforeEach(async () => { await nettoyerEtatDistant(); await reinitialiserJourCoursesDistant() })
test.afterAll(async () => { await reinitialiserJourCoursesDistant() })

test("le jour de courses réancre la liste (aucune régression en défaut lundi)", async ({ page }) => {
  await page.goto("/courses")
  // défaut lundi/7 : la liste se comporte comme avant (état vide sans planning)
  await expect(page.getByRole("heading")).toBeVisible()
})

test("changer le jour de courses puis naviguer les cycles", async ({ page }) => {
  await page.goto("/profil")
  await page.getByRole("radio", { name: "jeudi" }).click()
  await page.goto("/courses")
  await expect(page.getByText(/Courses du/)).toBeVisible()
  await page.getByRole("button", { name: "Cycle suivant" }).click()
  await expect(page.getByText(/Courses du/)).toBeVisible()
})
```

- [ ] **Step 3 : Enregistrer la spec dans la topologie CI.** `playwright.config.ts` : la spec écrit le compte partagé → groupe `e2e-partage`. Vérifier qu'elle passe en série (workers:1). Ne PAS l'ajouter à `SPECS_JETABLE`.

- [ ] **Step 4 : Commit**

```bash
git add e2e/helpers.ts e2e/cycle-courses.spec.ts playwright.config.ts
git commit -m "test: e2e cycle de courses + reset jour_courses foyer (#257)"
```

---

### Task 11 : Documentation (critère de merge)

**Files:**
- Modify: `CLAUDE.md`, `SPECS_FONCTIONNELLES.md`, `CHANGELOG.md`

- [ ] **Step 1 : `CLAUDE.md`** — ajouter un piège « **Cycle de courses = projection par-dessus la semaine ISO (#257)** » : `/courses` fenêtrée par cycle ; coches re-clées `semaine`→`ancre` ; `jour_courses` réglage FOYER (défaut lundi → cycle ≡ semaine ISO) ; `lib/cycles.ts` pur ; store `cycle_affiche` dans `lib/sync.ts` ; `useSyncCourses()` vs `useSync()` ; piège e2e `jour_courses` foyer partagé à reset.

- [ ] **Step 2 : `SPECS_FONCTIONNELLES.md`** — nouvelles US (cycle de courses) + RG associées (fenêtre, ancre, longueur, rétro-compat).

- [ ] **Step 3 : `CHANGELOG.md`** — section `[Unreleased]` : « Liste de courses fenêtrée sur un cycle ancré sur le jour de courses du foyer ».

- [ ] **Step 4 : Commit**

```bash
git add CLAUDE.md SPECS_FONCTIONNELLES.md CHANGELOG.md
git commit -m "docs: cycle de courses (#257)"
```

---

## Self-Review

**Couverture spec (design §4-6, 9-11)** :
- §4 modèle de données → Tasks 3-4-5-7 ✓
- §5 cœur pur `lib/cycles.ts` → Tasks 1-2 ✓
- §6 UX + sync/realtime → Tasks 6-8-9 ✓
- §9 edge cases : chevauchement (longueur > 7 gérée par `joursDuCycle`/`planningDuCycle`, doublons de jour conservés ✓) ; changement de jour (prochain cycle via `ancreCourante` au montage ✓) ; cycle vide (Task 8 step 4 ✓) ; purge (Task 5 ✓).
- §11 tests → Tasks 1-2-10 ✓

**Placeholders** : les seuls points « adapter aux helpers existants » (Task 10) et « vérifier si un stepper existe » (Task 8) sont des renvois à des patrons cités, pas des TBD de logique. Acceptable.

**Cohérence des types** : `ancre: string` (ISO date) partout ; `longueur: number` ; `jour_courses`/`jourCourses` = smallint ISO 1-7. `ancreActive()` (sync) ↔ `ancre` (persistance) ↔ `ancre` (cycles) cohérents. Coches : `chargerCochesDistantes(ancre)`, `cocher/decocher/viderArticleDistant(ancre, …)` alignés Task 5 ↔ Task 6.

**Dépendances inter-tâches** : 1→2→(3,4)→5→6→(7 avant 6 step 7 : `chargerJourCoursesFoyer`)→8→9→10→11. Note : Task 7 fournit `chargerJourCoursesFoyer` consommé par Task 6 step 7 → **exécuter Task 7 avant de finaliser Task 6** (ou stubber temporairement). Réordonnancement suggéré à l'exécution : 1,2,3,4,5,7,6,8,9,10,11.
</content>
