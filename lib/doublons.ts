// Détection des doublons de recettes — cœur métier PUR (#56 PR3, bonus dédup).
//
// Aucune dépendance React / navigateur / Supabase : testable en isolation.
//
// À l'onboarding (RG-33), la fusion des catalogues conserve les collisions de
// noms SANS fusionner les ingrédients (« Lasagnes » de l'un + « Lasagnes » de
// l'autre = deux recettes). Le bonus « dé-doublonnage assisté » détecte ces
// collisions pour proposer un nettoyage guidé après une jonction. RG-33 parle
// de « même titre exact » ; on tolère la casse et les accents pour attraper
// « Lasagnes » vs « lasagnes » vs « Lasagne » (espaces compactés).

import type { Recette } from "@/types"

/** Normalise un nom de recette pour la comparaison : minuscules, sans accents,
 *  espaces compactés et rognés (même esprit que la normalisation de
 *  lib/accompagnement.ts). */
export function normaliserNom(nom: string): string {
  return nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
}

/** Un groupe de recettes partageant le même nom normalisé (collision). `nom`
 *  reprend le libellé de la première recette du groupe (pour l'affichage). */
export type GroupeDoublon = { nom: string; recettes: Recette[] }

/**
 * Regroupe les recettes par nom normalisé et ne renvoie que les groupes d'au
 * moins deux recettes (les collisions à nettoyer). L'ordre des groupes suit la
 * première apparition de chaque nom dans la liste fournie.
 */
export function detecterDoublons(recettes: Recette[]): GroupeDoublon[] {
  const parNom = new Map<string, Recette[]>()
  for (const recette of recettes) {
    const cle = normaliserNom(recette.nom)
    const groupe = parNom.get(cle)
    if (groupe) groupe.push(recette)
    else parNom.set(cle, [recette])
  }
  return [...parNom.values()]
    .filter((groupe) => groupe.length > 1)
    .map((groupe) => ({ nom: groupe[0].nom, recettes: groupe }))
}
