// Logique calendaire — semaines ISO 8601 (sans UI, testable en isolation).
//
// Centralise tout ce qui touche à l'identifiant de semaine "AAAA-Wnn" :
// calcul depuis une date (génération), formatage lisible (affichage), plage
// de semaines sélectionnables et défaut (US-11, RG-21). Partagé entre le
// générateur (lib/generateur.ts) et la page planning.

import { saisonDuMois } from "@/lib/saisons"
import type { Saison } from "@/types"

// Numéro de semaine ISO 8601 au format "AAAA-Wnn" (ex: "2026-W23").
// L'année renvoyée est l'année ISO (celle du jeudi de la semaine), qui peut
// différer de l'année civile autour du 1er janvier / 31 décembre.
export function semaineISO(date: Date = new Date()): string {
  // On se place à midi UTC pour neutraliser les effets de fuseau horaire.
  const cible = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  )
  // ISO : le lundi vaut 1, le dimanche vaut 7 (et non 0).
  const jourSemaine = cible.getUTCDay() || 7
  // On décale jusqu'au jeudi de la semaine courante : il porte l'année ISO.
  cible.setUTCDate(cible.getUTCDate() + 4 - jourSemaine)
  const debutAnnee = new Date(Date.UTC(cible.getUTCFullYear(), 0, 1))
  const numero = Math.ceil(
    ((cible.getTime() - debutAnnee.getTime()) / 86_400_000 + 1) / 7
  )
  return `${cible.getUTCFullYear()}-W${String(numero).padStart(2, "0")}`
}

// "2026-W23" → "Semaine du 1 juin 2026" — bien plus lisible que l'identifiant
// ISO brut. Norme ISO 8601 : le 4 janvier appartient toujours à la semaine 1 ;
// on en déduit le lundi de la semaine 1, puis on avance de N-1 semaines.
// Tout est calculé en UTC pour être insensible au fuseau horaire.
export function formaterSemaine(semaine: string): string {
  const correspondance = /^(\d{4})-W(\d{2})$/.exec(semaine)
  if (!correspondance) return `Semaine ${semaine}` // format inattendu : affichage brut
  const annee = Number(correspondance[1])
  const numero = Number(correspondance[2])

  const quatreJanvier = new Date(Date.UTC(annee, 0, 4))
  const jourSemaine = quatreJanvier.getUTCDay() || 7 // ISO : lundi = 1 … dimanche = 7
  const lundi = new Date(quatreJanvier)
  lundi.setUTCDate(
    quatreJanvier.getUTCDate() - (jourSemaine - 1) + (numero - 1) * 7
  )

  const date = lundi.toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  return `Semaine du ${date}`
}

export type SemaineOption = {
  /** Identifiant ISO "AAAA-Wnn". */
  semaine: string
  /** Décalage en semaines par rapport à la semaine courante (0 = courante). */
  offset: number
}

/**
 * Semaines sélectionnables pour la génération (US-11, RG-21) : de la semaine
 * courante (offset 0) jusqu'à `nbFutur` semaines plus tard. Pas de passé.
 */
export function semainesSelectionnables(
  date: Date = new Date(),
  nbFutur = 6
): SemaineOption[] {
  const options: SemaineOption[] = []
  for (let offset = 0; offset <= nbFutur; offset++) {
    const d = new Date(date)
    d.setDate(date.getDate() + offset * 7)
    options.push({ semaine: semaineISO(d), offset })
  }
  return options
}

/** Libellé relatif d'un offset de semaine (affichage navigateur, #5). */
export function libelleRelatif(offset: number): string {
  if (offset === 0) return "Cette semaine"
  if (offset === 1) return "Semaine prochaine"
  if (offset === -1) return "Semaine dernière"
  if (offset > 1) return `Dans ${offset} semaines`
  return `Il y a ${-offset} semaines`
}

/** Nombre de semaines de `a` vers `b` (b plus tard → positif). */
export function decalageEntre(a: string, b: string): number {
  const la = lundiDeSemaine(a).getTime()
  const lb = lundiDeSemaine(b).getTime()
  return Math.round((lb - la) / (7 * 86_400_000))
}

// Lundi (date locale) d'une semaine ISO "AAAA-Wnn" — inverse de semaineISO.
//
// Arithmétique calendaire en heure LOCALE, volontairement (#171) : semaineISO()
// reconstruit l'identifiant à partir des getters LOCAUX (getFullYear/Month/Date)
// de la date qu'on lui passe. Produire ici un lundi en date locale est donc
// cohérent et garantit le round-trip exact `semaineDecalee(s, 0) === s` (testé).
// Le résultat est le jour calendaire local visé — aucune conversion UTC en jeu,
// donc indépendant du fuseau. Ne PAS « UTC-ifier » sans adapter semaineISO en
// miroir : on casserait le round-trip (faux positif d'audit écarté).
export function lundiDeSemaine(semaine: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(semaine)
  if (!m) return new Date()
  const annee = Number(m[1])
  const numero = Number(m[2])
  const quatreJanvier = new Date(annee, 0, 4)
  const jour = quatreJanvier.getDay() || 7
  const lundi = new Date(quatreJanvier)
  lundi.setDate(quatreJanvier.getDate() - (jour - 1) + (numero - 1) * 7)
  return lundi
}

/**
 * Saison d'une semaine ISO (#23, P12) : on prend la saison du **jeudi** de la
 * semaine — le jeudi porte déjà l'année ISO (cf. semaineISO), donc c'est le
 * jour d'ancrage cohérent quand une semaine est à cheval sur deux mois/saisons.
 */
export function saisonDeSemaine(semaine: string): Saison {
  const jeudi = lundiDeSemaine(semaine)
  jeudi.setDate(jeudi.getDate() + 3) // lundi + 3 = jeudi
  return saisonDuMois(jeudi.getMonth())
}

/**
 * Semaine ISO décalée de `n` semaines (négatif = passé). Utilisé pour la
 * navigation dans l'historique (#5) et le cutoff de rétention.
 */
export function semaineDecalee(semaine: string, n: number): string {
  const lundi = lundiDeSemaine(semaine)
  lundi.setDate(lundi.getDate() + n * 7)
  return semaineISO(lundi)
}

/**
 * Semaine cible par défaut (RG-21) : la semaine courante en règle générale,
 * mais la **semaine prochaine** si l'on est un samedi ou un dimanche (on fait
 * alors ses courses pour la semaine à venir — JTBD US-11).
 */
export function semaineParDefaut(date: Date = new Date()): string {
  const jour = date.getDay() // 0 = dimanche, 6 = samedi
  const offset = jour === 0 || jour === 6 ? 1 : 0
  const d = new Date(date)
  d.setDate(date.getDate() + offset * 7)
  return semaineISO(d)
}
