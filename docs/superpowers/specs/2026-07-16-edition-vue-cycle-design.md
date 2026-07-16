# Design — Édition en vue Cycle + libellé dynamique « Ce midi/Ce soir »

> Date : 2026-07-16
> Statut : design validé, prêt pour plan d'implémentation
> Issues cibles : suite directe de #279/#280 (PR #281 mergée) — retour utilisateur post-merge

---

## 1. Problème & besoin

### Remontée utilisateur (post-merge PR #281)

1. « La vue cycle s'est améliorée, mais on n'a toujours pas les possibilités de la vue semaine :
   changer un repas, modifier le nombre de personnes etc. » — la vue Cycle de `/planning` reste
   lecture seule pour l'édition de slot (changer/sélection manuelle/personnes/restes), alors que
   la génération y a été ajoutée par #279.
2. « L'entrée du menu nav "ce soir" n'est pas pertinente si on veut voir le repas de ce midi » —
   le libellé de nav et le titre de la page `/ce-soir` (état vide) sont figés sur « Ce soir »,
   alors que la page affiche en réalité le **prochain repas actif**, qui peut être le déjeuner.

### Pourquoi ce n'est pas qu'un oubli (point 1)

La lecture seule de la vue Cycle est une décision prise **deux fois** :
- #260 §8 (design #257) : « Semaine = piloter, Cycle = visualiser + aller aux courses », car (a)
  un cycle non calendaire chevauche 1-2 semaines ISO — éditer un slot d'une semaine qui n'est pas
  la « semaine affichée » sortirait du modèle **mono-semaine** de `storePlanning`/`useSync`
  (persistance, undo mono-niveau, temps réel planning) ; (b) une éditabilité partielle (seuls les
  jours de la semaine affichée) serait un modèle mental incohérent.
- #279 : seule la **génération** a été ajoutée à la vue Cycle, précisément parce qu'elle est déjà
  découplée du store mono-semaine (RPC `sauvegarder_slots`) — l'édition de slot est restée hors
  scope, pour ne pas rouvrir ce chantier sans le traiter explicitement.

Ce document traite explicitement ce chantier : comment éditer un slot dans un cycle qui peut
chevaucher 2 semaines **sans** casser l'undo, le temps réel planning, ni la cohérence de
`storePlanning` pour la vue Semaine.

---

## 2. Décisions produit

| # | Décision |
|---|----------|
| D1 | Parité complète : changer (aléatoire), sélection manuelle, personnes, restes — les 4 actions de la vue Semaine sont disponibles en vue Cycle. |
| D2 | Annulation : chaque édition en vue Cycle propose un toast « Annuler » qui annule CETTE modification précise, quelle que soit la semaine — même promesse UX que la vue Semaine, mécanisme technique séparé. |
| D3 | Libellé « Ce midi »/« Ce soir » dynamique, cohérent partout dans l'app (nav, page `/ce-soir`) — même seuil horaire (~15h) que le calcul du prochain repas. |

---

## 3. Approche retenue — édition en vue Cycle

### 3.a Écriture directe en base, découplée de `storePlanning`

Chaque action d'édition (changer/sélection/personnes/restes) sur un jour de la vue Cycle :

1. Lit le `Planning` de la semaine ISO de ce jour depuis la projection déjà chargée par
   `VuePlanningCycle` (`parSemaine: Map<string, Planning>`, déjà en place).
2. Calcule le nouveau `Planning` de cette semaine via la fonction **pure existante**
   (`remplacerSlot`, `remplacerSlotManuel`, `modifierPersonnes`, ou `marquerRestes` — toutes déjà
   dans `lib/generateur.ts`/`lib/personnes.ts`/`lib/restes.ts`, réutilisées telles quelles).
3. Extrait **uniquement le `JourPlanning` touché** du résultat (`nouveauPlanning.jours.find(jp =>
   jp.jour === jour)`).
4. Persiste via une nouvelle fonction `modifierSlotDistant(semaine, jourPlanning)` (`lib/sync.ts`)
   qui appelle `sauvegarderSlotsDistant(semaine, [jourPlanning])` (RPC `sauvegarder_slots`, déjà
   utilisée par la génération fenêtrée #259) — **sans jamais toucher `storePlanning`**.

`sauvegarderSlotsDistant` upserte uniquement les `(jour, type_repas)` **présents** sur l'objet
`JourPlanning` fourni (vérifié en code, `construireSlots`/`construireSlotsJours` : un champ
`dejeuner`/`diner` absent n'émet pas de slot) — passer un `JourPlanning` avec un seul des deux
repas renseigné ne touche donc que CE créneau, jamais l'autre repas du même jour.

Après persistance réussie, `VuePlanningCycle` recharge sa propre projection locale (même méthode
`chargerCycle(ancre)` que pour la génération) — pas de store global à invalider.

### 3.b Cohérence avec la vue Semaine et le temps réel (anti-écho)

Deux bookkeeping anti-écho existent déjà dans `lib/sync.ts` et doivent être mis à jour par
`modifierSlotDistant`, sous peine de fausses alertes intrusives sur ses propres éditions :

- **`majPlanningCycle`** (Map semaine→updated_at, utilisée par le temps réel de `/courses` pour
  filtrer l'écho de ses propres écritures, #259) : mise à jour **systématiquement**, pour
  n'importe quelle semaine touchée — `/courses` peut avoir sa propre vue cycle ouverte sur une
  autre semaine, indépendamment de ce qui est « affiché » sur `/planning`.
- **`planning_courant_maj`** (clé localStorage lue par `lireMajLocale()`, utilisée par l'alerte
  temps réel de `/planning`, #56 PR5) : mise à jour **uniquement si** la semaine touchée est la
  semaine actuellement affichée (`semaine_affichee`). Dans ce cas, le cache `storePlanning` local
  est **aussi** patché avec le `JourPlanning` édité (pas un simple flag) : si l'utilisateur revient
  en vue Semaine sans recharger, il voit l'édition immédiatement, sans attendre une re-synchro.

Sans cette mise à jour, éditer un jour de la semaine affichée depuis la vue Cycle déclencherait
l'alerte intrusive « le planning a changé » (#56 PR5) sur sa propre édition — un faux positif.

### 3.c Undo dédié, léger

Pas de réutilisation de `capturerSnapshotAnnulation`/`restaurerSnapshotAnnulation` (spécifiques à
`storePlanning`, avec fenêtre expirante en localStorage) : inutilement lourd ici, puisque
**la fermeture du toast suffit**. Avant d'appeler `modifierSlotDistant`, on capture le
`JourPlanning` **avant modification** dans la closure du toast ; son action « Annuler » rappelle
`modifierSlotDistant(semaine, ancienJourPlanning)` — revient exactement à l'état précédent par le
même chemin d'écriture (mêmes garanties anti-écho). Pas de persistance de ce snapshot au-delà de
la durée de vie du toast (~5 s) : contrairement à la vue Semaine, pas d'exigence de survivre à un
reload.

### 3.d Chaque action, précisément

| Action | Fonction pure réutilisée | Notes |
|---|---|---|
| Changer (aléatoire) | `remplacerSlot(planning, jour, typeRepas, recettes, reglages, undefined, preferences)` | Recettes/réglages/préférences déjà chargés par `VuePlanningCycle` (génération) — réutilisés tels quels pour l'édition. |
| Sélection manuelle | `remplacerSlotManuel(planning, jour, typeRepas, recette)` | Réutilise `SelecteurRecette` (déjà monté ailleurs dans l'app) tel quel. |
| Personnes | `modifierPersonnes(planning, jour, typeRepas, personnes)` | Stepper identique à la vue Semaine (`PERSONNES_MIN`/`PERSONNES_MAX`). |
| Restes | `marquerRestes(planning, jour, typeRepas, valeur)` | Bascule identique à la vue Semaine. |

Chacune retourne `null` si le slot ciblé n'existe pas (créneau désactivé ou planning antérieur) —
même garde que la vue Semaine, pas de nouveau cas à gérer.

### 3.e Confirmation semaine passée (RG-24)

La vue Semaine demande confirmation avant d'éditer une semaine passée (`confirmerSiPassee`,
US-14). La vue Cycle applique la **même règle**, par jour édité (pas par cycle entier) : si la
date du jour édité est antérieure à aujourd'hui, la même `ConfirmationModale` s'affiche avant
d'appliquer — réutilise le composant, pas la logique de `offsetAffiche` (qui n'a pas de sens ici,
remplacée par une comparaison de date directe).

---

## 4. Approche retenue — libellé dynamique (point 2)

Nouvelle fonction pure `libelleMomentActuel(maintenant: Date): "Ce midi" | "Ce soir"` dans
`lib/prochain-repas.ts`, même seuil horaire que `SEUIL_HEURE_DINER` (~15h, déjà utilisé par
`prochainRepasActif`) — un seul seuil, une seule source de vérité.

Utilisation :
- **Lien de nav** (`components/ui/nav.tsx`, déjà `"use client"`) : le libellé du lien devient
  `{libelleMomentActuel(new Date())}` au lieu du texte figé `"Ce soir"`.
- **Page `/ce-soir`** : vérifié en code (`app/ce-soir/page.tsx:84-91`), les deux cas « aucun
  créneau actif trouvé » et « créneau actif sans recette » sont actuellement **une seule branche
  combinée** (`if (prochain === null || !prochain.recette)`) avec un `h1` figé sur `"Ce soir"`. Le
  design les **sépare** :
  - `prochain === null` (rien trouvé dans la fenêtre de recherche, pas de date connue) → `h1`
    utilise `libelleMomentActuel(new Date())`.
  - `prochain !== null && !prochain.recette` (créneau actif identifié, sans recette planifiée) →
    `h1` utilise `libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())` — déjà
    utilisée par les 2 autres branches de la page (restes, fiche recette), plus précis que le
    générique puisque la date/le type sont connus à ce stade.

**Hors scope** : la route reste `/ce-soir` (identifiant technique stable, invisible en usage
normal — l'utilisateur clique un lien de nav, ne tape pas l'URL). Seul le texte visible change.

---

## 5. Fichiers impactés (vue d'ensemble)

| Fichier | Changement |
|---|---|
| `lib/sync.ts` | Nouvelle fonction `modifierSlotDistant(semaine, jourPlanning)` — appelle `sauvegarderSlotsDistant`, met à jour `majPlanningCycle` systématiquement et `planning_courant_maj`/`storePlanning` si la semaine touchée est la semaine affichée. |
| `lib/prochain-repas.ts` | Nouvelle fonction pure `libelleMomentActuel(maintenant)`. |
| `components/planning/vue-cycle.tsx` | Ajoute les 4 contrôles d'édition (changer/sélection/personnes/restes) par slot, réutilise `SelecteurRecette`/`ConfirmationModale` (déjà utilisés ailleurs), toast Annuler par édition. |
| `components/ui/nav.tsx` | Libellé du lien « Ce soir » devient dynamique. |
| `app/ce-soir/page.tsx` | La branche combinée `prochain === null \|\| !prochain.recette` (ligne 84) est scindée en deux : `null` → `libelleMomentActuel` ; sans recette → `libelleContexteRepas`. |
| `e2e/prochain-repas.spec.ts`, `e2e/auth.spec.ts` | Assertions sur le libellé de nav acceptent « Ce midi » OU « Ce soir » (regex) au lieu du texte figé. |

---

## 6. Hors scope / limitations connues

- Le format d'affichage de la période (vue Semaine vs vue Cycle, cf. #279 D6) n'est pas retouché.
- Pas de génération de cycle depuis un jour unique (déjà couvert par #279 D2, inchangé).
- La confirmation « semaine passée » (§3.e) n'a pas de garde-fou testé pour un cycle qui
  chevauche passé ET futur (un jour passé + un jour futur dans le même cycle) — chaque jour est
  jugé indépendamment par sa propre date, ce qui couvre ce cas par construction (pas un trou de
  spec, juste noté pour clarté).

---

## 7. Tests à prévoir

- Unitaire : `libelleMomentActuel` (2 cas, avant/après le seuil).
- e2e (CI-only, génération réelle) : éditer un slot (changer + personnes au minimum) depuis la vue
  Cycle, vérifier la persistance (reload), vérifier qu'éditer un jour de la semaine affichée ne
  déclenche PAS l'alerte intrusive sur soi-même, vérifier le toast Annuler.
- Mise à jour des 2 specs e2e existantes qui matchent le libellé de nav en dur.
