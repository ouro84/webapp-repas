import { describe, expect, it } from "vitest"
import { cleHorodatage } from "@/lib/horodatage"

describe("cleHorodatage", () => {
  it("compare à la microseconde malgré les zéros finaux tronqués par Postgres", () => {
    const plusRecent = cleHorodatage("2026-06-15T10:00:01.94056+00:00")
    const plusAncien = cleHorodatage("2026-06-15T10:00:01.9405+00:00")
    expect(plusRecent).not.toBeNull()
    expect(plusAncien).not.toBeNull()
    expect(plusRecent! > plusAncien!).toBe(true)
  })

  it("donne la même clé pour deux formats d'un même instant (Realtime / RETURNING)", () => {
    expect(cleHorodatage("2026-06-15T10:00:01.5+00:00")).toBe(
      cleHorodatage("2026-06-15 10:00:01.500000+00")
    )
  })

  it("renvoie null pour une valeur absente ou illisible", () => {
    expect(cleHorodatage(null)).toBeNull()
    expect(cleHorodatage(undefined)).toBeNull()
    expect(cleHorodatage("")).toBeNull()
    expect(cleHorodatage("pas une date")).toBeNull()
  })
})
