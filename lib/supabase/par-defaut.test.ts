// @vitest-environment node
//
// Revue finale #304 : hors navigateur, le client navigateur par défaut des
// lectures serait un client ANONYME sans session (createBrowserClient ne lève
// pas sans cookies) → la RLS mon_foyer() renverrait silencieusement « rien »
// (liste vide, lundi, 7 j…). RG-71 : côté serveur, le client doit être injecté.

import { describe, expect, it, vi } from "vitest"

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://exemple.supabase.co")
vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon")

import { chargerLongueurCycle, chargerPlanningDistant } from "@/lib/persistance"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { chargerReglages } from "@/lib/reglages-data"

const MESSAGE = "Client Supabase requis côté serveur : passe le client de l'utilisateur."

describe("défaut client navigateur hors navigateur (RG-71)", () => {
  it("une lecture sans client injecté refuse au lieu de lire en anonyme", async () => {
    await expect(chargerPlanningDistant("2026-W44")).rejects.toThrow(MESSAGE)
    await expect(chargerLongueurCycle("2026-10-29")).rejects.toThrow(MESSAGE)
    await expect(chargerJourCoursesFoyer()).rejects.toThrow(MESSAGE)
    await expect(chargerReglages()).rejects.toThrow(MESSAGE)
  })
})
