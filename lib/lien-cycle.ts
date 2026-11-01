// Lien profond vers un cycle de courses (#320, RG-87) : `/planning?cycle=AAAA-MM-JJ`
// ouvre la vue Cycle du planning sur le cycle contenant cette date. Helpers purs,
// partagés par le proxy (retour après connexion) et la page (lecture du paramètre).
import { estDateISO } from "@/lib/cycles"

export const PARAM_LIEN_CYCLE = "cycle"

/** La date du lien si elle est un `AAAA-MM-JJ` réel, sinon `null` (ignorée sans message). */
export function lireLienCycle(valeur: string | null): string | null {
  return valeur !== null && estDateISO(valeur) ? valeur : null
}

/**
 * Vrai pour `/planning` portant un paramètre `cycle`, même de valeur invalide :
 * le proxy ne juge pas la date, la page l'ignorera. `/planningx` n'en est pas un.
 */
export function estLienProfondCycle(pathname: string, params: URLSearchParams): boolean {
  return pathname === "/planning" && params.has(PARAM_LIEN_CYCLE)
}
