---
paths:
  - "lib/sync*.ts"
  - "lib/stockage.ts"
  - "lib/persistance.ts"
  - "lib/coches-sync*.ts"
  - "lib/planning-diff*.ts"
  - "lib/adapters*.ts"
  - "app/planning/**"
  - "components/ui/alerte-modif-planning.tsx"
---

# Synchronisation multi-appareil et temps réel

La base est la source de vérité ; localStorage est le cache de la semaine affichée. Tout le mécanisme vit dans `lib/sync.ts`, la couche d'accès dans `lib/persistance.ts`. Pour `/courses` et le cycle, voir aussi `courses-cycle.md`.

## Planning : cache local, push débouncé, horloge serveur

- `useSync()` (page `/planning`) hydrate au montage. Un gestionnaire abonné à `storePlanning` pousse en base (débounce 800 ms) à chaque écriture locale, sans qu'aucun handler de page n'ait à le faire.
- **Écriture planning = RPC atomique** `sauvegarder_planning(p_semaine, p_slots)` : upsert par (foyer, semaine), qui **remplace toute la semaine**. Le foyer est dérivé côté serveur.
- **Dirty-first** : une édition pose `planning_dirty` et, tant qu'il est posé, **le local fait foi**. Un pull n'a lieu que si le cache est vide ou si l'`updated_at` serveur est **strictement** plus récent que `planning_courant_maj`. Un cache non horodaté (offline, injecté en test) compte comme le plus frais.
- **Horloge 100 % serveur** : un trigger SQL `BEFORE INSERT OR UPDATE` pose `updated_at = now()` et écrase toute valeur client. Les payloads omettent donc `updated_at`, et le client lit la valeur renvoyée par le RETURNING.
- Les `pousser*()` sont **sérialisés** (garde anti-concurrence), pour éviter `duplicate key` et les échecs RLS.
- **Historique** : les semaines s'accumulent en base. `hydrater` purge une fois par session ce qui précède `semaineDecalee(courante, -12)` (fire-and-forget, garde `dejaPurge`).

## Rechargements après édition

- **Jamais de `setChargement(true)` sur un rechargement post-édition.** Une édition met l'état local à jour de façon optimiste ; seuls le montage, la navigation et la génération affichent « Chargement… ». Pourquoi : l'état de chargement démonte la grille (scroll, menus, stepper perdus) le temps d'un aller-retour réseau (#301).
- **Tout patch de `storePlanning` qui reflète une écriture déjà faite en base passe sous la garde `hydratationEnCours`** (cf. `modifierSlotDistant`). Pourquoi : sinon `planifierPush` relance un `sauvegarder_planning` de toute la semaine (double écriture).

## Navigation entre semaines

- Semaine affichée : store `useSemaineAffichee` (clé `semaine_affichee`). `planning_courant` / `courses_cochees` sont le cache **de cette semaine**.
- `naviguerVers(semaine)` **flushe d'abord les écritures en attente** (`attendreSync`) puis charge la cible (gardes d'hydratation, sans re-push). Sans ce flush, des données se perdent.
- Un rechargement complet revient à la semaine par défaut.
- **Semaine passée** (RG-24) : régénérer ou modifier un slot d'une semaine passée **non vide** ouvre une `ConfirmationModale`. Mécanique : chaque action mutante prend `force = false` et, en tête, `confirmerSiPassee(reprise)` diffère l'action puis la rejoue avec `force = true`. `selectionnerRecette` capture le slot **avant** la garde (le sélecteur se ferme). Le stepper personnes n'est pas gardé.

## Undo (US-09, RG-19)

`capturerSnapshotAnnulation` fige `planning_courant` + `courses_cochees` avant toute action destructive ; `restaurerSnapshotAnnulation` réécrit les deux directement dans les stores de `lib/stockage.ts`. Passer par `sauvegarderPlanningComplet` ré-effacerait les coches qu'on veut rendre. Le snapshot est **mono-niveau** et **expire** (~6 s), il reste local, et le toast utilise un id fixe (`annulation-planning`).

## Coches temps réel (RG-32)

- Table `etat_courses_article(foyer_id, ancre, cle, quantite, updated_at)` : **une ligne par article**. Pourquoi : un blob unique upserté faisait s'écraser deux membres qui cochaient en parallèle. Écritures directes sous RLS (`cocherArticleDistant` / `decocherArticleDistant` / `viderCochesDistantes`), `foyer_id` posé par `default mon_foyer()`.
- Le blob localStorage `courses_cochees` reste la représentation locale : `/courses` et `lib/coches.ts` l'ignorent tout du distant. `surChangementCoches` calcule le **diff** entre l'état synchronisé (`cochesConnues`) et le blob courant (`deriverOps`, `lib/coches-sync.ts`, pur et testé). Un blob vidé produit un seul `viderCochesDistantes`. `courses_dirty` = ops en attente.
- Abonnement `postgres_changes` filtré par `ancre`. Un event distant est fusionné par `appliquerEventLocal` **sous le drapeau `applicationDistanteEnCours`**, sinon il re-dériverait des ops en boucle. Un seul client Supabase mémoïsé gère les canaux. Abonnements sérialisés, avec purge du topic (parade à « cannot add callbacks after subscribe() »).
- **Présence « en magasin »** (RG-31) : `usePresenceCourses()`, canal Presence par foyer, une clé `crypto.randomUUID()` par onglet ; ≥ 2 clés signifie qu'un autre membre est sur la liste. Hook propre à `/courses`, hors de `useSync`, pour que `/planning` ne compte pas.

## Alerte intrusive de modification du planning (US-21)

- Abonnement `postgres_changes` à la table `planning`, en lisant seulement `new` (pas besoin de `REPLICA IDENTITY FULL`).
- **Changement distant ou écho de ma propre écriture ?** On compare l'`updated_at` de l'event à `planning_courant_maj` : `<=` = écho ignoré. Sinon, re-pull **forcé** (`chargerSemaineDansCache`, qui lève volontairement le « local fait foi ») puis comparaison `signaturePlanning` avant/après (`lib/planning-diff.ts`, pur). Si elle diffère, `declencherAlertePlanning`.
- La modale (`components/ui/alerte-modif-planning.tsx`, store `useAlertePlanning` / `acquitterAlertePlanning`) est montée **une seule fois dans `app/layout.tsx`** ; elle reste inerte hors de `/planning` et `/courses`.
- Côté cycle (`/courses`, vue Cycle) : voir `courses-cycle.md` (abonnement par semaine ISO + `majPlanningCycle`).

## Changement de foyer

Après jonction, sortie ou déconnexion, appeler `reinitialiserCacheFoyer()` (vide planning, coches, drapeaux, horodatages et snapshot ; garde `semaine_affichee`) puis recharger. Sans cela, le dirty-first ferait foi avec l'ancien cache et un push différé l'écrirait sous le nouveau foyer.
