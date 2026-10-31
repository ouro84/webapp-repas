// Panier d'enseigne : envoi du webhook à l'exécuteur et schéma du rapport (#308).
//
// OMQ n'appelle jamais l'enseigne et ne stocke aucun identifiant d'enseigne
// (RG-80) : il prévient seulement l'exécuteur du foyer par un webhook signé
// (RG-81), puis reçoit de lui un rapport sans identifiant de produit ni prix
// (RG-84). La signature est calculée côté Postgres (RPC `creer_demande_panier`,
// secret dans Vault) ; ce module ne fait qu'envoyer ce que la RPC a préparé.

import { z } from "zod"

/** Délai d'attente de la réponse de l'exécuteur ; aucune nouvelle tentative (RG-81). */
export const DELAI_WEBHOOK_MS = 10_000

/** Forme renvoyée par la RPC `creer_demande_panier`. */
export type EnvoiWebhook = {
  demande_id: string
  url: string
  entetes: Record<string, string>
  /** Texte exact signé : à envoyer tel quel, sans re-sérialisation (RG-81). */
  corps: string
}

export type ResultatEnvoi = { ok: true } | { ok: false; motif: string }

/**
 * POST du webhook signé. Succès = réponse 2xx. Ne lève jamais : l'appelant
 * transforme un échec en demande `echec` / cause `injoignable` (RG-81).
 */
export async function envoyerWebhook(
  envoi: EnvoiWebhook,
  options: { fetch?: typeof fetch; delaiMs?: number } = {},
): Promise<ResultatEnvoi> {
  const appeler = options.fetch ?? fetch
  const delaiMs = options.delaiMs ?? DELAI_WEBHOOK_MS
  try {
    const reponse = await appeler(envoi.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...envoi.entetes },
      body: envoi.corps,
      signal: AbortSignal.timeout(delaiMs),
    })
    if (reponse.ok) return { ok: true }
    const motif = `HTTP ${reponse.status}`
    console.error("[panier] webhook refusé par l’exécuteur :", motif)
    return { ok: false, motif }
  } catch (e) {
    const motif = e instanceof Error ? e.message : String(e)
    console.error("[panier] webhook injoignable :", motif)
    return { ok: false, motif }
  }
}

// Rapport de l'exécuteur (RG-84) : `strict()` partout, pour qu'un identifiant de
// produit ou un prix en trop soit refusé plutôt qu'ignoré en silence.
const texte = z.string().min(1).max(200)

export const schemaRapport = z
  .object({
    ajoutes: z.array(
      z
        .object({
          article: texte,
          produit: texte,
          marque: texte,
          quantite: z.number().int().min(1),
        })
        .strict(),
    ),
    a_choisir: z.array(
      z
        .object({
          article: texte,
          raison: texte,
          candidats: z.array(texte).max(3),
        })
        .strict(),
    ),
    introuvables: z.array(z.object({ article: texte }).strict()),
  })
  .strict()

export type RapportPanier = z.infer<typeof schemaRapport>

/**
 * Messages des codes SQLSTATE levés par les RPC de demande de panier. Réutilisés
 * par la route (lus par une personne sur /courses) et par le MCP (OMQ03 est lu
 * par un assistant : il dit quoi faire ensuite).
 */
export const MESSAGES_PANIER: Record<"OMQ01" | "OMQ02" | "OMQ03", string> = {
  OMQ01:
    "Aucun exécuteur de panier n’est enregistré pour ce foyer. Enregistrez-en un avant de préparer le panier.",
  OMQ02:
    "Une demande de panier est déjà en cours pour ce foyer. Attendez son rapport ou son échec avant d’en lancer une autre.",
  OMQ03:
    "Cette demande ne peut plus recevoir de rapport : elle est inconnue, pas en cours, ou remplacée par une demande plus récente. Ne renvoyez pas ce rapport ; reprenez la demande de panier la plus récente du foyer.",
}
