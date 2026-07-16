# Design — Cohérence Semaine/Cycle (planning ↔ courses)

> Date : 2026-07-16
> Statut : design validé, prêt pour plan d'implémentation
> Issue cible : #279

---

## 1. Problème & besoin

### Remontée utilisateur

Interview post-livraison de l'épopée Cycle de courses (#257/#259/#260), 2-3 utilisateurs (dont
la conjointe d'Arnaud). Quatre retours distincts, tous de type confusion UX :

1. Impossible de générer le planning depuis la vue Cycle de `/planning` — obligation de jongler
   entre 2 vues, faire des sauts de semaine en vue Semaine pour générer, puis revenir en vue
   Cycle vérifier.
2. La liste de courses n'est pas la même selon la vue d'où on y arrive (cycle ou calendaire) —
   compliqué de savoir sur quelle liste on est, impossible de passer de l'une à l'autre sans
   repasser par le planning.
3. L'affichage des semaines semble différent entre la vue courses et la vue planning.
4. Le choix de vue (Semaine/Cycle) n'est pas mémorisé — retombe sur la vue calendaire par défaut
   à chaque ouverture de l'app, alors que certains utilisateurs préfèrent vivre en vue Cycle.

### Diagnostic racine (vérifié en code)

Les 4 retours pointent un seul problème de fond : **le modèle Cycle a été greffé sur le modèle
Semaine sans continuité perçue.** Concrètement, trois états de navigation coexistent sans lien :

| État | Où | Persisté ? |
|---|---|---|
| `semaineAffichee` | `/planning` vue Semaine (store `useSemaineAffichee`) | Oui (localStorage) |
| `ancre`/`longueur` de `VuePlanningCycle` | `/planning` vue Cycle | **Non** — state local, reset à chaque montage |
| `cycle_affiche` | `/courses` (store `lib/sync.ts`) | Oui (localStorage) |

Les liens « Liste de courses → » (vue Semaine et vue Cycle de `/planning`) pointent tous les
deux vers `href="/courses"` en dur, sans paramètre — `/courses` rouvre donc systématiquement
**sa propre dernière position mémorisée**, jamais celle que l'utilisateur regardait sur
`/planning`.

Par ailleurs, la génération fenêtrée « Générer mon cycle » (#259) persiste déjà **par RPC
`sauvegarder_slots`**, indépendamment de `storePlanning`/`useSync` (mono-semaine) — la décision
« lecture seule » de #260 §8 portait sur l'**édition de slot** (changer/personnes/restes), pas
sur la génération en masse. Rendre la génération accessible depuis la vue Cycle ne rouvre donc
PAS l'édition mono-semaine et ne contredit pas #260 §8.

### Job To Be Done

> « Que je sois en train de piloter mon planning ou de préparer mes courses, je veux une
> continuité : la même fenêtre temporelle, le même moyen de générer, un choix de vue qui reste
> le mien d'une session à l'autre. »

---

## 2. Décisions produit (validées en interview)

| # | Décision |
|---|----------|
| D1 | Les 4 sous-problèmes sont traités en **un seul chantier** (même thématique, une spec/un plan/une PR). |
| D2 | La génération « Générer mon cycle » devient accessible **directement depuis la vue Cycle de `/planning`**, sans quitter la page. |
| D3 | L'état de navigation **Cycle (planning) et Cycle (courses) est unifié** en un seul store partagé. |
| D4 | Naviguer en vue Semaine (`/planning`) puis aller sur `/courses` **dérive automatiquement** le cycle qui contient la semaine affichée. |
| D5 | Le choix de vue Semaine/Cycle est **persisté** (localStorage), survit au reload. |
| D6 | Les **formats d'affichage de la période restent distincts** entre vue Semaine et vue Cycle (concepts réellement différents) — seule la mise en page de l'en-tête est harmonisée pour une transition visuelle douce. |

---

## 3. Approche retenue

### 3.a Génération depuis la vue Cycle (D2)

Extraire la logique de `genererMonCycle` (`app/courses/page.tsx:267-308`) dans un hook partagé,
par ex. `useGenerationCycle(cycle: {ancre, longueur} | null)` (nouveau fichier,
`lib/hooks/generation-cycle.ts` ou co-localisé dans `lib/sync.ts` à côté d'`appliquerGenerationCycle`) qui
expose `{ enGeneration, genererMonCycle }`. `app/courses/page.tsx` et `components/planning/vue-cycle.tsx`
consomment ce même hook.

`VuePlanningCycle` gagne un bouton « Générer mon cycle » (même style que sur `/courses`,
`Sparkles` + `bg-primary`), affiché dans son en-tête à côté du navigateur de cycle. Après
génération réussie, la vue recharge sa projection (`chargerCycle(ancre)`, déjà existant) pour
refléter le nouveau contenu — pas de nouvelle mécanique de rafraîchissement à inventer.

### 3.b Store cycle unifié (D3)

`VuePlanningCycle` cesse de maintenir `ancre`/`longueur` en `useState` local. Elle consomme le
store `cycle_affiche` de `lib/sync.ts` via le hook déjà exporté `useCycleAffiche()` (utilisé par
`/courses`). Vérifié en code : `lib/sync.ts` n'exporte aujourd'hui que `useCycleAffiche()`,
`useCyclePlanning()`, `hydraterCycle()` et `naviguerCycle(offset)` (navigation **relative**,
`cycleDecale` en interne) — `definirCycleAffiche`/`chargerCycleDansCache` sont **privées** au
module. Pour la navigation par chevrons (± 1 cycle) de `VuePlanningCycle`, `naviguerCycle(offset)`
suffit tel quel (mêmes chevrons que `/courses`). Le montage initial appelle `hydraterCycle()` si
`cycle_affiche` n'est pas encore hydraté (même garde que `/courses`).

Conséquence directe : naviguer le cycle depuis `/planning` (vue Cycle) ou depuis `/courses`
déplace le **même pointeur** — revenir sur l'une ou l'autre page affiche toujours la même
fenêtre.

### 3.c Dérivation auto Semaine → Courses (D4)

Le lien « Liste de courses → » de la vue **Semaine** (`app/planning/page.tsx:707-712` et
`:820-825`) ne pointe plus vers `/courses` en dur : avant navigation, on calcule l'ancre du
cycle qui contient `semaineAffichee` :

```
refDate = jeudi de semaineAffichee (cohérent avec semaineISO, cf. lib/semaines.ts)
ancreCible = ancreCourante(refDate, jourCoursesFoyer)
```

et on appelle une nouvelle fonction exportée `allerAuCycle(ancreCible: string): Promise<void>`
(`lib/sync.ts`, miroir de `naviguerCycle(offset)` mais en ancre **absolue** — même corps que
`naviguerCycle` sans le `cycleDecale` relatif : flush des écritures en attente, lecture de la
longueur via `chargerLongueurCycle`, puis `chargerCycleDansCache`) avant de naviguer vers
`/courses` — pas de query param d'URL nécessaire puisque `/courses` lit désormais le même store.

**Limitation acceptée** : `ancreCourante` calcule l'ancre de la **grille hebdomadaire standard**
(espacement fixe 7 j, cf. `lib/cycles.ts` — la cadence est toujours hebdomadaire, cf. design
#257 §2 D8). Si un cycle a été étiré manuellement (`longueur` > 7 pour une ancre donnée) au
point de chevaucher l'ancre calculée, ce chevauchement n'est pas résolu ici — `/courses` affichera
l'ancre standard avec sa propre longueur mémorisée (`chargerLongueurCycle`, déjà existant), pas
forcément la longueur du cycle étiré voisin. Cas rare (nécessite une navigation par semaine
combinée à un étirement manuel), non traité en V1.

La vue **Cycle** de `/planning`, elle, n'a plus besoin de dériver quoi que ce soit pour son
propre lien vers `/courses` : le store étant unifié (§3.b), le lien devient un simple
`<Link href="/courses">` sans calcul, la fenêtre affichée est déjà la même des deux côtés.

### 3.d Persistance du choix de vue (D5)

Nouveau store dans `lib/stockage.ts`, pattern `storeSemaine` (valeur **primitive** string, donc
aucun risque du piège `getSnapshot` objet non mémoïsé, cf. CLAUDE.md) : clé localStorage
`vue_planning`, valeurs `"semaine" | "cycle"`. `app/planning/page.tsx:324` remplace son
`useState` nu par ce store. Défaut si absent : `"semaine"` (comportement actuel inchangé pour
les utilisateurs n'ayant jamais touché à la bascule).

### 3.e Format d'affichage (D6)

Aucun changement de `formaterSemaine`/`libelleRelatif`/`libelleCycle` (`lib/semaines.ts`,
`lib/cycles.ts`). Seul ajustement : harmoniser la position et le style visuel (taille de texte,
emplacement dans l'en-tête) du libellé de période entre les deux branches de rendu de
`app/planning/page.tsx` (vue Semaine vs vue Cycle), pour que la bascule ne produise pas de saut
de layout perceptible.

---

## 4. Fichiers impactés (vue d'ensemble)

| Fichier | Changement |
|---|---|
| `lib/sync.ts` | Nouvelle fonction exportée `allerAuCycle(ancre)` (ancre absolue, miroir de `naviguerCycle`) ; nouveau hook `useGenerationCycle` (ou co-localisation). |
| `lib/stockage.ts` | Nouveau store `vue_planning` (pattern primitif, cf. `storeSemaine`). |
| `app/courses/page.tsx` | Consomme le hook de génération partagé au lieu de sa fonction locale `genererMonCycle`. |
| `components/planning/vue-cycle.tsx` | Consomme `cycle_affiche` (au lieu d'un state local) ; ajoute le bouton « Générer mon cycle » ; retire son propre calcul d'ancre par défaut si le store est déjà hydraté. |
| `app/planning/page.tsx` | Lien Semaine→Courses dérive l'ancre cible avant navigation ; `vue` vient du nouveau store persistant ; harmonisation visuelle de l'en-tête des deux branches. |
| `lib/cycles.ts` | Pas de changement de logique (réutilisation de `ancreCourante` existant). |

---

## 5. Hors scope / limitations connues

- Le chevauchement cycle étiré / ancre dérivée (§3.c) n'est pas résolu — limitation documentée,
  pas un bug bloquant.
- Aucun changement du modèle de données, aucune migration Supabase.
- Le format d'affichage de la période (vocabulaire Semaine vs Cycle) reste volontairement
  distinct (D6) — ne pas réinterpréter cette limitation comme un oubli lors de l'implémentation.

---

## 6. Tests à prévoir

- Unitaire : `ancreCourante` appliqué à une date arbitraire (pas seulement « aujourd'hui ») —
  déjà couvert si la fonction est pure et déjà testée dans `tests/cycles.test.ts` ; ajouter un
  cas pour la dérivation Semaine→Courses si un nouveau petit helper est extrait.
  Store `vue_planning` : lecture/écriture/valeur par défaut (pattern `storeSemaine`, cf. tests
  existants de `lib/stockage.ts` si présents).
- e2e (`planning.spec`, CI-only, génération réelle) : bouton « Générer mon cycle » visible et
  fonctionnel depuis la vue Cycle ; navigation Semaine→Courses affiche la fenêtre attendue ;
  choix de vue persistant après reload.
