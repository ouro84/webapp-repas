// Types métier — Webapp Repas de la semaine
// Source de vérité : SPECS_FONCTIONNELLES.md section 5

// ---------------------------------------------------------------------------
// Ingrédient
// ---------------------------------------------------------------------------

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

export type Ingredient = {
  nom: string;
  quantite: number;
  unite: Unite;
  categorie: CategorieIngredient;
  fondDePlacard: boolean; // true = sel, huile, épices… — affiché à part dans la liste de courses
};

// ---------------------------------------------------------------------------
// Recette
// ---------------------------------------------------------------------------

export type TempsPreparation = "rapide" | "normal" | "long";
// rapide : < 20 min | normal : 20–45 min | long : > 45 min

export type Recette = {
  id: string;             // identifiant unique, ex: "poulet-roti"
  nom: string;            // ex: "Poulet rôti aux herbes"
  tempsPreparation: TempsPreparation;
  ingredients: Ingredient[];
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type Jour =
  | "lundi"
  | "mardi"
  | "mercredi"
  | "jeudi"
  | "vendredi"
  | "samedi"
  | "dimanche";

export type JourPlanning = {
  jour: Jour;
  dejeuner?: Recette; // uniquement samedi et dimanche en MVP
  diner: Recette;
};

export type Planning = {
  semaine: string;        // ex: "2026-W23"
  jours: JourPlanning[];  // 7 entrées, une par jour
};

// ---------------------------------------------------------------------------
// Liste de courses
// ---------------------------------------------------------------------------

export type LignesCourses = {
  categorie: CategorieIngredient;
  ingredients: Ingredient[];
};

export type ListeCourses = {
  normal: LignesCourses[];      // ingrédients à acheter
  fondDePlacard: Ingredient[];  // à vérifier avant d'acheter
};
