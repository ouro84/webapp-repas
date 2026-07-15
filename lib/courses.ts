// Agrégation de la liste de courses — logique métier pure (sans UI)
//
// Implémente la règle métier RG-05 de SPECS_FONCTIONNELLES.md (section 6).
// Aucune dépendance à React, au navigateur ou à Supabase : testable en isolation.

import type {
  Planning,
  Ingredient,
  ListeCourses,
  LignesCourses,
  CategorieIngredient,
} from "@/types"
import {
  arrondirQuantite,
  facteurEchelle,
  personnesDuSlot,
} from "@/lib/personnes"
import { estRestes } from "@/lib/restes"

// Ordre d'affichage des catégories dans la liste de courses (RG-05, étape 5).
// Suit le parcours type d'un magasin : frais d'abord, surgelés en dernier.
// Exportée : réutilisée par lib/articles-manuels.ts (#216) pour insérer une
// catégorie d'article manuel absente de la liste dérivée, au bon rang.
export const ORDRE_CATEGORIES: CategorieIngredient[] = [
  "viandes-poissons",
  "legumes-fruits",
  "produits-frais",
  "epicerie",
  "boulangerie",
  "surgeles",
  "autre",
]

// Clé d'agrégation d'un ingrédient : nom insensible à la casse + unité.
// Deux occurrences ne fusionnent que si elles partagent la même unité —
// cas limite RG-05 : "200 g" et "1 piece" du même ingrédient restent
// sur deux lignes distinctes, sans tentative de conversion.
// Exportée : sert aussi d'identité aux coches de la liste (RG-12).
export function cleAgregation(ingredient: Ingredient): string {
  return `${ingredient.nom.toLocaleLowerCase("fr")}|${ingredient.unite}`
}

// Tri alphabétique français (accents et casse neutralisés).
function comparerNoms(a: Ingredient, b: Ingredient): number {
  return a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" })
}

/**
 * Construit la liste de courses agrégée à partir d'un planning.
 *
 * Règles métier appliquées (RG-05) :
 *  1. Collecte tous les ingrédients de toutes les recettes du planning
 *     (dîners de chaque jour + déjeuners du week-end), chaque quantité mise
 *     à l'échelle ×N/2 selon le nombre de personnes du slot (RG-17).
 *  2. Regroupe par nom d'ingrédient, insensible à la casse.
 *  3. Additionne les quantités pour les ingrédients de même nom ET même unité,
 *     puis arrondit le total par type d'unité (RG-17).
 *     Cas limite : même nom mais unités différentes → deux lignes distinctes,
 *     aucune conversion n'est tentée.
 *  4. Sépare les ingrédients `fondDePlacard: true` dans une section dédiée
 *     (affichée avec la mention "à vérifier avant d'acheter", F-09).
 *  5. Trie les ingrédients normaux par catégorie (ordre : viandes-poissons,
 *     legumes-fruits, produits-frais, epicerie, boulangerie, surgeles, autre),
 *     puis par nom alphabétique dans chaque catégorie.
 *     Les fonds de placard sont triés par nom alphabétique.
 *
 * Note : la cohérence de `categorie` et `fondDePlacard` entre les occurrences
 * d'un même ingrédient est une discipline de saisie (section 5.2) — en cas de
 * divergence, la première occurrence rencontrée fait foi.
 */
export function genererListeCourses(planning: Planning): ListeCourses {
  // Étape 1 — collecte : toutes les recettes du planning, tous slots confondus.
  // Chaque slot est mis à l'échelle selon son nombre de personnes (RG-17) :
  // l'échelle est appliquée AVANT agrégation, l'arrondi APRÈS (cf. étape 3).
  const ingredients: Ingredient[] = []
  for (const jp of planning.jours) {
    // Un slot marqué « restes » n'est pas cuisiné → exclu de la collecte (RG-22).
    // Un slot absent (créneau désactivé, #217) l'est aussi (RG-46).
    if (jp.diner && !estRestes(jp, "diner")) {
      const facteurDiner = facteurEchelle(personnesDuSlot(jp, "diner"))
      for (const ing of jp.diner.ingredients) {
        ingredients.push({ ...ing, quantite: ing.quantite * facteurDiner })
      }
    }
    if (jp.dejeuner && !estRestes(jp, "dejeuner")) {
      const facteurDejeuner = facteurEchelle(personnesDuSlot(jp, "dejeuner"))
      for (const ing of jp.dejeuner.ingredients) {
        ingredients.push({ ...ing, quantite: ing.quantite * facteurDejeuner })
      }
    }
  }

  // Étapes 2 & 3 — agrégation par nom (insensible à la casse) + unité.
  // La Map préserve la casse et les attributs de la première occurrence.
  const agreges = new Map<string, Ingredient>()
  for (const ingredient of ingredients) {
    const cle = cleAgregation(ingredient)
    const existant = agreges.get(cle)
    if (existant) {
      existant.quantite += ingredient.quantite
    } else {
      agreges.set(cle, { ...ingredient }) // copie : ne jamais muter le planning
    }
  }

  // Arrondi APRÈS agrégation (RG-17) : évite de cumuler les erreurs d'arrondi
  // entre plusieurs repas contribuant au même ingrédient.
  for (const ingredient of agreges.values()) {
    ingredient.quantite = arrondirQuantite(ingredient.quantite, ingredient.unite)
  }

  // Étape 4 — séparation fond de placard / ingrédients à acheter.
  const normaux: Ingredient[] = []
  const fondDePlacard: Ingredient[] = []
  for (const ingredient of agreges.values()) {
    if (ingredient.fondDePlacard) {
      fondDePlacard.push(ingredient)
    } else {
      normaux.push(ingredient)
    }
  }

  // Étape 5 — tri : catégories dans l'ordre canonique, noms alphabétiques.
  // Seules les catégories réellement présentes apparaissent dans la liste.
  const normal: LignesCourses[] = ORDRE_CATEGORIES.map((categorie) => ({
    categorie,
    ingredients: normaux
      .filter((i) => i.categorie === categorie)
      .sort(comparerNoms),
  })).filter((ligne) => ligne.ingredients.length > 0)

  fondDePlacard.sort(comparerNoms)

  return { normal, fondDePlacard }
}
