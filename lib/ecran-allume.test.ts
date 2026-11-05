import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useEcranAllume } from "@/lib/ecran-allume"

type Verrou = { released: boolean; release: ReturnType<typeof vi.fn> }

function installerWakeLock(request: () => Promise<unknown>): void {
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request: vi.fn(request) },
  })
}

function nouveauVerrou(): Verrou {
  const v: Verrou = {
    released: false,
    release: vi.fn(async () => {
      v.released = true
    }),
  }
  return v
}

function definirVisibilite(etat: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: etat })
  document.dispatchEvent(new Event("visibilitychange"))
}

afterEach(() => {
  // @ts-expect-error — nettoyage du mock posé sur navigator
  delete navigator.wakeLock
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
  vi.restoreAllMocks()
})

describe("useEcranAllume (#336)", () => {
  it("demande le verrou à l'activation et le relâche au démontage", async () => {
    const verrou = nouveauVerrou()
    installerWakeLock(async () => verrou)
    const { unmount } = renderHook(() => useEcranAllume(true))
    await waitFor(() => expect(navigator.wakeLock.request).toHaveBeenCalledWith("screen"))
    await Promise.resolve()
    unmount()
    expect(verrou.release).toHaveBeenCalled()
  })

  it("redemande le verrou au retour sur la page", async () => {
    const premier = nouveauVerrou()
    installerWakeLock(async () => premier)
    renderHook(() => useEcranAllume(true))
    await waitFor(() => expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1))
    premier.released = true // le navigateur relâche en arrière-plan
    definirVisibilite("hidden")
    definirVisibilite("visible")
    await waitFor(() => expect(navigator.wakeLock.request).toHaveBeenCalledTimes(2))
  })

  it("inactif : ne demande rien", () => {
    installerWakeLock(async () => nouveauVerrou())
    renderHook(() => useEcranAllume(false))
    expect(navigator.wakeLock.request).not.toHaveBeenCalled()
  })

  it("refus toléré : simple avertissement, pas d'exception", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {})
    installerWakeLock(async () => {
      throw new DOMException("refusé", "NotAllowedError")
    })
    renderHook(() => useEcranAllume(true))
    await waitFor(() => expect(avertir).toHaveBeenCalled())
  })

  it("navigateur sans API : aucun effet", () => {
    expect(() => renderHook(() => useEcranAllume(true))).not.toThrow()
  })
})
