// Horodatage des CGU après une connexion Google (US-57, RG-92).
//
// Le bouton Google porte la mention « En continuant, tu acceptes les CGU » :
// atteindre le callback vaut acceptation. Un compte créé via Google n'a pas
// passé par /signup, donc `profiles.cgu_version` est vide : on l'horodate ici.
// Un compte existant (connexion Google sur un compte déjà horodaté) n'est
// jamais réécrit : la date d'acceptation d'origine est conservée.

import { CGU_VERSION_ACTUELLE } from "@/lib/legal"
import type { ClientSupabase } from "@/lib/supabase/types"

/**
 * Écrit `cgu_version` / `cgu_acceptees_le` si `cgu_version` est nulle, en une
 * seule requête atomique (`update … where user_id = … and cgu_version is null`) :
 * pas de lecture préalable, donc pas de fenêtre entre lecture et écriture.
 * Zéro ligne touchée = compte déjà horodaté (cas normal) ou profil absent ;
 * les deux sont indiscernables sans relecture, on ne logge donc que les erreurs.
 * Best-effort : toute erreur est loggée puis avalée, la connexion déjà
 * réussie côté auth ne doit pas échouer pour un horodatage manqué.
 */
export async function horodaterCguSiAbsentes(
  client: ClientSupabase,
  userId: string
): Promise<void> {
  try {
    const { error } = await client
      .from("profiles")
      .update({
        cgu_version: CGU_VERSION_ACTUELLE,
        cgu_acceptees_le: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .is("cgu_version", null)
    if (error) {
      console.error("Horodatage de l'acceptation des CGU échoué.", error)
    }
  } catch (err) {
    console.error("Horodatage de l'acceptation des CGU échoué.", err)
  }
}
