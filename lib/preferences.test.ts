// Préférences favoris/évités à client injecté (#306, RG-62) : « Changer » côté
// MCP les applique comme l'UI. Le client navigateur est mocké pour LEVER.

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => {
    throw new Error("client navigateur interdit côté serveur")
  }),
}))

import { chargerPreferences } from "@/lib/preferences"
import { creerSupabaseMock } from "@/tests/fixtures/supabase-mock"

describe("chargerPreferences — client injecté", () => {
  it("renvoie la carte recette → préférence du foyer", async () => {
    const { client } = creerSupabaseMock({
      tables: { recette_preference: { data: [{ recette_id: "r1", preference: "favorite" }], error: null } },
    })
    expect(await chargerPreferences(client)).toEqual(new Map([["r1", "favorite"]]))
  })
})
