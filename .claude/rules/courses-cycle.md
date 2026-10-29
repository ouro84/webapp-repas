---
paths:
  - "app/courses/**"
  - "components/courses/**"
  - "components/planning/vue-cycle.tsx"
  - "lib/cycles*.ts"
  - "lib/courses*.ts"
  - "lib/coches*.ts"
  - "lib/transitions-courses*.ts"
  - "lib/articles-manuels*.ts"
  - "lib/sync*.ts"
  - "lib/persistance.ts"
  - "lib/foyer.ts"
  - "app/globals.css"
---

# Liste de courses et cycle de courses

## Cycle de courses = projection par-dessus la semaine ISO

- `/courses` est fenêtrée sur un **cycle** : `ancre` (dernière date du jour de courses du foyer) + `longueur` (défaut 7, entre 1 et 14). **Le stockage du planning reste par semaine ISO** ; `lib/cycles.ts` (pur, `tests/cycles.test.ts`) projette par-dessus : `ancreCourante`, `ancreParDefaut`, `cycleDecale`, `joursDuCycle`, `semainesDuCycle` (1 ou 2 semaines ISO touchées), `dateVersSemaineJour`, `libelleCycle`, `planningDuCycle`. `genererListeCourses` agrège par ingrédient, donc les jours dupliqués d'un cycle > 7 j sont conservés.
- **Ancre affichée par défaut = `ancreParDefaut`** (et non `ancreCourante`) : le week-end, elle avance d'un cycle pour rester alignée sur `semaineParDefaut`. Sinon, un planning généré un samedi tomberait hors de la liste affichée.
- **Jour de courses = réglage FOYER** (`foyers.jour_courses`, ISO 1..7, défaut lundi), éditable dans `PanneauFoyer` (`/profil`) grâce à un grant-colonne. Avec lundi + 7 j, le cycle coïncide avec la semaine ISO (rétro-compatibilité).
- **`definirJourCoursesFoyer` (`lib/foyer.ts`) garde son filtre `.not("id","is",null)`** : PostgREST rejette tout `UPDATE` sans clause WHERE (`21000`), et l'échec reste silencieux au runtime (cf. `supabase.md`).
- **En usage réel, un cycle chevauche presque toujours 2 semaines ISO** (jour de courses ≠ lundi). Le chemin à 2 semaines se teste avec `definirJourCoursesDistant(request, jour)` (`e2e/helpers.ts`), puisque les e2e remettent lundi par défaut.
- **Longueur étirée** : table `cycle_courses(foyer_id, ancre, longueur)` créée paresseusement, sans ligne pour 7 j (`chargerLongueurCycle` / `definirLongueurCycle`).
- **Coches clées par `ancre`** (`etat_courses_article`), via `ancreActive()` (= `cycle_affiche`). `semaineActive()` ne sert plus qu'à `/planning`.

## Stores de `/courses` : `cycle_planning` n'est jamais poussé

- `/courses` utilise **`useSyncCourses()`** (coches uniquement : abonnement `storeCoches`, flush, temps réel par ancre, temps réel planning par semaine du cycle), **`useCyclePlanning()`** (planning projeté, clé `cycle_planning`) et **`useCycleAffiche()`** (`{ancre, longueur}`). `useSync()` est réservé à `/planning`.
- **`cycle_planning` est une projection locale, jamais écrite dans `storePlanning` ni poussée.** Pourquoi : sa `semaine` est en réalité une ancre-date et ses `jour` peuvent être dupliqués ; un push planterait `sauvegarder_planning` ou écraserait les jours d'une semaine voisine.
- **Dirty-first adapté** (`chargerCycleDansCache`) : le local fait foi si le backend est vide pour cette ancre **et** si `planningCycle.semaine === ancre` (cas offline et injection e2e).
- **Limitation connue** : RG-13 (une régénération sur `/planning` vide les coches) peut viser le mauvais cycle **côté distant** si aucun cycle n'a été affiché dans la session (`ancreActive()` vaut `null`). Le nettoyage local reste correct.

## « Générer mon cycle » (`/courses`)

- `POST /api/planning/generer` accepte deux modes exclusifs : `{ semaine }` (`/planning`, 14 slots) et `{ ancre, longueur }` (cycle). En mode cycle, la route génère une semaine (saison = ancre), projette les slots sur les jours du cycle via `planningGenereParSemaine` (`lib/cycles.ts`) et renvoie `{ semaines: [{semaine, jours}], … }`. **La route ne persiste pas.**
- Le client (`appliquerGenerationCycle`) persiste **chaque semaine touchée** via la RPC **`sauvegarder_slots(p_semaine, p_slots)`**, qui upsert **uniquement les (jour, type_repas) fournis**, puis invalide les coches du cycle (RG-13) et re-projette depuis la base (`rechargerProjectionCycle`). Pourquoi pas `sauvegarder_planning` : il remplace toute la semaine et écraserait les jours des cycles voisins.
- **Alerte US-21 côté cycle** : `synchroniserAbonnementPlanningCycle(ancre, longueur)` crée un abonnement planning **par semaine ISO** (topic `planning-cycle:<foyer>:<semaine>`) ; `traiterChangementCycleDistant` re-projette et compare `signaturePlanning`. Le filtre anti-écho est double : `signaturePlanning` + `majPlanningCycle` (Map semaine → `updated_at` connu, mise à jour à chaque pull et à chaque push), plus `suppressionAlerteCycle` pendant `appliquerGenerationCycle`.

## Vue « Cycle » de `/planning` (`components/planning/vue-cycle.tsx`)

- Bascule « Semaine | Cycle » (`BasculeVue`, défaut `"semaine"`). `VuePlanningCycle` est rendu par un court-circuit **avant** les états vide/chargé de la semaine.
- **Projection propre, indépendante de `/courses`** : `chargerCycle` lit `chargerPlanningDistant` pour chaque semaine de `semainesDuCycle`, plus `chargerJourCoursesFoyer` + `ancreParDefaut` + `chargerLongueurCycle`. La vue n'utilise ni `useSyncCourses`, ni `useCyclePlanning`, ni aucun store partagé.
- **`chargerCycle` distingue « pas de planning » de « lecture échouée »** : l'échec est loggé et toasté, et l'état précédent est conservé. Pourquoi : un `.catch(() => null)` faisait disparaître silencieusement les jours de la semaine minoritaire après chaque édition (test de régression dans `edition-vue-cycle.spec.ts`, avec `jour_courses = 5`).
- **Édition complète** (changer, sélection manuelle, personnes, restes) écrite **directement en base** pour la semaine ISO du jour édité (`modifierSlotDistant`, via `sauvegarder_slots`), sans passer par `storePlanning`. Anti-écho : `majPlanningCycle` + `planning_courant_maj`, et le cache `storePlanning` est patché si la semaine éditée est celle affichée en vue Semaine. Undo léger : un toast rejoue l'ancien `JourPlanning`.

## Articles manuels (US-47, `article_manuel`)

- Table dédiée `article_manuel(foyer_id, ancre, id, libelle, quantite?, unite?, categorie, fond_de_placard, coche, cree_le)`, scopée foyer + ancre : un article ne survit pas à un changement de cycle. **La coche vit sur la ligne**, sans clé `nom|unité` ni fusion de libellés identiques (RG-42). Il échappe ainsi par construction à l'invalidation RG-12/RG-13 : seule une purge de cycle le touche.
- **Intégration à l'affichage sans dupliquer le tri** (`lib/articles-manuels.ts`) : `articleManuelVersIngredient` mappe vers `Ingredient` avec le discriminant `source: "manuel"`. `estCoche` a une branche dédiée, ce qui suffit à `trierAvecCoches` / `categorieTerminee` / `trierCategoriesAvecCoches` / `compterProgression` sur des listes mêlées. `fusionnerArticlesManuels` insère les sections au rang de `ORDRE_CATEGORIES`, exporté depuis `lib/courses.ts` (source unique).
- Quantité optionnelle (RG-43) : le mapper neutralise à `0` / `"piece"`. L'affichage passe par `aQuantiteRenseignee(ingredient)` (un `formaterQuantite` nu afficherait « 0 »).
- Édition en place (id et coche conservés) dans le bottom sheet partagé `components/courses/formulaire-article-manuel.tsx`. Écritures directes sous RLS + temps réel par ancre (`REPLICA IDENTITY FULL`), store **en mémoire** `useArticlesManuels()`. Rétention alignée sur `purgerCyclesAvant`.

## Catégories terminées et animation de descente (RG-11, RG-39)

- Article coché : il descend en bas de sa catégorie. Catégorie entièrement cochée : **elle glisse en bas de la liste**, titre rayé, **en restant ouverte** (`categorieTerminee` + `trierCategoriesAvecCoches`, `lib/coches.ts`, tri stable). Le repli automatique a été écarté : contenu qui bouge sous le doigt en magasin, annulation pénalisée, conflit avec le repli manuel (`replies`, indépendant du tri). Le fond de placard se raye mais reste en dernier, hors compteur RG-14.
- **Le moment focal est l'arrivée** : en magasin, l'œil reste sur le doigt pendant le glissement, et rallonger l'animation n'aide pas. Les pièces qui en découlent, dans `app/courses/page.tsx` + `app/globals.css` :
  1. **Groupes uniformes** : tous les `::view-transition-group()` partagent `--duree-glissement` (320 ms), la même courbe et aucun délai ; la durée est aussi posée sur `-old` / `-new`. Toute différenciation d'un élément passe par `-old` / `-new`, jamais par le groupe. Pourquoi : un `<li>` nommé est extrait du snapshot de sa section, et des groupes désynchronisés déchirent l'image.
  2. **`view-transition-class`** déclarée dans les classes CSS `.vt-ligne-courses` / `.vt-bloc-categorie` de `globals.css`, parce que les `view-transition-name` sont dynamiques (style inline) et donc inatteignables par nom.
  3. **`(root)` et `(.bloc-categorie)` sans crossfade** (`animation: none`) : compteur instantané, et le ✓ « terminé » lisible dès la première frame. La section « Fond de placard » est nommée (`NOM_TRANSITION_FOND_DE_PLACARD`), sinon son chrome sauterait avec la racine.
  4. **Pulsation d'atterrissage** : `avecTransition()` renvoie la `ViewTransition` ; `signalerAtterrissage()` attend `finished` puis monte `PulsationAtterrissage` sur `cibleAtterrissage(…)` (`lib/coches.ts` : la section si la catégorie se termine, la ligne sinon, `null` sur une décoche). C'est un **`<div>`** contenant un calque de couleur **statique** dont on anime l'opacité, teinté par le token `--color-atterrissage` (`brand-50` est invisible sur le canvas crème). Un nonce monotone sert de `key` et de garde de fraîcheur. `transition.ready` rejette en `AbortError` si la transition est sautée : toujours le catcher. Pas de `motion-safe:` (sous reduced motion, aucune transition donc aucun overlay ; un `motion-safe:` créerait un bandeau permanent).
- **Repère persistant** dans l'en-tête (`libelleCategoriesTerminees`), **toujours monté même vide** : une catégorie terminée descend souvent hors écran, et une région `aria-live` insérée avec son contenu n'est pas annoncée.
- **Reduced motion et View Transitions** : le reset `*` ne couvre pas les `::view-transition-*`. La protection réelle est la garde JS de `avecTransition()`. `globals.css` ajoute en défense un reset `0.01ms` sur `::view-transition-group/-image-pair/-old/-new(*)`, plutôt que `animation: none` qui figerait l'image doublée.
- **Contrat `flushSync`** : toute mutation appelée depuis `avecTransition()` applique sa partie locale **avant son premier `await`** (le callback de `startViewTransition` ne capture que la portion synchrone). `basculerCocheArticleManuel` et `viderCochesArticlesManuels` sont optimistes avec revert, puis **rethrow** : leurs appels `void …` côté page ajoutent un `.catch` (console.error + `toast.error`).
- **Markup verrouillé par `e2e/courses.spec.ts`** : jamais de `<span>` en tête d'un `<li>` (le test lit `li.last().locator("span").first()`), overlay d'en-tête **hors** du `<button>`, marqueur « terminé » = icône SVG sans nœud texte (`Check`, `aria-hidden`), pour ne pas casser `toHaveText` sur `main section h2 button`.
