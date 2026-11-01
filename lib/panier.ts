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

/**
 * `motif` est un texte français lisible, stocké dans `motif_echec` et affiché
 * au foyer (§5.8, US-53) ; la cause brute ne va qu'au log.
 */
export type ResultatEnvoi = { ok: true } | { ok: false; motif: string }

/**
 * POST du webhook signé. Succès = réponse 2xx. Ne lève jamais : l'appelant
 * transforme un échec en demande `echec` / cause `injoignable` (RG-81).
 * Une redirection est un échec (`redirect: "error"`) : l'URL enregistrée est
 * la seule destination du webhook.
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
      redirect: "error",
      signal: AbortSignal.timeout(delaiMs),
    })
    // Le corps n'est pas lu : l'annuler libère la connexion. Ne lève jamais.
    await reponse.body?.cancel().catch(() => {})
    if (reponse.ok) return { ok: true }
    const motif = `réponse HTTP ${reponse.status}`
    console.error("[panier] webhook refusé par l’exécuteur :", motif)
    return { ok: false, motif }
  } catch (e) {
    // `AbortSignal.timeout` rejette avec une DOMException « TimeoutError » ;
    // test sur `name` seul, car une DOMException n'est pas toujours une Error.
    const delaiDepasse =
      typeof e === "object" && e !== null && "name" in e && e.name === "TimeoutError"
    const motif = delaiDepasse
      ? `délai de ${(delaiMs / 1000).toLocaleString("fr-FR")} s dépassé`
      : "erreur réseau"
    console.error(`[panier] webhook injoignable (${motif}) :`, e)
    return { ok: false, motif }
  }
}

/** Réponse de la route quand l'exécuteur n'a pas pu être joint (RG-81). */
export const MESSAGE_INJOIGNABLE =
  "Ton exécuteur est injoignable : vérifie qu'il est allumé, puis réessaie."

// Rapport de l'exécuteur (RG-84) : `strict()` partout, pour qu'un identifiant de
// produit ou un prix en trop soit refusé plutôt qu'ignoré en silence. Chaque
// liste est plafonnée à 200 éléments ; la base plafonne aussi la taille du
// rapport (CHECK de `demande_panier.rapport`).
const texte = z.string().min(1).max(200)
const MAX_ELEMENTS = 200

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
    ).max(MAX_ELEMENTS),
    a_choisir: z.array(
      z
        .object({
          article: texte,
          raison: texte,
          candidats: z.array(texte).max(3),
        })
        .strict(),
    ).max(MAX_ELEMENTS),
    introuvables: z.array(z.object({ article: texte }).strict()).max(MAX_ELEMENTS),
  })
  .strict()

export type RapportPanier = z.infer<typeof schemaRapport>

/**
 * Messages des codes SQLSTATE levés par les RPC de demande de panier. Réutilisés
 * par la route (lus par une personne sur /courses) et par le MCP (OMQ03 est lu
 * par un assistant : il dit quoi faire ensuite).
 */
export const MESSAGES_PANIER: Record<"OMQ01" | "OMQ02" | "OMQ03" | "OMQ04", string> = {
  OMQ01: "Aucun exécuteur de panier n’est configuré pour ton foyer.",
  OMQ02: "Une demande de panier est déjà en cours : attends qu’elle se termine.",
  OMQ04: "Cycle terminé : le panier ne se remplit que pour un cycle en cours ou à venir.",
  OMQ03:
    "Cette demande ne peut plus recevoir de rapport : elle est inconnue, close, ou remplacée par une demande plus récente. Ne renvoie pas ce rapport et arrête-toi sans réessayer.",
}
