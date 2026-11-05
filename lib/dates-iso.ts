// lib/dates-iso.ts
// Dates ISO « AAAA-MM-JJ » en heure LOCALE (jamais d'UTC : le jour calendaire
// affiché doit être celui visé, cf. #171). Module FEUILLE, sans import interne
// (#352) : lib/cycles.ts (qui les réexporte) et lib/planning-affichage.ts en
// dépendent tous deux sans import circulaire.

export function versISO(d: Date): string {
  const a = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const j = String(d.getDate()).padStart(2, "0")
  return `${a}-${m}-${j}`
}

export function depuisISO(dateISO: string): Date {
  const [a, m, j] = dateISO.split("-").map(Number)
  return new Date(a, m - 1, j)
}
