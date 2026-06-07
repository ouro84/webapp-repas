# Spécifications fonctionnelles — Webapp Repas de la semaine

> Version : 1.1  
> Date : 2026-06-02  
> Statut : **Validé** (Phase 1 — Conception produit)

---

## 1. Contexte & objectif

### Problème

Chaque semaine, planifier les repas et établir la liste de courses est chronophage et répétitif. Le manque d'inspiration entraîne des repas qui reviennent trop souvent.

### Solution

Une webapp qui génère automatiquement un planning de repas pour la semaine à partir d'une liste de recettes connues, et produit la liste de courses associée, agrégée et prête à l'emploi.

### Objectif produit

Réduire à zéro l'effort de planification hebdomadaire des repas, du choix des recettes jusqu'à la liste de courses.

---

## 2. Persona & Job-to-be-done

### Persona

**Arnaud — Cuisinier actif en couple**

- Cuisine pour 2 personnes en semaine
- Le week-end : invités fréquents ou cuisine en double portion pour les restes
- Répertoire de ~30 recettes maîtrisées
- Fait les courses une fois par semaine
- Usage : **mobile-first** — toutes les étapes (planification, consultation, courses) sont effectuées principalement sur smartphone

### Job-to-be-done

> *"Quand je dois préparer ma semaine, je veux générer un planning repas varié depuis mes recettes, avec la liste de courses adaptée, pour arriver aux courses sans effort de planification."*

---

## 3. Périmètre

### MVP — ce qu'on construit

| # | Feature | Description |
|---|---------|-------------|
| F-01 | Liste de recettes | ~30 recettes stockées dans `/data/recettes.json` |
| F-02 | Temps de préparation | Chaque recette est classée : Rapide / Normal / Long |
| F-03 | Flag "fond de placard" | Chaque ingrédient peut être marqué comme fond de placard (sel, huile, épices…) |
| F-04 | Génération du planning | Génère un planning sur 7 jours : dîner chaque soir + déjeuner samedi et dimanche |
| F-05 | Contrainte semaine/week-end | Lun→Ven : recettes Rapide ou Normal uniquement. Sam→Dim : toutes recettes |
| F-06 | Pas de répétition | Une même recette n'apparaît pas deux fois dans la même semaine |
| F-07 | Remplacement d'un repas | Remplacer un slot individuel sans modifier le reste du planning |
| F-08 | Liste de courses agrégée | Ingrédients regroupés par catégorie, quantités additionnées si doublons |
| F-09 | Section fond de placard | Ingrédients flaggués affichés à part avec mention "à vérifier avant d'acheter" |
| F-10 | Responsive (mobile-first) | L'app est mobile-first. Vue desktop disponible (grille 7 colonnes) |
| F-11 | Persistance du planning | Le planning généré est sauvegardé localement (localStorage) — survit à la fermeture de l'app |
| F-12 | Liste de courses cochable | Cocher/décocher les articles en magasin : rayé + fin de catégorie, progression, persistance locale (#19) |

### Nice-to-have — backlog futur

> **Note :** cette liste est indicative et sera amenée à évoluer en fonction de l'usage réel. Elle est gérée dans GitHub Projects (configuré en Phase 3). Les priorités peuvent être révisées à tout moment.

| Feature | Note |
|---------|------|
| CRUD recettes | Saisir / modifier / supprimer des recettes via l'interface |
| Déjeuners en semaine (lun→ven) | Extension naturelle de F-04 |
| Gestion des portions dynamiques | Adapter les quantités selon le nombre de personnes |
| Restes / double portion | Cuire pour 4 afin d'avoir des restes |
| Historique des plannings | Consulter les plannings des semaines passées |
| Comptes utilisateurs / auth | Données personnalisées par utilisateur, sync multi-device |
| Partage de la liste de courses | Export, envoi par email ou lien |

---

## 4. User stories (format BDD)

### US-01 — Générer un planning

> **En tant qu'** utilisateur, je veux générer un planning de repas pour la semaine, afin de ne pas avoir à réfléchir à ce que je vais cuisiner chaque jour.

**Comportement :**
> **Given** l'utilisateur est sur la page d'accueil  
> **When** il clique sur "Générer mon planning"  
> **Then** l'app affiche un planning de 7 jours : un dîner par jour du lundi au dimanche, un déjeuner le samedi, un déjeuner le dimanche — sans répétition de recette dans la semaine

---

### US-02 — Contrainte temps de préparation

> **En tant qu'** utilisateur, je veux que les repas de semaine soient rapides à préparer, afin de ne pas me retrouver avec un bœuf bourguignon un mardi soir.

**Comportement :**
> **Given** un planning est en cours de génération  
> **When** le slot concerné est un dîner de semaine (lundi → vendredi)  
> **Then** seules les recettes classées "Rapide" ou "Normal" sont éligibles

> **Given** un planning est en cours de génération  
> **When** le slot concerné est un repas de week-end (samedi ou dimanche)  
> **Then** toutes les recettes sont éligibles, y compris "Long"

---

### US-03 — Générer la liste de courses

> **En tant qu'** utilisateur, je veux obtenir la liste de courses issue de mon planning, afin de faire mes courses sans réfléchir et sans allers-retours dans le magasin.

**Comportement :**
> **Given** un planning a été généré  
> **When** l'utilisateur clique sur "Voir la liste de courses"  
> **Then** l'app affiche les ingrédients regroupés par catégorie, avec les quantités additionnées en cas de doublon, et une section séparée pour les ingrédients "fond de placard"

---

### US-04 — Remplacer un repas

> **En tant qu'** utilisateur, je veux pouvoir remplacer un repas spécifique du planning, afin de ne pas devoir tout regénérer si un seul repas ne me convient pas.

**Comportement :**
> **Given** un planning est affiché  
> **When** l'utilisateur clique sur "↺ changer" sur un slot donné  
> **Then** l'app remplace ce repas par une autre recette éligible (même contrainte de temps de préparation selon le jour), sans modifier les autres slots du planning

> **Given** l'utilisateur clique sur "↺ changer"  
> **When** toutes les recettes éligibles sont déjà utilisées dans la semaine  
> **Then** l'app affiche le message : "Pas de recette disponible"

---

### US-05 — Cocher les articles de la liste de courses

> **En tant qu'** utilisateur en train de faire mes courses, je veux pouvoir identifier les articles que j'ai chez moi ou mis dans mon chariot, afin de ne pas les ajouter en doublon ou en oublier.

**Comportement :**
> **Given** je suis sur la liste de courses  
> **When** je clique sur un article non coché  
> **Then** il se raye, se grise et passe en fin de liste de sa catégorie (transition animée, `prefers-reduced-motion` respecté)

> **Given** un article est coché  
> **When** je clique dessus  
> **Then** il se dé-raye et reprend sa place alphabétique parmi les articles non cochés de sa catégorie

> **Given** des articles sont cochés  
> **When** je recharge la page ou rouvre le navigateur  
> **Then** les coches sont conservées

> **Given** des articles sont cochés  
> **When** je remplace un repas du planning  
> **Then** seules les coches des articles dont la quantité a changé (ou qui ont disparu) sont invalidées

> **Given** des articles sont cochés  
> **When** je regénère entièrement le planning  
> **Then** toutes les coches sont réinitialisées

> **Given** au moins un article est coché  
> **When** je clique sur « Tout décocher »  
> **Then** toutes les coches (y compris fond de placard) sont retirées

> **Given** je suis sur la liste de courses  
> **When** je clique sur l'en-tête d'une catégorie  
> **Then** la section se replie/déplie (état non persisté)

---

### US-06 — Sélectionner manuellement une recette

> **En tant qu'** utilisateur, je veux pouvoir modifier le repas d'un slot généré, afin de sélectionner une recette spécifique dont j'ai envie.

**Comportement :**
> **Given** je suis sur le planning  
> **When** je clique sur « Sélectionner » sur un slot  
> **Then** un sélecteur s'ouvre (bottom sheet mobile / modale desktop), titré du slot visé, avec un champ de recherche en tête et la liste alphabétique complète des recettes, chacune avec son badge de temps

> **Given** le sélecteur est ouvert  
> **When** je tape dans le champ de recherche  
> **Then** la liste est filtrée en direct, insensible à la casse et aux accents

> **Given** le sélecteur est ouvert  
> **When** je choisis une recette  
> **Then** le slot visé est remplacé, les autres slots inchangés, le sélecteur se ferme — les coches de la liste de courses sont conservées (RG-12)

> **Given** une recette est déjà présente dans le planning  
> **When** le sélecteur l'affiche  
> **Then** elle porte un badge « déjà au planning » et reste sélectionnable (RG-15)

> **Given** le sélecteur est ouvert  
> **When** je presse Échap, clique sur le fond ou sur le bouton de fermeture  
> **Then** il se ferme sans modifier le planning, le focus revient au bouton d'origine

---

### US-07 — Nombre de personnes par repas

> **En tant qu'** utilisateur, je veux modifier le nombre de personnes par repas, afin d'avoir une liste de courses correcte si je reçois du monde un jour.

**Comportement :**
> **Given** je suis sur le planning  
> **When** je modifie le nombre de personnes d'un repas via le stepper de sa card (− / +)  
> **Then** le nombre est visible sur la card et la liste de courses reflète immédiatement les quantités mises à l'échelle

> **Given** un repas est à 1 personne (ou 12)  
> **When** je tente de descendre (ou monter) encore  
> **Then** le bouton est inactif — le nombre reste dans [1 ; 12]

> **Given** un repas est réglé à 4 personnes  
> **When** je change sa recette (aléatoire ou sélection manuelle)  
> **Then** le repas reste à 4 personnes (RG-16)

> **Given** je (re)génère entièrement le planning  
> **When** le nouveau planning s'affiche  
> **Then** tous les repas sont à 2 personnes (RG-16)

> **Given** un article de la liste de courses est coché  
> **When** je modifie le nombre de personnes d'un repas qui contribue à cet article  
> **Then** sa quantité agrégée change et sa coche est invalidée (RG-12) — les autres coches sont conservées

---

### US-08 — Accord en nombre des libellés de courses

> **En tant qu'** utilisateur, je veux que les libellés de la liste de courses s'accordent en nombre selon la quantité, afin d'avoir une liste lisible et naturelle.

**Comportement :**
> **Given** je visualise la liste de courses  
> **When** un ingrédient vendu à la pièce a une quantité ≥ 2  
> **Then** son nom est au pluriel (« 3 carottes »)

> **Given** un ingrédient vendu à la pièce a une quantité < 2  
> **When** je visualise la liste  
> **Then** son nom est au singulier (« 1 carotte »)

> **Given** un ingrédient mesuré (g, ml, c.à.s…) ou un nom de masse  
> **When** la quantité varie  
> **Then** son nom reste invariable (« 200 g de beurre »)

---

## 5. Modèle de données

> Les structures ci-dessous sont exprimées en TypeScript à titre documentaire. Le fichier de données réel est `/data/recettes.json` — format JSON lisible et éditable sans connaissance technique.

### 5.1 Recette

```ts
type Recette = {
  id: string                      // identifiant unique, ex: "poulet-roti"
  nom: string                     // ex: "Poulet rôti aux herbes"
  tempsPreparation: "rapide"      // < 20 min
                  | "normal"      // 20–45 min
                  | "long"        // > 45 min
  ingredients: Ingredient[]
}
```

### 5.2 Ingrédient

```ts
type Ingredient = {
  nom: string                     // ex: "Pommes de terre"
  quantite: number                // ex: 1
  unite: Unite                    // ex: "kg"
  categorie: CategorieIngredient
  fondDePlacard: boolean          // true = sel, huile, épices, farine…
}
```

> **Note discipline :** `categorie` et `fondDePlacard` sont définis par occurrence d'ingrédient dans une recette. Si "sel" apparaît dans 10 recettes, il doit avoir le même flag et la même catégorie dans les 10. Cette cohérence est une responsabilité à la saisie, pas une contrainte technique pour le MVP.

### 5.3 Unités disponibles

```ts
type Unite =
  | "g"           // grammes
  | "kg"          // kilogrammes
  | "ml"          // millilitres
  | "cl"          // centilitres
  | "l"           // litres
  | "piece"       // pièce(s)
  | "briquette"   // briquette(s)
  | "bouteille"   // bouteille(s)
  | "boite"       // boîte(s)
  | "sachet"      // sachet(s)
  | "cas"         // cuillère(s) à soupe
  | "cac"         // cuillère(s) à café
  | "autre"       // unité non listée — à préciser dans le nom de l'ingrédient
```

### 5.4 Catégories d'ingrédients

```ts
type CategorieIngredient =
  | "viandes-poissons"    // Viandes, poissons, charcuterie
  | "legumes-fruits"      // Légumes frais et fruits
  | "produits-frais"      // Produits laitiers, œufs, pâtes fraîches
  | "epicerie"            // Féculents secs, conserves, sauces, boissons
  | "boulangerie"         // Pain, viennoiseries
  | "surgeles"            // Produits surgelés
  | "autre"               // Catégorie non listée — à compléter à l'usage
```

> **Note :** cette liste sera complétée lors de la saisie des ~30 recettes initiales (Phase 3).

### 5.5 Planning (structure générée)

```ts
type JourPlanning = {
  jour: "lundi" | "mardi" | "mercredi" | "jeudi" | "vendredi" | "samedi" | "dimanche"
  dejeuner?: Recette     // uniquement samedi et dimanche en MVP
  diner: Recette
  // Nombre de personnes par slot (US-07, RG-16). Optionnel : champ absent = 2
  // (défaut), ce qui rend les plannings persistés antérieurs relisables sans migration.
  personnes?: { dejeuner?: number; diner?: number }
}

type Planning = {
  semaine: string        // ex: "2026-W23"
  jours: JourPlanning[]  // 7 entrées
}
```

### 5.6 Persistance

Le planning généré est sauvegardé en `localStorage` sous la clé `planning_courant`. Il est écrasé à chaque nouvelle génération. La persistance multi-device (sync via Supabase) est un nice-to-have lié à l'authentification.

Les coches de la liste de courses (US-05) sont sauvegardées sous la clé `courses_cochees` : un objet `{ [nom|unité]: quantité au moment du cochage }` (cf. RG-12). La clé est effacée à chaque génération complète de planning (RG-13).

---

## 6. Règles métier du générateur

### RG-01 — Éligibilité par jour

| Jour | Slot | Recettes éligibles |
|------|------|--------------------|
| Lundi → Vendredi | Dîner | `tempsPreparation: "rapide"` ou `"normal"` |
| Samedi | Déjeuner | Toutes |
| Samedi | Dîner | Toutes |
| Dimanche | Déjeuner | Toutes |
| Dimanche | Dîner | Toutes |

### RG-02 — Pas de répétition dans la semaine

Une recette ne peut apparaître qu'une seule fois dans un planning de 7 jours, quel que soit le slot (déjeuner ou dîner).

### RG-03 — Sélection aléatoire

Parmi les recettes éligibles (RG-01 + RG-02), la sélection est aléatoire à chaque génération.

### RG-04 — Remplacement individuel

Lors d'un remplacement (US-04), la nouvelle recette doit respecter RG-01 et RG-02. Si aucune recette éligible n'est disponible, afficher : *"Pas de recette disponible"*.

### RG-05 — Agrégation de la liste de courses

Pour construire la liste de courses depuis un planning :
1. Collecter tous les ingrédients de toutes les recettes du planning
2. Regrouper par `nom` d'ingrédient (insensible à la casse)
3. Additionner les `quantite` pour les ingrédients de même nom **et** même `unite`
4. Séparer les ingrédients avec `fondDePlacard: true` dans une section distincte
5. Trier par `categorie`, puis par nom dans chaque catégorie

> **Cas limite :** si le même ingrédient apparaît dans deux recettes avec des unités différentes (ex: 200g et 1 pièce), les afficher sur deux lignes distinctes sans tenter de conversion.

### RG-15 — Sélection manuelle d'une recette (US-06)

> Les RG-10 à RG-14 (liste de courses cochable) sont en section 7.

La sélection manuelle by-passe **RG-01** (une recette « long » est permise un soir de semaine) et **RG-02** (le doublon est permis) : l'utilisateur arbitre, informé par le badge temps et le badge « déjà au planning ». Elle constitue un remplacement individuel : les coches de la liste de courses sont conservées (RG-12/RG-13) et l'opération ne peut pas échouer — le cas « Pas de recette disponible » (RG-04) n'existe pas dans ce mode, et un message d'indisponibilité affiché précédemment sur le slot est nettoyé après une sélection réussie.

### RG-16 — Nombre de personnes par repas (US-07)

Le nombre de personnes est porté par chaque slot du planning (section 5.5), avec une valeur par défaut de **2** et borné à **[1 ; 12]**. Il est **conservé** lors d'un remplacement de recette (US-04, US-06) et **réinitialisé à 2** par une génération complète (cohérent avec RG-13). Les plannings persistés antérieurs à cette feature se relisent sans migration : un champ `personnes` absent vaut 2.

### RG-17 — Mise à l'échelle des quantités (US-07)

Les recettes sont données pour 2 personnes. Pour un slot réglé à `N` personnes, chaque quantité d'ingrédient est multipliée par `N / 2` **à la collecte** (RG-05, étape 1), avant agrégation. L'arrondi est appliqué **après** agrégation, par type d'unité :

| Unités | Arrondi |
|--------|---------|
| `piece`, `briquette`, `bouteille`, `boite`, `sachet`, `autre` (comptables) | entier supérieur |
| `g`, `ml`, `cl` (mesures fines) | entier le plus proche |
| `kg`, `l` (grosses mesures) | 1 décimale |
| `cas`, `cac` (cuillères) | au 0,5 près |

> Arrondir après agrégation évite d'accumuler les erreurs d'arrondi quand un même ingrédient provient de plusieurs repas mis à l'échelle différemment.

### RG-18 — Accord en nombre des libellés de courses (US-08)

L'accord se fait à l'affichage uniquement (le nom stocké est inchangé), et selon ce qui est compté :
- **unité `piece`** : le **nom** s'accorde — singulier si quantité < 2, pluriel si ≥ 2. Implémenté par un pluriel régulier conscient des connecteurs (« de / à / en… » : seule la tête s'accorde, ex. « blancs de poulet ») complété d'une **table d'exceptions** (formes déjà au pluriel dans le dataset, composés irréguliers, mots à trait d'union, invariants : marques, variétés, noms de masse vendus à la pièce).
- **unités conteneur** (`sachet`, `boite`, `bouteille`, `briquette`) : c'est le **libellé d'unité** qui s'accorde (« 2 sachets »), pas le nom (contenu).
- **mesures** (`g`, `kg`, `ml`, `cl`, `l`, `cas`, `cac`) : noms de masse, jamais accordés.

> Hors table d'exceptions et hors règle régulière sûre, la forme est laissée **inchangée** — ne jamais risquer une faute d'accord.

---

## 7. Règles d'affichage & responsive

### RG-06 — Mobile-first

L'app est conçue pour mobile en priorité. Tous les écrans doivent être utilisables d'une main, en mode portrait.

### RG-07 — Vue desktop (≥ 768px)

Le planning s'affiche en grille 7 colonnes (une par jour). Chaque cellule contient le ou les slots du jour avec le nom de la recette, le badge de temps de préparation, et le bouton de remplacement.

### RG-08 — Vue mobile (< 768px)

Le planning s'affiche en liste verticale : une ligne par jour, avec les slots empilés verticalement pour le week-end.

### RG-09 — États de l'interface

Chaque écran doit gérer trois états :
- **Loading** : pendant la génération du planning
- **Error** : si la génération échoue (ex: pas assez de recettes éligibles)
- **Empty** : état initial avant toute génération

### RG-10 — Bascule cocher/décocher (US-05)

Un clic sur un article de la liste de courses bascule son état coché/non coché. La zone cliquable est la ligne entière (hauteur ≥ 44 px).

### RG-11 — Affichage des articles cochés

Un article coché est rayé, grisé et affiché en fin de sa catégorie (ordre alphabétique entre articles cochés). Décoché, il reprend sa place alphabétique (RG-05).

### RG-12 — Persistance et invalidation des coches

Les coches sont persistées en `localStorage` (clé `courses_cochees`), accrochées à la clé d'agrégation `nom|unité` (RG-05) avec la quantité de l'article au moment du cochage. Une coche n'est valide que si la quantité actuelle de l'article est identique — sinon elle est silencieusement ignorée (protège des remplacements de slots, US-04).

### RG-13 — Cycle de vie des coches

Une génération complète de planning réinitialise toutes les coches. Un remplacement de slot individuel ne déclenche aucune réinitialisation globale : l'invalidation par quantité (RG-12) suffit.

### RG-14 — Fond de placard cochable, hors progression

Les articles du fond de placard sont cochables (même comportement visuel) mais exclus du compteur de progression « n/N », qui ne porte que sur les articles à acheter.

---

## 8. Wireframes de référence

Les wireframes low-fi validés lors de la Phase 1 couvrent :

- **Écran 1** — Accueil : bouton "Générer mon planning"
- **Écran 2a** — Planning desktop : grille 7 colonnes avec badges et boutons de remplacement
- **Écran 2b** — Planning mobile : liste verticale par jour
- **Écran 3** — Liste de courses mobile-first : catégories + section fond de placard

---

## 9. Explicitement hors scope (toutes versions)

> Ces features ne sont pas prévues dans la roadmap actuelle. Contrairement au backlog (section 3), elles ne seront pas reconsidérées sans une évolution significative du besoin.

- Gestion des allergies ou régimes alimentaires
- Suggestions basées sur les saisons ou le marché
- Notation ou commentaire des recettes
- Synchronisation avec un calendrier externe (Google Calendar…)
- Mode collaboratif temps réel (couple qui planifie simultanément)
