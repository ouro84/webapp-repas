// Saisonnalité — cœur métier PUR (#23, P12).
//
// Aucune dépendance React / navigateur / Supabase : importable par le
// générateur (lib/generateur.ts) et le formulaire de recette (pré-suggestion),
// testable en isolation.
//
// Mapping mois → saison (RG-02) :
//   Été       : juin, juillet, août, septembre
//   Automne   : octobre, novembre
//   Hiver     : décembre, janvier, février, mars
//   Printemps : avril, mai
//
// Une recette peut appartenir à plusieurs saisons (RG-01) ; `saisons` absent ou
// vide = disponible toute l'année (aucune contrainte). La suggestion par
// heuristique dérive les saisons des INGRÉDIENTS via une table produit→saisons
// (volontairement imparfaite, « à compléter »). Le tagging du catalogue global
// (migration) est généré depuis CETTE fonction (source unique, pas de jumeau
// SQL — cf. scripts/generer-saisons-recettes.mjs).

import type { Ingredient, Saison } from "@/types"

export const SAISONS: Saison[] = ["printemps", "ete", "automne", "hiver"]

export const LIBELLE_SAISON: Record<Saison, string> = {
  printemps: "Printemps",
  ete: "Été",
  automne: "Automne",
  hiver: "Hiver",
}

/** Saison d'un mois (0 = janvier … 11 = décembre), selon RG-02. */
export function saisonDuMois(mois: number): Saison {
  if (mois >= 5 && mois <= 8) return "ete" // juin → septembre
  if (mois === 9 || mois === 10) return "automne" // octobre, novembre
  if (mois === 3 || mois === 4) return "printemps" // avril, mai
  return "hiver" // décembre, janvier, février, mars
}

/**
 * Vrai si la recette est disponible pour la saison donnée : aucune saison
 * déclarée (absent/vide = toute l'année) OU la saison est dans la liste.
 */
export function estDeSaison(
  recette: { saisons?: Saison[] },
  saison: Saison
): boolean {
  return (
    !recette.saisons ||
    recette.saisons.length === 0 ||
    recette.saisons.includes(saison)
  )
}

// Normalise un nom d'ingrédient : minuscules, sans accents (parité avec
// lib/accompagnement.ts).
function normaliser(nom: string): string {
  return nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

// Table produit (stem normalisé) → saisons de pleine production en France.
// Recherche par SOUS-CHAÎNE : « tomate » couvre « tomates cerises », « poivron »
// couvre les trois couleurs, « navet » couvre « navets boule d'or », etc. Les
// produits absents de la table (aromates : ail/oignon/échalote, agrumes,
// produits de garde : pomme de terre/carotte/champignon…) sont considérés
// DISPONIBLES TOUTE L'ANNÉE et ne contraignent donc pas la saison. « à compléter ».
const PRODUITS_SAISON: { motif: string; saisons: Saison[] }[] = [
  // Légumes d'été
  { motif: "tomate", saisons: ["ete"] },
  { motif: "courgette", saisons: ["ete"] },
  { motif: "poivron", saisons: ["ete"] },
  { motif: "concombre", saisons: ["ete"] },
  { motif: "aubergine", saisons: ["ete"] },
  { motif: "haricot vert", saisons: ["ete"] },
  { motif: "mais", saisons: ["ete"] },
  // Légumes d'automne / hiver
  { motif: "butternut", saisons: ["automne", "hiver"] },
  { motif: "potiron", saisons: ["automne", "hiver"] },
  { motif: "courge", saisons: ["automne", "hiver"] }, // après butternut/courgette
  { motif: "brocoli", saisons: ["automne", "hiver"] },
  { motif: "chou-fleur", saisons: ["automne", "hiver"] },
  { motif: "choufleur", saisons: ["automne", "hiver"] },
  { motif: "chou de bruxelles", saisons: ["automne", "hiver"] },
  { motif: "navet", saisons: ["automne", "hiver"] },
  { motif: "poireau", saisons: ["automne", "hiver"] },
  { motif: "betterave", saisons: ["automne", "hiver"] },
  { motif: "endive", saisons: ["hiver"] },
  // Printemps
  { motif: "asperge", saisons: ["printemps"] },
  { motif: "radis", saisons: ["printemps"] },
  { motif: "petit pois", saisons: ["printemps", "ete"] },
  { motif: "fraise", saisons: ["printemps", "ete"] },
  { motif: "epinard", saisons: ["printemps", "automne"] },
  { motif: "fenouil", saisons: ["ete", "automne"] },
  { motif: "artichaut", saisons: ["printemps", "ete"] },
]

/**
 * Suggère les saisons d'une recette à partir de ses ingrédients (#23, RG-01).
 *
 * Règle : on collecte les ensembles de saisons des produits saisonniers de la
 * recette (table ci-dessus), puis on en prend l'INTERSECTION — la recette est de
 * saison quand TOUS ses produits saisonniers le sont ensemble. Cas particuliers :
 *  - aucun produit saisonnier → `[]` (toute l'année) ;
 *  - intersection vide (produits de saisons incompatibles, ex. tomate + courge)
 *    → `[]` (on ne sur-restreint pas : la recette reste disponible toute l'année).
 *
 * Ne lit que le `nom` des ingrédients (input = lignes de formulaire possible).
 */
export function suggererSaisons(
  ingredients: ReadonlyArray<Pick<Ingredient, "nom">>
): Saison[] {
  const ensembles: Saison[][] = []
  for (const ing of ingredients) {
    const n = normaliser(ing.nom)
    const entree = PRODUITS_SAISON.find((p) => n.includes(p.motif))
    if (entree) ensembles.push(entree.saisons)
  }
  if (ensembles.length === 0) return [] // aucun produit saisonnier → toute l'année

  // Intersection des ensembles de saisons.
  const intersection = SAISONS.filter((s) =>
    ensembles.every((set) => set.includes(s))
  )
  // Intersection vide (produits incompatibles) → toute l'année (repli souple).
  return intersection
}
