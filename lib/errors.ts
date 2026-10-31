import { NextResponse } from "next/server"

// ─── Côté serveur ─────────────────────────────────────────────────────────────

/**
 * Retourne une réponse d'erreur JSON standardisée et logue l'erreur technique.
 * Le `message` est destiné à l'utilisateur — ne pas y mettre de détails techniques.
 */
export function apiError(
  context: string,
  error: unknown,
  message: string,
  status: number = 500
): NextResponse {
  console.error(`[${context}]`, error)
  return NextResponse.json({ error: message }, { status })
}

// ─── Côté client ──────────────────────────────────────────────────────────────

/**
 * Messages affichés à l'utilisateur selon le code HTTP retourné par l'API.
 * Si l'API retourne un message dans { error: "..." }, il est prioritaire sur cette map.
 */
const HTTP_ERROR_MESSAGES: Record<number, string> = {
  400: "Les données envoyées sont invalides.",
  401: "Tu dois être connecté pour effectuer cette action.",
  403: "Tu n'es pas autorisé à effectuer cette action.",
  404: "La ressource demandée est introuvable.",
  429: "Trop de requêtes en peu de temps. Patiente un instant puis réessaie.",
  500: "Une erreur serveur s'est produite. Réessaie dans quelques instants.",
}

/**
 * Lit la réponse d'une requête fetch et retourne le message d'erreur à afficher.
 * Utilise le message de l'API si disponible, sinon fallback sur HTTP_ERROR_MESSAGES.
 */
export async function parseApiError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    // Seule une chaîne non vide est un message affichable : un objet ou un
    // nombre retomberait en « [object Object] » dans un toast.
    if (typeof body?.error === "string" && body.error) return body.error
  } catch {
    // Le corps n'est pas du JSON valide — on tombe sur le fallback
  }

  return (
    HTTP_ERROR_MESSAGES[response.status] ??
    `Erreur inattendue (code ${response.status}).`
  )
}
