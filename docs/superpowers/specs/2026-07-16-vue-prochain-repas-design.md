# Design — Vue « Prochain repas » (`/ce-soir`)

> Date : 2026-07-16
> Statut : design validé, prêt pour plan d'implémentation
> Issue cible : #280

---

## 1. Problème & besoin

### Remontée utilisateur

Interview post-livraison de l'épopée Cycle de courses (#257/#259/#260) : les vues existantes
(Semaine, Cycle) sont utiles mais toutes les deux pensées pour la personne qui **planifie**. Il
manque une vue pour la personne qui **cuisine sans avoir planifié** : une vue très épurée qui ne
liste que « ce qu'on mange ce soir », le seul repas sur lequel se concentrer maintenant.

### Job To Be Done

> « Je vais cuisiner, je n'ai pas suivi la planification — dis-moi juste quoi faire, maintenant,
> sans naviguer. »

### Persona

Le membre du foyer qui cuisine mais n'a pas généré/consulté le planning — typiquement pas la
même personne que celle qui pilote `/planning`.

---

## 2. Décisions produit (validées en interview)

| # | Décision |
|---|----------|
| D1 | Route **dédiée** `/ce-soir`, pas une 3ᵉ bascule sur `/planning` ni un widget d'accueil — le persona cible n'ouvre justement pas `/planning`. |
| D2 | **Un seul repas affiché**, calculé selon l'heure du jour (pas « les 2 prochains »). |
| D3 | **Contenu complet** : nom, ingrédients échelonnés, étapes de préparation — réutilise `FicheRecette` telle quelle. |
| D4 | **Repli automatique** sur le prochain créneau réellement actif : restes affichés tels quels, créneaux désactivés (#217) sautés silencieusement, aucun planifié → état vide sobre. |
| D5 | Vue **lecture seule** — aucune action d'édition ni de génération. |

---

## 3. Approche retenue

### 3.a Route et accès (D1)

Nouvelle page `app/ce-soir/page.tsx`, route protégée (ajoutée à `protectedRoutes` de `proxy.ts`).
Lien ajouté à `components/ui/nav.tsx`, dans la section nav réservée aux connectés (à côté de
Planning/Courses/Recettes) — libellé court, ex. « Ce soir ».

### 3.b Calcul du prochain créneau actif (D2 + D4)

Logique pure, nouveau fichier `lib/prochain-repas.ts` (même esprit que `lib/cycles.ts` :
fonctions pures, testables sans réseau) :

```
prochainCreneau(maintenant: Date, planningsParSemaine: Map<semaine, Planning>, reglages): 
  { jour, typeRepas, jp } | null
```

Algorithme :
1. Point de départ : jour civil de `maintenant` + type de repas selon l'heure — seuil unique
   ~15h (avant → déjeuner du jour si pas encore passé sinon dîner du jour ; après → dîner du
   jour). Pas de configuration du seuil en V1.
2. Avance créneau par créneau (déjeuner → dîner → lendemain déjeuner → …) tant que le créneau
   rencontré est **désactivé** (`creneauActif`, `lib/generateur.ts`, réutilisé tel quel) — ce
   créneau n'existe pas pour ce foyer, on ne s'y arrête jamais.
3. S'arrête au premier créneau actif rencontré, **qu'il soit vide, en restes, ou pourvu d'une
   recette** — ces trois états sont affichés tels quels (D4), on ne saute PAS un créneau juste
   parce qu'il n'a pas de recette ou qu'il est en restes (seul « désactivé » fait sauter).
4. Limite de recherche : semaine courante + semaine suivante (mêmes 1-2 semaines que
   `VuePlanningCycle` charge typiquement) — si rien de planifié dans cette fenêtre, retour `null`
   → état vide « Rien de prévu ».

`app/ce-soir/page.tsx` charge les plannings des 1-2 semaines nécessaires via
`chargerPlanningDistant` (déjà utilisé par `VuePlanningCycle`, même pattern) et les réglages via
`chargerReglages`.

### 3.c Rendu (D3 + D4)

- Créneau actif avec recette → monte `FicheRecette` directement (pas besoin de cliquer sur un
  nom de plat comme sur `/planning` — la page EST la fiche). Libellé de contexte au-dessus :
  « Dîner de ce soir » / « Déjeuner de demain » etc. (réutilise le vocabulaire jour+type déjà
  présent dans l'app).
- Créneau actif marqué restes → pas de `FicheRecette` (pas d'ingrédients à cuisiner) : message
  sobre « Restes de [nom de la recette du slot] » (la recette reste portée par le slot même en
  restes, cf. `lib/restes.ts` — `marquerRestes` ne touche jamais `jp.diner`/`jp.dejeuner`).
- Créneau actif sans recette (planning existant mais slot jamais rempli) → état vide « Rien de
  prévu pour ce repas ».
- Aucun créneau actif trouvé dans la fenêtre de recherche → état vide « Rien de prévu » global,
  **sans CTA génération** (cohérent avec la lecture seule de la vue Cycle, #260 §8 — cette page
  est un point de consultation, pas d'action ; générer reste le rôle de `/planning`/`/courses`).

### 3.d Lecture seule (D5)

Aucun contrôle de changer/sélectionner/personnes/restes sur cette page. Seule `FicheRecette`
(déjà un composant de consultation) est montée — son raccourci « Modifier » (si la recette est
dans le catalogue chargé, #137) reste disponible, cohérent avec le reste de l'app.

---

## 4. Fichiers impactés (vue d'ensemble)

| Fichier | Changement |
|---|---|
| `lib/prochain-repas.ts` | Nouveau — cœur pur, calcul du prochain créneau actif. |
| `app/ce-soir/page.tsx` | Nouveau — page, chargement plannings/réglages, rendu selon §3.c. |
| `proxy.ts` | Ajoute `/ce-soir` à `protectedRoutes`. |
| `components/ui/nav.tsx` | Ajoute le lien « Ce soir » à la nav connectée. |

Aucun changement de modèle de données, aucune migration Supabase, aucune nouvelle table.

---

## 5. Hors scope / limitations connues

- Seuil horaire déjeuner/dîner fixe (~15h), non configurable en V1.
- Pas de génération depuis cette page (D5) — si rien n'est planifié, l'utilisateur doit passer
  par `/planning` ou `/courses`.
- Recherche bornée à 2 semaines — un foyer qui ne génère jamais rien verra l'état vide, jamais
  une erreur ni un blocage.

---

## 6. Tests à prévoir

- Unitaire (`tests/prochain-repas.test.ts`) : seuil horaire, repli sur créneau désactivé,
  traversée de fin de semaine, restes (recette conservée dans le message), aucun résultat dans
  la fenêtre de recherche.
- e2e (CI-only, génération réelle, nouveau spec ou ajout à un spec existant) : `/ce-soir` affiche
  le bon repas après génération ; état vide sans planning ; lien nav présent uniquement connecté.
