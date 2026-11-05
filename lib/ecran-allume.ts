"use client"

// Écran maintenu allumé pendant la lecture d'une recette sur /ce-soir (#336).
//
// Screen Wake Lock API, demandé automatiquement (pas d'interrupteur, décision
// actée). Le navigateur relâche le verrou dès que la page passe en arrière-
// plan : on le redemande au retour (`visibilitychange` → visible), et on le
// relâche au démontage. Navigateur sans API, refus (batterie faible, iframe,
// page non visible) : simple `console.warn`, jamais d'erreur visible — la
// recette reste lisible, seul le confort est perdu.

import { useEffect } from "react"

export function useEcranAllume(actif: boolean): void {
  useEffect(() => {
    if (!actif) return
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return

    let verrou: WakeLockSentinel | null = null
    let enCours = false
    let termine = false

    async function demander(): Promise<void> {
      if (document.visibilityState !== "visible") return
      if (enCours || (verrou && !verrou.released)) return
      enCours = true
      try {
        const obtenu = await navigator.wakeLock.request("screen")
        if (termine) {
          // Démonté pendant la demande : on rend aussitôt le verrou.
          await obtenu.release()
          return
        }
        verrou = obtenu
      } catch (erreur) {
        console.warn("Écran non maintenu allumé (Wake Lock refusé).", erreur)
      } finally {
        enCours = false
      }
    }

    function surVisibilite(): void {
      if (document.visibilityState === "visible") void demander()
    }

    void demander()
    document.addEventListener("visibilitychange", surVisibilite)
    return () => {
      termine = true
      document.removeEventListener("visibilitychange", surVisibilite)
      const aRelacher = verrou
      verrou = null
      if (aRelacher && !aRelacher.released) {
        aRelacher.release().catch((erreur: unknown) => {
          console.warn("Relâche du Wake Lock échouée.", erreur)
        })
      }
    }
  }, [actif])
}
