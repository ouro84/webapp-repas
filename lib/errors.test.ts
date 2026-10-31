// Traduction d'une réponse d'API en message affichable (parseApiError) :
// message de la route d'abord, repli par code HTTP sinon.
import { describe, expect, it } from "vitest"
import { parseApiError } from "@/lib/errors"

const reponse = (corps: string, status: number) => new Response(corps, { status })

describe("parseApiError", () => {
  it("reprend body.error quand c'est une chaîne", async () => {
    await expect(parseApiError(reponse(JSON.stringify({ error: "Message de la route." }), 409))).resolves.toBe(
      "Message de la route."
    )
  })

  it("body.error qui n'est pas une chaîne → repli par code HTTP", async () => {
    await expect(parseApiError(reponse(JSON.stringify({ error: { code: "X" } }), 500))).resolves.toBe(
      "Une erreur serveur s'est produite. Réessaie dans quelques instants."
    )
    await expect(parseApiError(reponse(JSON.stringify({ error: 42 }), 418))).resolves.toBe(
      "Erreur inattendue (code 418)."
    )
  })

  it("corps non JSON → repli par code HTTP", async () => {
    await expect(parseApiError(reponse("<html>", 429))).resolves.toBe(
      "Trop de requêtes en peu de temps. Patiente un instant puis réessaie."
    )
  })
})
