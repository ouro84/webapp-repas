// Types — Webapp Repas de la semaine
// Source de vérité : SPECS_FONCTIONNELLES.md section 5
//
// Ce fichier contient deux familles de types :
//
// 1. TYPES DOMAINE — utilisés par la logique métier (lib/generateur.ts, lib/courses.ts)
//    Représentent les concepts métier tels que le générateur les manipule.
//    Format camelCase, structure aplatie et pratique à utiliser.
//
// 2. TYPES BASE DE DONNÉES — ce que Supabase retourne réellement
//    Reflètent exactement le schéma SQL (snake_case, relations imbriquées).
//    Utilisés pour typer les réponses des requêtes Supabase avant conversion.
//
// Un adaptateur dans lib/adapters.ts convertit DB → Domaine.

// ============================================================================
// PRIMITIVES PARTAGÉES (utilisées dans les deux familles)
// ============================================================================

export type Unite =
  | "g"         // grammes
  | "kg"        // kilogrammes
  | "ml"        // millilitres
  | "cl"        // centilitres
  | "l"         // litres
  | "piece"     // pièce(s)
  | "briquette"
  | "bouteille"
  | "boite"
  | "sachet"
  | "cas"       // cuillère(s) à soupe
  | "cac"       // cuillère(s) à café
  | "autre";    // unité non listée — préciser dans le nom

export type CategorieIngredient =
  | "viandes-poissons"
  | "legumes-fruits"
  | "produits-frais"
  | "epicerie"
  | "boulangerie"
  | "surgeles"
  | "autre";

export type TempsPreparation = "rapide" | "normal" | "long";
// rapide : < 20 min | normal : 20–45 min | long : > 45 min

// Valeur de plafond d'un créneau de réglages (#217, US-48) : un temps de
// préparation maximum, OU "aucun" — le créneau n'est pas généré du tout
// (≠ un plafond, RG-44). Distinct de TempsPreparation (qui reste la valeur
// d'une RECETTE : une recette n'a jamais de temps "aucun").
export type PlafondCreneau = TempsPreparation | "aucun";

// Accompagnement dominant d'une recette (#49, P11) : féculent (pâtes, riz,
// pommes de terre…) ou légume (plat tourné légumes). Optionnel côté domaine :
// beaucoup de plats n'en ont pas (plat unique, viande seule…) — absent = non
// caractérisé.
export type Accompagnement = "feculents" | "legumes";

// Saison d'une recette (#23, P12). Mapping mois → saison défini par RG-02
// (cf. lib/saisons.ts). Une recette peut appartenir à plusieurs saisons
// (RG-01) ; absente/vide = disponible toute l'année (pâtes, viandes…).
export type Saison = "ete" | "automne" | "hiver" | "printemps";

export type Jour =
  | "lundi" | "mardi" | "mercredi" | "jeudi"
  | "vendredi" | "samedi" | "dimanche";

// ============================================================================
// TYPES DOMAINE — logique métier
// ============================================================================
// Ces types sont utilisés par lib/generateur.ts et lib/courses.ts.
// Ils sont intentionnellement plus simples que les types DB :
// l'ingrédient porte déjà sa quantité et son unité, ce qui facilite
// les calculs d'agrégation de la liste de courses.

export type Ingredient = {
  nom: string;
  quantite: number;
  unite: Unite;
  categorie: CategorieIngredient;
  fondDePlacard: boolean;
  // Discriminant d'un article manuel de la liste de courses (#216, US-47).
  // Optionnel : absent = ingrédient dérivé d'une recette (comportement
  // antérieur inchangé). Un article manuel porte son état coché DIRECTEMENT
  // (table article_manuel dédiée, RG-40/41) plutôt que via le blob de coches
  // par clé nom|unité (RG-12) — cf. lib/coches.ts, estCoche().
  source?: "manuel";
  id?: string;
  coche?: boolean;
};

export type Recette = {
  id: string;
  nom: string;
  tempsPreparation: TempsPreparation;
  ingredients: Ingredient[];
  // Recette végétarienne (#86, P10). Optionnel comme les autres flags du
  // domaine (absent = false) → fixtures/dataset relisibles sans migration.
  vegetarien?: boolean;
  // Accompagnement dominant (#49, P11). Optionnel : absent = non caractérisé
  // (ni féculent ni légume identifié). Cf. lib/accompagnement.ts pour la
  // suggestion par heuristique.
  accompagnement?: Accompagnement;
  // Saisons de la recette (#23, P12). Optionnel : absent ou vide = disponible
  // toute l'année (aucune contrainte saisonnière). Cf. lib/saisons.ts.
  saisons?: Saison[];
  // Étapes de préparation (#233, RG-43). Optionnel : absent/vide = pas d'étapes
  // (cas du catalogue global non renseigné). Liste ORDONNÉE de texte libre,
  // saisie 100 % manuelle (pas d'heuristique, contrairement à vege/accompagnement).
  etapes?: string[];
};

export type JourPlanning = {
  jour: Jour;
  dejeuner?: Recette; // peuplé chaque jour à la génération (#3) ; optionnel pour
                      // relire les plannings antérieurs à 14 repas OU si le
                      // créneau est désactivé (#217, « Aucun »)
  diner?: Recette;    // optionnel depuis #217 pour la même raison (créneau
                      // désactivable) — auparavant toujours requis
  // Nombre de personnes par slot (US-07, RG-16). Optionnel : champ absent = 2
  // (défaut), ce qui rend relisables sans migration les plannings persistés
  // avant cette feature.
  personnes?: { dejeuner?: number; diner?: number };
  // Slots marqués « restes » (US-12, RG-22) : pas cuisinés, exclus de la liste
  // de courses. Optionnel : absent/false = repas cuisiné normal.
  restes?: { dejeuner?: boolean; diner?: boolean };
};

export type Planning = {
  semaine: string;       // ex: "2026-W23"
  jours: JourPlanning[]; // 7 entrées
};

// Réglages de génération personnalisés (#45, P09), par utilisateur connecté.
// `plafonds` : temps de préparation MAXIMUM autorisé par créneau (jour × repas)
// — la génération n'y place que des recettes de temps ≤ plafond (l'ordre est
// rapide < normal < long, cf. lib/reglages.ts). `personnesDefaut` : nombre de
// personnes dont sont dotés les slots fraîchement générés (RG-16, base recette
// = 2 inchangée). Défaut applicatif : REGLAGES_DEFAUT (= comportement antérieur).
export type ReglagesGeneration = {
  personnesDefaut: number; // borné [1;12]
  plafonds: {
    dejeunerSemaine: PlafondCreneau;
    dinerSemaine: PlafondCreneau;
    dejeunerWeekend: PlafondCreneau;
    dinerWeekend: PlafondCreneau;
  };
  // Préférence « privilégier le végétarien » par créneau (#86 PR2, US-16,
  // RG-26). Optionnel (absent = aucune préférence = comportement antérieur),
  // comme Recette.vegetarien. Préférence SOUPLE : la génération biaise vers les
  // recettes végé sans jamais échouer si le vivier végé est insuffisant.
  vegetarienPrefere?: {
    dejeunerSemaine: boolean;
    dinerSemaine: boolean;
    dejeunerWeekend: boolean;
    dinerWeekend: boolean;
  };
  // Préférence « au moins un repas légumes par jour » (#49 PR2, US-17, RG-27).
  // Optionnel (absent = désactivé = comportement antérieur). Préférence SOUPLE
  // et JOINTE par jour : la génération biaise pour qu'au moins un des deux repas
  // d'une journée soit « légumes », sans jamais échouer si le vivier ne le
  // permet pas. Sans incidence sur la faisabilité (analyserVivier).
  mixAccompagnementJour?: boolean;
  // Saisonnalité (#23 PR2, US-18, RG-28). ⚠️ INVERSION de défaut vs les deux
  // préférences ci-dessus : ON par défaut → on teste `saisonnalite !== false`
  // (absent OU true = actif ; seul `false` désactive). Filtre DUR à dégradation
  // gracieuse : la génération ne propose que des recettes de la saison de la
  // semaine cible, mais complète hors-saison (sans jamais échouer) si le vivier
  // de saison est insuffisant.
  saisonnalite?: boolean;
};

// Forme DB (snake_case) de la table `reglages` — convertie via lib/reglages.ts.
// `reglages` reste PAR-UTILISATEUR (PK user_id), même après la bascule foyer #56.
export type DbReglages = {
  user_id: string; // PK — réglages propres à chaque membre
  personnes_defaut: number;
  max_dejeuner_semaine: PlafondCreneau;
  max_diner_semaine: PlafondCreneau;
  max_dejeuner_weekend: PlafondCreneau;
  max_diner_weekend: PlafondCreneau;
  vege_dejeuner_semaine: boolean;
  vege_diner_semaine: boolean;
  vege_dejeuner_weekend: boolean;
  vege_diner_weekend: boolean;
  // #49 PR2 — « au moins un repas légumes par jour » (not null default false).
  mix_accompagnement_jour: boolean;
  // #23 PR2 — saisonnalité (not null default TRUE : ON par défaut).
  saisonnalite: boolean;
  updated_at: string; // versioning, posé par défaut now() à l'écriture
};

// Forme DB de `recette_masquee` — masquage d'une recette du catalogue par défaut
// (#105 PR1), basculé en scope FOYER en #56 PR2 (PK (foyer_id, recette_id) ;
// user_id retiré). `cle` métier = (foyer_id, recette_id). Cf. lib/recettes.ts.
export type DbRecetteMasquee = {
  foyer_id: string;
  recette_id: string;
  masquee_le: string;
};

// Article manuel de la liste de courses (#216, US-47, RG-40→43). Scopé
// foyer + ANCRE de cycle (pas semaine, cf. #257 : etat_courses_article a été
// re-clée par ancre AVANT l'écriture de cette feature) — ne survit pas à un
// changement de cycle (pas de récurrence automatique en V1). Quantité/unité
// optionnelles (RG-43) : saisie structurée mais non obligatoire. État coché
// porté DIRECTEMENT par la ligne (colonne dédiée), à la différence des
// ingrédients dérivés de recette dont la coche vit dans le blob localStorage
// `courses_cochees` / la table etat_courses_article — exempte donc l'article
// manuel de l'invalidation à la régénération (RG-41).
export type ArticleManuel = {
  id: string;
  libelle: string;
  quantite: number | null;
  unite: Unite | null;
  categorie: CategorieIngredient;
  fondDePlacard: boolean;
  coche: boolean;
};

// Forme DB (snake_case) de la table `article_manuel`.
export type DbArticleManuel = {
  id: string;
  foyer_id: string;
  ancre: string; // date ISO "AAAA-MM-JJ" du cycle de courses (#257)
  libelle: string;
  quantite: number | null;
  unite: Unite | null;
  categorie: CategorieIngredient;
  fond_de_placard: boolean;
  coche: boolean;
  cree_le: string;
};

export type LignesCourses = {
  categorie: CategorieIngredient;
  ingredients: Ingredient[];
};

export type ListeCourses = {
  normal: LignesCourses[];     // ingrédients à acheter
  fondDePlacard: Ingredient[]; // à vérifier avant d'acheter
};

// ============================================================================
// TYPES BASE DE DONNÉES — réponses Supabase
// ============================================================================
// Ces types reflètent exactement le schéma SQL.
// snake_case, relations imbriquées telles que retournées par Supabase.
// Ne pas les utiliser directement dans la logique métier —
// passer par lib/adapters.ts pour les convertir en types domaine.

export type DbIngredient = {
  id: string;
  nom: string;
  categorie: CategorieIngredient;
  fond_de_placard: boolean;
  created_at: string;
};

export type DbRecetteIngredient = {
  id: string;
  recette_id: string;
  ingredient_id: string;
  quantite: number;
  unite: Unite;
  ingredient: DbIngredient; // relation imbriquée via Supabase select
};

// État des coches de la liste de courses — UNE LIGNE PAR ARTICLE depuis #56 PR4
// (anti-clobber temps réel, RG-32 ; remplace le blob JSONB par foyer+semaine).
// `cle` = clé d'agrégation « nom|unité » (RG-05) ; `quantite` = quantité au
// moment du cochage (invalidation RG-12). Le blob localStorage reste, lui, un
// Record<cle, quantite> reconstruit depuis ces lignes (cf. lib/coches.ts).
export type DbEtatCourseArticle = {
  foyer_id: string;
  // Re-clé sur l'ancre du cycle de courses (#257) : la fenêtre n'est plus la
  // semaine ISO mais `ancre` (date "AAAA-MM-JJ" du jour de courses foyer).
  ancre: string;
  cle: string;
  quantite: number;
  updated_at: string;
};

// Forme DB de `cycle_courses` (#257) — longueur par cycle (création paresseuse ;
// absent = LONGUEUR_DEFAUT). `cle` métier = (foyer_id, ancre).
export type DbCycleCourses = {
  foyer_id: string;
  ancre: string;    // date ISO "AAAA-MM-JJ"
  longueur: number; // 1..14
  updated_at: string;
};

export type DbRecette = {
  id: string;
  // Créateur de la recette, CONSERVÉ depuis #56 PR2 (en plus de foyer_id).
  user_id: string;
  // Propriété par foyer (#56 PR2). `null` = catalogue global en lecture seule
  // (le marqueur du global est passé de `user_id IS NULL` à `foyer_id IS NULL`).
  foyer_id: string | null;
  nom: string;
  temps_preparation: TempsPreparation;
  vegetarien: boolean;
  // Accompagnement (#49, P11) : `null` en base = non caractérisé (mappé vers
  // `undefined` côté domaine).
  accompagnement: Accompagnement | null;
  // Saisons (#23, P12) : tableau Postgres text[] ; `null` ou `[]` = toute saison.
  saisons: Saison[] | null;
  // Étapes (#233) : tableau Postgres text[] ; `null`/vide = pas d'étapes (mappé
  // vers `undefined` côté domaine).
  etapes: string[] | null;
  created_at: string;
  recette_ingredient: DbRecetteIngredient[]; // relation imbriquée
};

export type DbPlanning = {
  id: string;
  // Propriété par foyer (#56 PR2 : user_id retiré au profit de foyer_id ;
  // unicité (foyer_id, semaine)).
  foyer_id: string;
  semaine: string;
  // Incrémenté par la RPC sauvegarder_planning à chaque upsert (#56 PR2) ;
  // base de la détection de l'alerte intrusive (#56 PR5).
  version: number;
  created_at: string;
  updated_at: string; // last-write-wins entre devices (#6), posé par trigger serveur (#104)
};

export type DbPlanningSlot = {
  id: string;
  planning_id: string;
  recette_id: string;
  jour: Jour;
  type_repas: "dejeuner" | "diner";
  personnes: number; // nombre de personnes du slot (US-07)
  restes: boolean; // slot marqué « restes » (US-12)
  recette: DbRecette; // relation imbriquée
};

// Profil utilisateur (#22 PR1) — table `profiles` (#56 PR1) étendue. `prenom` et
// `couleur_avatar` sont NULL tant que l'onboarding n'a pas tranché ;
// `onboarding_complete` pilote la redirection vers le tunnel /bienvenue (PR2).
// `foyer_id` n'est PAS exposé ici : les changements de foyer passent par les RPC
// dédiées, pas par l'édition du profil.
export type Profil = {
  prenom: string | null;
  couleurAvatar: string | null;
  onboardingComplete: boolean;
};

// Forme DB (snake_case) du sous-ensemble « identité » de `profiles`.
export type DbProfil = {
  prenom: string | null;
  couleur_avatar: string | null;
  onboarding_complete: boolean;
};
