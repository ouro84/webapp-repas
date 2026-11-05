import { describe, it, expect, beforeEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  basculerCoche,
  cleRepas,
  cochesPour,
  idIngredient,
  useCochesRepas,
} from "@/lib/coches-repas"

const CLE = cleRepas("2026-11-05", "diner")
const AUTRE = cleRepas("2026-11-06", "dejeuner")

describe("coches d'ingrédients de /ce-soir (#336, RG-89)", () => {
  it("clés stables : repas = date|créneau, ingrédient = nom|unité", () => {
    expect(CLE).toBe("2026-11-05|diner")
    expect(idIngredient({ nom: "riz", unite: "g" })).toBe("riz|g")
  })

  it("coche puis décoche un ingrédient du même repas", () => {
    const e1 = basculerCoche(null, CLE, "riz|g")
    expect([...cochesPour(e1, CLE)]).toEqual(["riz|g"])
    const e2 = basculerCoche(e1, CLE, "riz|g")
    expect(cochesPour(e2, CLE).size).toBe(0)
  })

  it("un état d'un autre repas se lit vide et est écrasé à la première coche", () => {
    const ancien = basculerCoche(null, AUTRE, "riz|g")
    expect(cochesPour(ancien, CLE).size).toBe(0)
    const nouveau = basculerCoche(ancien, CLE, "oignon|piece")
    expect(nouveau).toEqual({ cle: CLE, ids: ["oignon|piece"] })
  })

  it("état corrompu → rien de coché", () => {
    expect(cochesPour({ cle: CLE, ids: "x" as unknown as string[] }, CLE).size).toBe(0)
  })
})

describe("useCochesRepas", () => {
  beforeEach(() => localStorage.clear())

  it("persiste en localStorage et survit à un remontage (rechargement)", () => {
    const { result, unmount } = renderHook(() => useCochesRepas(CLE))
    act(() => result.current.basculer("riz|g"))
    expect(result.current.coches.has("riz|g")).toBe(true)
    unmount()
    const relu = renderHook(() => useCochesRepas(CLE))
    expect(relu.result.current.coches.has("riz|g")).toBe(true)
  })

  it("repas suivant : coches remises à zéro", () => {
    const { result } = renderHook(() => useCochesRepas(CLE))
    act(() => result.current.basculer("riz|g"))
    const suivant = renderHook(() => useCochesRepas(AUTRE))
    expect(suivant.result.current.coches.size).toBe(0)
  })

  it("stabilité du snapshot : pas de nouvelle référence sans écriture", () => {
    localStorage.setItem("coches_repas", JSON.stringify({ cle: CLE, ids: ["riz|g"] }))
    const { result, rerender } = renderHook(() => useCochesRepas(CLE))
    const premier = result.current.coches
    rerender()
    expect(result.current.coches).toBe(premier)
  })
})
