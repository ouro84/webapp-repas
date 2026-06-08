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
};

export type Recette = {
  id: string;
  nom: string;
  tempsPreparation: TempsPreparation;
  ingredients: Ingredient[];
};

export type JourPlanning = {
  jour: Jour;
  dejeuner?: Recette; // peuplé chaque jour à la génération (#3) ; optionnel pour
                      // relire les plannings antérieurs à 14 repas
  diner: Recette;
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

// État des coches de la liste de courses, par utilisateur (US-13, sync #6).
// `coches` est le même objet que localStorage["courses_cochees"] : un mapping
// { "nom|unité": quantité au moment du cochage } (RG-12), stocké en JSONB.
export type DbEtatCourses = {
  user_id: string;
  coches: Record<string, number>;
  updated_at: string;
};

export type DbRecette = {
  id: string;
  user_id: string;
  nom: string;
  temps_preparation: TempsPreparation;
  created_at: string;
  recette_ingredient: DbRecetteIngredient[]; // relation imbriquée
};

export type DbPlanning = {
  id: string;
  user_id: string;
  semaine: string;
  created_at: string;
  updated_at: string; // last-write-wins entre devices (#6)
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
