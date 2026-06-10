// Heuristique d'accompagnement — cœur métier PUR (#49, P11).
//
// Aucune dépendance React / navigateur / Supabase : importable par le
// formulaire de recette (pré-cochage, Bonus B) et testable en isolation.
//
// Un accompagnement caractérise la garniture dominante d'un plat : `feculents`
// (pâtes, riz, pommes de terre…) ou `legumes` (plat tourné légumes). Beaucoup
// de plats n'ont PAS d'accompagnement identifiable (plat unique, soupe, viande
// seule, tarte) → la valeur est OPTIONNELLE (absente), comme Recette.vegetarien.
//
// ATTENTION — règle dupliquée : la migration `..._recette_accompagnement.sql`
// auto-tague le catalogue global avec la MÊME logique, ré-implémentée en SQL
// (regex `~*` sur le nom des ingrédients, motifs identiques à ceux ci-dessous).
// Toute évolution des motifs doit être répercutée dans cette migration (cf.
// piège CLAUDE.md). L'heuristique est volontairement imparfaite et « à
// compléter » : on tagge au mieux par le nom des ingrédients, faute de
// catégorie « féculents » et parce que `legumes-fruits` mêle légumes, aromates
// et fruits (et que les légumes surgelés vivent en catégorie `surgeles`).

import type { Accompagnement, Ingredient } from "@/types"

// Normalise un nom d'ingrédient pour la comparaison : minuscules, sans accents.
// (Le jumeau SQL s'appuie sur `~*`, insensible à la casse ; les motifs n'usent
// pas d'accents — l'input est désaccentué ici, et les noms du catalogue sont en
// minuscules.)
function normaliser(nom: string): string {
  return nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

// Féculents reconnus par le nom (sur texte normalisé, donc sans accent) : pâtes
// & dérivés, riz, céréales, légumineuses sèches, pommes de terre / patates (qui
// sont nutritionnellement des féculents bien que classées `legumes-fruits`),
// frites, crozets. `\briz\b` borné pour éviter de matcher au milieu d'un mot.
export const FECULENTS_RX =
  /p[âa]?tes|spaghettis?|tagliatelles?|pennes?|macaronis?|coquillettes?|lasagnes?|nouilles?|raviolis?|gnocchis?|ravioles?|fusillis?|farfalles?|linguines?|tortellinis?|vermicelles?|\briz\b|risotto|quinoa|semoule|couscous|boulg(?:h)?our|ebly|polenta|millet|sarrasin|epeautre|lentilles?|pois chiches?|haricots? (?:blanc|rouge|noir)s?|flageolets?|pommes? de terre|patates?|frites?|crozets?|puree/

// Légumes d'accompagnement reconnus par le nom (liste positive : robuste aux
// catégories — capte les légumes surgelés —, et insensible aux aromates / fruits
// que `legumes-fruits` mêle). « à compléter » au fil des recettes ajoutées.
export const LEGUMES_RX =
  /haricots? verts?|petits? pois|brocolis?|choux?-?fleurs?|choux?|carottes?|courgettes?|epinards?|ratatouille|poireaux?|legumes? verts?|betteraves?|butternut|potirons?|courges?|aubergines?|poivrons?|fenouil|navets?|panais|salsifis|endives?|blettes?|asperges?|champignons?|tomates?|concombres?|salades?|laitue|roquette|mache|cresson|artichauts?|celeri|edamame|poelee|piperade/

/**
 * Suggère l'accompagnement d'une recette à partir de ses ingrédients (#49).
 *
 * Règle (volontairement simple, imparfaite, « à compléter ») :
 *  - `feculents` si la recette contient un féculent identifié par son nom —
 *                la garniture dominante est alors le féculent (priorité) ;
 *  - `legumes`   sinon, si elle contient au moins un légume identifié ;
 *  - `null`      sinon (plat non caractérisé : viande/œuf seuls, tarte, ambigu).
 *
 * Le féculent l'emporte sur le légume : un plat « riz + tomates » est tagué
 * `feculents` (l'accompagnement est le riz, la tomate n'est qu'une base de
 * sauce) — on ne sur-promet pas un repas « légumes ».
 *
 * Ne lit que le `nom` des ingrédients (l'input peut donc être des lignes de
 * formulaire en cours de saisie, sans quantité valide).
 */
export function suggererAccompagnement(
  ingredients: ReadonlyArray<Pick<Ingredient, "nom">>
): Accompagnement | null {
  const noms = ingredients.map((i) => normaliser(i.nom))
  if (noms.some((n) => FECULENTS_RX.test(n))) return "feculents"
  if (noms.some((n) => LEGUMES_RX.test(n))) return "legumes"
  return null
}
