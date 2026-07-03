# Design — Cycle de courses (fenêtre non calendaire)

> Date : 2026-07-03
> Statut : design validé, prêt pour plan d'implémentation
> Épopée cible : à créer dans GitHub Projects (issue)

---

## 1. Problème & besoin

### Remontée utilisateur
Les utilisateurs ne font pas leurs courses pour une **semaine calendaire** (lundi→dimanche),
mais sur une fenêtre glissante ancrée sur **leur jour de courses** (« du jeudi au jeudi »,
« du vendredi au vendredi »).

### Douleur dominante (issue de la discovery)
La plaie n'est **pas** la génération ni l'ordre d'affichage des jours — c'est la **liste de
courses** :

1. Une virée du jeudi couvre deux semaines ISO → **deux listes de courses** à réconcilier
   manuellement.
2. La liste « semaine en cours » contient des **reliquats** (lundi→mercredi) déjà achetés lors
   de la virée précédente → bruit, risque de racheter.

### Job To Be Done
> « Quand je pars faire les courses, je veux **une seule liste** qui couvre exactement les repas
> que je vais acheter jusqu'à ma prochaine virée, sans reliquat, quel que soit le découpage
> calendaire. »

---

## 2. Décisions produit (validées en interview)

| # | Décision |
|---|----------|
| D1 | Concept **« cycle de courses »** = fenêtre `ancre (jour de courses) + longueur` (défaut 7 j, étirable ponctuellement). |
| D2 | La **liste de courses** agrège exactement les repas du cycle → une liste, zéro reliquat. **Must.** |
| D3 | La **génération** doit pouvoir remplir tout le cycle d'un coup (« Générer mon cycle »). **Strong nice-to-have.** |
| D4 | Une **vue planning calée sur le cycle** (voir « quoi jusqu'à quand » + liste associée). **Bonus.** |
| D5 | La **vue planning calendaire** (lundi→dimanche) reste **inchangée** : c'est le driver du « on mange quoi ce soir ? ». |
| D6 | `/courses` devient **cycle-only** (plus de liste calendaire). |
| D7 | Le **jour de courses** est un réglage **au niveau du FOYER** (pas par utilisateur), car les coches sont partagées au foyer. |
| D8 | Bascule de cycle **le jour de courses** : le cycle reste actif jusqu'à la veille de la prochaine virée ; on peut **anticiper** le cycle suivant par navigation. |
| D9 | Navigation **cycle par cycle** sur `/courses` (miroir du navigateur semaine de `/planning`). Deux navigations coexistent, assumé. |
| D10 | La liste reste consultable **plusieurs jours** (courses faites en plusieurs fois). |

### Distinction cadence vs longueur (clarifiée)
- **Cadence** = espacement des ancres = **quand démarre le cycle suivant**. **Fixe hebdomadaire**
  (prochain jour de courses = +7 j). Hypothèse assumée : pas de cadence bihebdomadaire en V1
  (extension future possible via une colonne `cadence`).
- **Longueur** = **combien de jours de repas la liste couvre**. Défaut 7, **étirable à 8-9-N**
  (les 20 % de cas). Découplée de la cadence : étirer à 9 j ne décale **pas** le cycle suivant
  (toujours +7). Conséquence : un cycle de 9 j **chevauche** de 2 jours le suivant (voir §7).

---

## 3. Approche retenue

**Projection légère : le cycle est une VUE par-dessus le stockage par semaine ISO existant.**

Le stockage du planning reste **par semaine ISO** (lundi→dimanche, 14 slots, `foyer_id + semaine`).
On ajoute une **couche de projection** (`lib/cycles.ts`) qui lit les slots des 1-2 semaines qu'une
fenêtre touche, filtre par date, et agrège. La vue calendaire quotidienne est **intacte**, le
changement est **incrémental** et **réversible**.

Approches écartées :
- **Cycle natif** (ré-ancrer tout le modèle sur le cycle) : réécrit génération, persistance,
  realtime, historique, ancrage saison, rétention, navigation → risque massif, fragilise la vue
  calendaire (driver principal). Rejeté.
- **MVP « liste seulement »** sans entité cycle : coches cross-semaine bancales, pas de longueur
  persistée, pas de navigation/anticipation → ne couvre pas D8/D9. Rejeté.

**Invariant central** : `lib/generateur.ts` et la persistance planning par semaine ne changent
pas ; `lib/cycles.ts` est une projection.

---

## 4. Modèle de données

### 4.a Réglage foyer
Nouvelle colonne :
```sql
alter table foyers add column jour_courses smallint not null default 1; -- 1=lundi … 7=dimanche (ISO)
```
Écriture client via le **pattern profil (#22 PR1)** — la table `foyers` n'a volontairement aucune
policy d'écriture client (tout passe par SECURITY DEFINER) :
```sql
grant update (jour_courses) on foyers to authenticated;
create policy "foyers: reglage jour_courses" on foyers for update
  using (id = mon_foyer()) with check (id = mon_foyer());
```
Le `grant` **au niveau colonne** empêche le client de toucher `code_invitation` / `expire_le`.

### 4.b Entité cycle (légère, paresseuse)
```sql
create table cycle_courses (
  foyer_id  uuid       not null default mon_foyer() references foyers(id),
  ancre     date       not null,                 -- date du jour de courses
  longueur  smallint   not null default 7,       -- jours couverts (étirement)
  updated_at timestamptz not null default now(),
  primary key (foyer_id, ancre)
);
-- RLS foyer (select/insert/update/delete = foyer_id = mon_foyer()), trigger set_updated_at.
```
Une ligne n'existe **que si la longueur est étirée** (les 80 % à 7 j n'écrivent rien → longueur
déduite = défaut 7).

### 4.c Coches re-clées par cycle
`etat_courses_article` : `semaine text` → `ancre date`.
- PK `(foyer_id, ancre, cle)`, index `(foyer_id, ancre)`, `replica identity full`, publication
  realtime, RLS foyer, trigger horodatage : **inchangés** (seul le nom de la clé change).
- Filtre realtime : `semaine=eq.X` → `ancre=eq.Y`.

### 4.d Rétro-compatibilité (point clé)
`jour_courses` **défaut = lundi (1)** + longueur 7 → le cycle par défaut **est exactement la
semaine ISO lundi→dimanche actuelle**. Donc **zéro changement de comportement observable** tant
que l'utilisateur ne choisit pas un autre jour.

Migration des coches existantes :
```sql
-- ancre = lundi de la semaine ISO de chaque coche existante
alter table etat_courses_article add column ancre date;
update etat_courses_article set ancre = <lundi(semaine)>;  -- via helper SQL calendaire
-- puis bascule de PK semaine → ancre, drop colonne semaine.
```
Purge de rétention re-câblée sur l'ancre (cycles dont l'ancre < aujourd'hui − 12 semaines).

---

## 5. Cœur logique pur (`lib/cycles.ts`)

Module pur, testable sans réseau (esprit `lib/semaines.ts`) :

| Fonction | Rôle |
|----------|------|
| `ancreCourante(aujourdhui, jourCourses)` | Dernière occurrence du jour de courses **≤ aujourd'hui** (bascule D8). |
| `cycleDecale(ancre, n)` | Ancre ± n×7 j (navigation D9). |
| `joursDuCycle(ancre, longueur)` | Liste des **dates concrètes** du cycle. |
| `dateVersSemaineJour(date)` | `(semaineISO, jour)` — pont vers le stockage par semaine ISO. |
| `libelleCycle(ancre, longueur)` | « Courses du 9 au 15 juillet » (affichage). |
| Bornes de navigation | Miroir des bornes −12/+6 semaines. |

**Agrégation** : réutilise `genererListeCourses` (lib/courses.ts). Nouvelle fonction
`slotsDuCycle(planningsParSemaine, ancre, longueur)` : collecte les slots des 1-2 semaines
touchées, **filtre par date** (jours du cycle), exclut les « restes » (RG-22 inchangé), passe à
`genererListeCourses` → **une** liste pile la fenêtre, zéro reliquat.

---

## 6. UX & câblage temps réel

### 6.a Réglage « jour de courses » (foyer)
Dans **`PanneauFoyer` sur `/profil`** (là où vivent les réglages foyer). Sélecteur jour lun→dim.
Changement → n'affecte que les cycles **futurs** (ancres/coches passées figées).

### 6.b `/courses` = vue cycle
- En-tête : `libelleCycle` + navigateur **‹ cycle précédent / suivant ›** (bornes ≈ −12/+6).
- Store local `cycle_affiche` (ancre), séparé de `semaine_affichee`.
- Défaut = `ancreCourante` (bascule D8) ; anticipation via « → ».

### 6.c Étirer la longueur (les 20 %)
Contrôle discret en-tête : **« Couvre 7 j [− / +] »**. Le `+` écrit `cycle_courses.longueur`
(création paresseuse) ; recalcul instantané (jours ajoutés lus dans la semaine ISO suivante).
Retour à 7 = suppression de l'override. Borné (7→14).

### 6.d Sync / temps réel (`lib/sync.ts`)
- Hydratation `/courses` : charge les **1-2 semaines** que le cycle touche (par plage de dates),
  puis projette via `slotsDuCycle`.
- Coches : `semaineActive()` → **`cycleActif()` (ancre)** ; diff par-article (`deriverOps`,
  RG-32) et abonnement realtime passent sur `ancre` ; blob localStorage indexé par ancre.
- Présence « en magasin » (RG-31) : **inchangée** (scope foyer).
- Invalidation RG-13 (régé vide les coches) : re-câblée par cycle.

### 6.e `/planning` calendaire
**Rien ne bouge** (navigation semaine, `semaine_affichee`). Les deux navigations coexistent.

---

## 7. Génération fenêtrée (strong NTH — PR2)

- `POST /api/planning/generer` accepte `{ancre, longueur}` (mode semaine existant conservé pour
  `/planning`).
- `lib/generateur.ts` **inchangé** : on lui demande les 14 slots du cycle (saison = celle de
  l'ancre), il applique éligibilité/biais/variété comme aujourd'hui.
- **Point dur** : la RPC `sauvegarder_planning` **remplace toute la semaine** → elle écraserait les
  jours des cycles voisins. Nouvelle **RPC `sauvegarder_slots(p_semaine, p_slots)`** qui
  **upsert seulement les (jour, type) fournis** (atomique, SECURITY DEFINER, foyer dérivé, bump
  `version`), laissant les autres jours intacts. La génération de cycle écrit dans les 1-2 semaines
  touchées sans toucher au reste. La vue calendaire d'une semaine devient un assemblage cohérent de
  2 cycles (slots indépendants).

---

## 8. Vue planning calée cycle (bonus — PR3)

Bascule sur `/planning` : **« Semaine | Cycle »**. La vue cycle rend `joursDuCycle` en réutilisant
les cartes planning existantes ; l'édition écrit dans les slots semaine sous-jacents (gardes
« semaine passée » #5 PR3 réutilisées). Minimal, lecture d'abord.

---

## 9. Edge cases

| Cas | Traitement |
|-----|------------|
| **Chevauchement** (cycle 9 j mord 2 j sur le suivant) | Les 2 repas apparaissent dans les 2 listes ; coches indépendantes par cycle. Assumé (D1/longueur). |
| **Changement de jour de courses** | Prend effet au **prochain cycle** ; ancres/coches passées restent accessibles en navigation. |
| **Cycle vide** (pas de planning sur ces jours) | État empty standard. |
| **Frontière de saison dans un cycle** | Saison = ancre du cycle (rare, mineur). |
| **Alerte « en magasin » (#56 PR5)** | La génération fenêtrée bumpe la `version` de 1-2 semaines → l'abonnement surveille les semaines touchées par le cycle affiché (adaptation du filtre). |
| **Assemblage calendaire** (semaine remplie par 2 cycles) | Cohérent, slots indépendants. |

---

## 10. Découpage en PRs

| PR | Contenu | Priorité |
|----|---------|----------|
| **PR1a** | Migration (`jour_courses`, `cycle_courses`, re-clé coches + backfill lundi, purge) + `lib/cycles.ts` + tests unitaires. Défaut lundi/7 → **zéro changement observable**. | Socle (must) |
| **PR1b** | `/courses` projection cycle + navigation + étirement longueur + réglage foyer `/profil` + re-clé sync/realtime. | **Must (la valeur)** |
| **PR2** | RPC `sauvegarder_slots` + route `{ancre,longueur}` + bouton « Générer mon cycle ». | Strong NTH |
| **PR3** | Vue planning cycle (toggle `/planning`). | Bonus |

**Ordre migrations (staging partagé)** : merger la PR-migration (PR1a) **en premier**, puis
`git merge main` dans les branches suivantes.

---

## 11. Tests & pièges

- **Unit** : `lib/cycles.ts` (bascule ancre, `joursDuCycle`, `cycleDecale`, round-trip
  date↔semaine/jour, `libelleCycle`), `slotsDuCycle` (agrégation sur 2 semaines), diff coches par
  cycle.
- **e2e** :
  - ⚠️ **`jour_courses` est FOYER-level sur le compte de test partagé** → une spec qui le change
    casse les autres. Le réinitialiser en `beforeEach`/`afterAll` (comme `nettoyerReglagesDistants`)
    ou utiliser un compte jetable.
  - Génération de cycle = **CI-only** (staging seedé).
  - Coches realtime par cycle : deux contextes (même compte), mêmes contraintes que
    `coches-realtime.spec`.
- **Migration** : merger la PR-migration en 1er (staging partagé).

---

## 12. Documents à mettre à jour à l'implémentation

- `SPECS_FONCTIONNELLES.md` : nouvelles US (cycle de courses, génération fenêtrée, vue cycle) +
  règles métier (RG-xx) associées.
- `CLAUDE.md` : nouveau piège « cycle = projection par-dessus semaine ISO », re-clé coches
  semaine→ancre, réglage `jour_courses` foyer, RPC `sauvegarder_slots`.
- `CHANGELOG.md` : section `[Unreleased]`.
</content>
</invoke>
