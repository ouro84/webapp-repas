// Outil MCP `chercher_recettes` (#320, RG-85) : recherche de recettes par
// attributs, en lecture seule. L'assistant s'en sert pour trouver des
// remplaçants qui collent à une tendance (« semaine = rapide », « mercredi
// végé »…), puis applique par `remplacer_repas(recette)`.
//
// Client Supabase « par jeton » injecté (RG-71) : la RLS borne les recettes au
// foyer et au catalogue ; `chargerRecettes` exclut déjà les recettes masquées.

import { chargerRecettes } from "@/lib/recettes"
import { filtrerRecettes } from "@/lib/recherche"
import { estDeSaison } from "@/lib/saisons"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { Accompagnement, Recette, Saison, TempsPreparation } from "@/types"

export type FiltresRecettes = {
  texte?: string
  temps_preparation?: TempsPreparation
  vegetarien?: boolean
  accompagnement?: Accompagnement
  saison?: Saison
}

export type RecetteTrouveeMcp = {
  nom: string
  temps_preparation: TempsPreparation
  vegetarien: boolean
  accompagnement: Accompagnement | null
  /** [] = toute l'année. */
  saisons: Saison[]
  origine: "foyer" | "catalogue"
}

const RECETTES_MAX = 10

/**
 * Ids des recettes du foyer (`foyer_id` non nul ; RLS : jamais celles d'un
 * autre foyer). Partagé avec `homonymeDuFoyer` (`ecriture-planning.ts`) : une
 * seule lecture de « qui est du foyer ».
 */
export async function idsRecettesDuFoyer(supabase: ClientSupabase): Promise<Set<string>> {
  const { data, error } = await supabase.from("recette").select("id").not("foyer_id", "is", null)
  if (error) throw new Error(`Lecture des recettes du foyer impossible : ${error.message}`)
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
}

// Tirage sans remise de `n` éléments (Fisher-Yates partiel). Sans tirage au-delà
// de RECETTES_MAX, l'assistant reproposerait toujours les 10 premières par ordre
// alphabétique, contraire à la variété voulue.
function tirer<T>(elements: T[], n: number, aleatoire: () => number): T[] {
  const copie = [...elements]
  const m = Math.min(n, copie.length)
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(aleatoire() * (copie.length - i))
    ;[copie[i], copie[j]] = [copie[j], copie[i]]
  }
  return copie.slice(0, m)
}

/**
 * `chercher_recettes` : tous les filtres présents s'appliquent (ET). `total`
 * est le nombre de correspondances ; au-delà de `RECETTES_MAX`, 10 sont tirées
 * au hasard (`aleatoire`, injectable) puis triées par nom. N'écrit rien.
 */
export async function chercherRecettes(
  supabase: ClientSupabase,
  filtres: FiltresRecettes,
  aleatoire: () => number = Math.random
): Promise<{ recettes: RecetteTrouveeMcp[]; total: number }> {
  const [toutes, idsFoyer] = await Promise.all([chargerRecettes(supabase), idsRecettesDuFoyer(supabase)])

  let trouvees: Recette[] = filtres.texte !== undefined ? filtrerRecettes(toutes, filtres.texte) : toutes
  const { temps_preparation, vegetarien, accompagnement, saison } = filtres
  trouvees = trouvees.filter(
    (r) =>
      (temps_preparation === undefined || r.tempsPreparation === temps_preparation) &&
      (vegetarien === undefined || (r.vegetarien === true) === vegetarien) &&
      (accompagnement === undefined || r.accompagnement === accompagnement) &&
      (saison === undefined || estDeSaison(r, saison))
  )

  const retenues = trouvees.length > RECETTES_MAX ? tirer(trouvees, RECETTES_MAX, aleatoire) : trouvees
  return {
    recettes: retenues
      .map((r) => ({
        nom: r.nom,
        temps_preparation: r.tempsPreparation,
        vegetarien: r.vegetarien === true,
        accompagnement: r.accompagnement ?? null,
        saisons: r.saisons ?? [],
        origine: idsFoyer.has(r.id) ? ("foyer" as const) : ("catalogue" as const),
      }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    total: trouvees.length,
  }
}
