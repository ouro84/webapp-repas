// Raccourci « annuler » (US-09, RG-19) : Ctrl/Cmd+Z sans Maj, hors champ de
// saisie, où Ctrl+Z doit rester l'annulation native du texte (recherche du
// sélecteur de recette). Partagé par la vue Semaine (app/planning/page.tsx) et
// la vue Cycle (components/planning/vue-cycle.tsx) (#373, règle du jumeau).

export function estRaccourciAnnuler(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "target">
): boolean {
  if (e.key !== "z" && e.key !== "Z") return false
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return false
  const cible = e.target as HTMLElement | null
  return !(
    cible &&
    (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.isContentEditable)
  )
}
