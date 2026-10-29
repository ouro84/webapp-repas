---
paths:
  - "lib/generateur*.ts"
  - "lib/generation*.ts"
  - "lib/reglages*.ts"
  - "lib/recettes.ts"
  - "lib/saisons*.ts"
  - "lib/accompagnement*.ts"
  - "lib/preferences.ts"
  - "lib/restes*.ts"
  - "lib/personnes*.ts"
  - "lib/semaines.ts"
  - "lib/adapters*.ts"
  - "lib/avertissements-generation*.ts"
  - "app/api/planning/**"
  - "app/planning/**"
  - "app/recettes/**"
  - "app/reglages/**"
  - "components/planning/**"
  - "components/recettes/**"
  - "types/**"
  - "data/**"
  - "tests/**"
  - "scripts/generer-*.mjs"
---

# Génération du planning, réglages, recettes

## Sources des recettes

- **La source de vérité est Supabase.** `data/recettes.json` (154 recettes) ne sert qu'à amorcer le catalogue global (via `scripts/generer-seed-recettes.mjs`) et aux tests ; le modifier ne change rien à l'app déployée, il faut une migration. `data/recettes_25random.json` est un ancien jeu, utilisé nulle part ; les fixtures de test vivent dans `tests/fixtures/recettes.ts`.
- **Catalogue global** : `foyer_id IS NULL` (et `user_id IS NULL`), lisible par tous, non éditable. **Recettes du foyer** : `foyer_id = mon_foyer()`, éditables et supprimables par tout membre (RG-30). La RLS refuse silencieusement un `update`/`delete` sur une globale.
- Le catalogue public a remplacé les recettes personnelles du propriétaire, réassignées à son foyer ; les 154 nouvelles y sont masquées. Pourquoi : ses plannings persistés gardent leurs ids. Les e2e « catalogue » ciblent un **nom de recette du catalogue courant** (`RECETTE_CATALOGUE` dans `e2e/recettes.spec.ts`).
- **Génération côté serveur, liste côté client** : `genererPourUtilisateur(supabase, demande)` (`lib/generation.ts`, client injecté) lit recettes, masquages, réglages, historique et préférences sous RLS, puis génère ; **rien n'est persisté**. `POST /api/planning/generer` n'en est que l'adaptateur HTTP (auth, rate-limit, corps, traduction de `ErreurGeneration` en statut) ; le serveur MCP l'appelle avec un client par jeton (#304). Pourquoi : une seule logique de génération pour le web et le MCP (règle du jumeau). Le sélecteur manuel et « ↺ changer » chargent la liste côté client via `lib/recettes.ts`.

## « Supprimer » / « Modifier » une recette (verbes uniformes)

- **Supprimer une recette globale = masquage** dans `recette_masquee` (scope **foyer**, PK `(foyer_id, recette_id)`) ; supprimer une recette du foyer est un vrai delete. L'UI garde les mêmes verbes, sans badge « Catalogue » ni vocabulaire « masquer ».
- **Le filtrage des masquées se fait à deux endroits** : la génération serveur (`lib/generation.ts`) **et** `chargerRecettes` / `chargerRecettesGerees` (client, via `chargerIdsMasques`). En oublier un fait réapparaître la recette d'un côté.
- La suppression est **appliquée immédiatement**, avec un undo transitoire (toast sonner, id `suppression-recette`). Différer réinclurait la recette dans une régénération pendant la fenêtre d'undo. Une recette du foyer recréée par undo reçoit un nouvel id.
- **Garde de faisabilité** : la page recettes bloque une suppression qui rendrait `analyserVivier(restantes, reglages)` infaisable.
- **Modifier une globale = `creerRecette(saisie)` puis `masquerRecette(originalId)`, au save** (annuler ne fait rien). La copie passe d'abord, pour qu'un échec de masquage laisse un doublon récupérable plutôt qu'une perte. Il n'existe pas de lien original↔copie : supprimer la copie ne ressuscite pas l'originale, et la préférence favori/évité ne se transfère pas.
- **Le raccourci « Modifier » de `FicheRecette`** s'affiche si la recette est présente dans le catalogue chargé (`modifiable`, alimenté par `idsModifiables` = ids de `recettesGerees` dans `app/planning/page.tsx`). Pourquoi : une recette de slot peut manquer au catalogue (fixture hors base, recette masquée encore planifiée), et le deep-link `/recettes?edition=<id>` serait alors mort.

## Champs optionnels de `Recette` (absent = neutre)

Même convention pour `vegetarien?`, `accompagnement?`, `saisons?`, `etapes?`, `personnes?` : absent ou vide = valeur neutre.

- **`vegetarien`** : heuristique « aucun ingrédient en catégorie `viandes-poissons` », appliquée au catalogue par migration et pré-cochée dans le formulaire (`vegeTouche` distingue suggestion auto et choix manuel).
- **`accompagnement`** (`"feculents" | "legumes"`) : heuristique **par nom d'ingrédient** (`lib/accompagnement.ts`, `FECULENTS_RX` / `LEGUMES_RX`, priorité au féculent), car aucune catégorie d'ingrédient ne capture les féculents. **Jumeau SQL** dans la migration `..._recette_accompagnement.sql` (regex `~`, `translate()` pour désaccentuer, `\y` pour `\b`) : toute évolution des motifs se fait des deux côtés. Pré-suggestion dans le formulaire (`accompTouche`).
- **`saisons`** : `lib/saisons.ts` (`saisonDuMois`, `estDeSaison`, table `PRODUITS_SAISON`, `suggererSaisons` = intersection des saisons des produits saisonniers ; vide = toute l'année). `saisonDeSemaine` (`lib/semaines.ts`) prend la saison du jeudi. **Jumeau JS** : `scripts/generer-saisons-recettes.mjs` reproduit `PRODUITS_SAISON` (à régénérer si la table change).
- **`etapes`** (`string[]`, saisie manuelle, éditeur avec flèches `ChevronUp`/`ChevronDown`). La recette est embarquée dans le slot persisté, donc `etapes` traverse **toute la chaîne** : `dbRecetteToDomain`, les **deux selects alignés** `SELECT_RECETTE` (`lib/recettes.ts`, réutilisé tel quel par `lib/generation.ts`) et `SELECT_PLANNING` (`lib/persistance.ts`), ainsi que `creerRecette` / `modifierRecette` / `saisieVersRecette` / `recetteVersSaisie` / `valeurDuplication`. Tout nouveau champ de recette suit la même chaîne (couverte par `lib/adapters.test.ts`).
- **Pas de durée numérique** : le temps d'une recette est une catégorie `rapide < normal < long`.

## Le générateur (`lib/generateur.ts`)

- **14 slots** (déjeuner + dîner × 7). Éligibilité par créneau (RG-01) pilotée par les réglages : `tempsEligibles(jour, typeRepas, reglages)` = recettes dont le temps est ≤ au **plafond** du créneau. `genererPlanning` / `remplacerSlot` / `analyserVivier` prennent `reglages` en paramètre optionnel (défaut `REGLAGES_DEFAUT` : dîner semaine `rapide`, déjeuner semaine `normal`, week-end `long`).
- **Remplissage des slots les plus contraints d'abord** (`poidsContrainte` = taille du vivier éligible). Pourquoi : un ordre chronologique peut épuiser un vivier restreint alors qu'une solution existe.
- **Invariant : la génération n'échoue jamais à cause d'une préférence.** Tous les biais choisissent dans le même palier de temps et replient sur tous les éligibles, donc la faisabilité (`analyserVivier`, condition de Hall) ne dépend que des plafonds. Les avertissements sont **dérivés du planning final** par des fonctions pures, découplées de l'aléatoire ; la génération les renvoie (`vegeNonHonore`, `mixNonHonore`, `saisonNonHonore`) et le client toaste, y compris après un « ↺ changer ».
- **Ordre de composition des biais** dans `genererPlanning` et `remplacerSlot` : `biaiserSaison`, puis `biaiserVege`, puis `biaiserMixLegume`.
  - **Saison** (`biaiserSaison`) : filtre dur à dégradation gracieuse (repli si le vivier de saison ne suffit pas). Réglage `saisonnalite` **ON par défaut** (`!== false`, DB `default true`), à l'inverse des autres. Avertissement : `reposNonSaison`.
  - **Végé par créneau** (`vegetarienPrefere?`, 4 booléens, DB `vege_*`) : biais souple, et les slots végé-préférés sont triés en premier à palier égal. Avertissement : `slotsVegeNonHonores`.
  - **Mix ≥1 légume/jour** (`mixAccompagnementJour?`, un booléen) : contrainte **jointe par jour**. `biaiserMixLegume` biaise vers légume tant que le jour n'en a pas, puis **anti-biais** (préférence non-légume) pour préserver le vivier des jours suivants ; sans l'anti-biais, un jour en affamait un autre. `remplacerSlot` regarde le repas frère du jour. Avertissement : `joursSansLegume`.
  - `REGLAGES_DEFAUT` n'inclut ni `vegetarienPrefere` ni `mixAccompagnementJour`, car leur absence signifie « désactivé ».
- **Tirage pondéré final** (`choisirPondere`) : poids = `poidsVariete × poidsPreference`, tous **strictement positifs** (jamais bloquants).
  - **Variété** (RG-49→52) : `poidsVariete` vaut 1 hors fenêtre, sinon `ancien/(FENETRE_VARIETE+1)` (`FENETRE_VARIETE = 4`). `HistoriqueVariete` = `Map<idRecette, ancienneté>`, lu en best-effort par `lib/generation.ts` (erreur → `Map` vide). **Génération seule** : ne pas l'appliquer à `remplacerSlot`.
  - **Préférences** (RG-58→63) : table `recette_preference` (scope foyer). Favorite = 3, évitée = 0.1, neutre = 1. Appliquée à la génération **et** à `remplacerSlot` (sans variété). La sélection manuelle n'est jamais filtrée (RG-03).
- **Signature** : `genererPlanning(recettes, semaine, reglages, random, historiqueVariete, preferences)`. Les paramètres optionnels ont des défauts neutres (`Math.random`, `new Map()`) qui reproduisent le comportement prod.
- **Tests déterministes** : tout test qui déréférence un `remplacerSlot` sur un créneau contraint passe un PRNG seedé (`rngSeed`, mulberry32, `generateur.test.ts`) **à la génération ET au remplacement**. Pourquoi : `genererPlanning` peut épuiser aléatoirement le vivier « rapide », et `remplacerSlot` renvoie alors légitimement `null`.

## Réglages (`lib/reglages.ts`, `lib/reglages-data.ts`, `/reglages`)

- Cœur pur dans `lib/reglages.ts` (importable par le générateur) ; accès données dans `lib/reglages-data.ts` (client injectable) ; lecture serveur inline dans `lib/generation.ts`. Table `reglages` **par utilisateur** (pas par foyer).
- Le nombre de personnes par défaut est estampillé sur les slots à la génération. `facteurEchelle` garde une base recette **figée à 2** (RG-16) ; `PERSONNES_DEFAUT` reste une constante.
- **Plafond `"aucun"`** (type `PlafondCreneau`) = créneau désactivé (RG-44→48) : jamais généré, retiré de `analyserVivier`. Au moins un créneau reste actif (`auMoinsUnCreneauActif`, appliqué dans `validerReglages`, en garde de save, et par contrainte CHECK en base).
- **Masquage immédiat à l'affichage** : contrairement aux autres réglages (effet à la prochaine génération), un créneau désactivé disparaît tout de suite du planning et des courses via `retirerCreneauxDesactives(planning, reglages)` (vue Cycle : `creneauActif` par slot). Le filtre s'applique **au rendu**, jamais au planning persisté : réactiver restitue le slot d'origine. L'emplacement reste dans la grille avec l'état vide « Pas de repas prévu ».
- Page `/reglages` : enregistrement explicite (`initiaux` vs `form`, bouton actif si `modifie` et faisable), garde B3 `analyserVivier(recettes, form)`, aperçus « N recettes … éligibles ». Accès depuis `/profil` et depuis l'icône `SlidersHorizontal` de la barre d'actions du planning (pas d'accès en nav globale).

## Planning : structure et slots

- `JourPlanning.dejeuner` **et** `.diner` sont optionnels (vieux plannings à 9 repas, créneaux désactivés). `remplacerSlot` / `remplacerSlotManuel` / `modifierPersonnes` renvoient `null` si le slot est absent. Tout nouveau consommateur de `JourPlanning` garde l'accès au slot (cf. `lib/courses.ts`, `construireSlots`, `dbSlotToJourPlanning`, `recettesUtilisees`).
- **Restes** (US-12, RG-22) : `JourPlanning.restes?.{dejeuner|diner}`, via `estRestes` / `marquerRestes` (`lib/restes.ts`). Un slot en restes est exclu des courses ; sa recette est conservée (démarquer la restitue). `remplacerSlot*` efface le flag. En UI, un slot en restes n'a ni badge temps, ni stepper, ni fiche.
- **La fiche recette lit le slot**, sans appel réseau. Les quantités passent par `facteurEchelle` / `arrondirQuantite` (`lib/personnes.ts`) et `lib/unites.ts`, les mêmes helpers que la liste de courses.

## Semaines (`lib/semaines.ts`)

- Format ISO 8601 `"2026-W23"` : l'année ISO est celle du jeudi, et tous les calculs se font en UTC. Toute la logique calendaire (`semaineISO`, `formaterSemaine`, `semaineDecalee`, `semaineParDefaut`, `libelleRelatif`, `saisonDeSemaine`) vit dans ce fichier.
- La génération **valide la plage côté serveur** (`SEMAINES_PASSEES` / `SEMAINES_FUTURES` de `lib/generation.ts`, autour de la semaine courante) et lève `ErreurGeneration` 400 hors plage (la route renvoie 400). Le client n'est pas l'autorité.
- Semaine par défaut : la courante, ou la prochaine le week-end.
