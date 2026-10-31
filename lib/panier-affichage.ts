// Logique pure d'affichage de la carte « panier Chronodrive » de /courses
// (#308, RG-81 à RG-84). Aucune E/S ni horloge : le cycle courant est passé en
// argument, pour rester testable et utilisable dans un composant client.

import type { RapportPanier } from "@/lib/panier"

/** Dernière demande de panier du foyer, telle que renvoyée par `etat_panier()`. */
export type DemandePanier = {
  id: string
  ancre: string
  statut: "en_attente" | "en_cours" | "terminee" | "echec"
  cause_echec: "injoignable" | "non_prise" | "delai_depasse" | "executeur" | null
  motif_echec: string | null
  rapport: RapportPanier | null
  rapport_tardif: boolean
  cree_le: string
  pris_le: string | null
  termine_le: string | null
}

/** Forme de la RPC `etat_panier()`. */
export type EtatPanier = {
  executeur: boolean
  derniere: DemandePanier | null
}

export type AffichagePanier =
  | { visible: false }
  | {
      visible: true
      actif: boolean
      lanceA: string | null
      echec: string | null
      rapport: RapportPanier | null
      tardif: boolean
    }

const MESSAGE_ECHEC_DEFAUT = "Le panier n’a pas pu être constitué."

/** Une demande active (RG-83) : `en_attente` ou `en_cours`. */
export function estActive(demande: DemandePanier | null): boolean {
  return demande?.statut === "en_attente" || demande?.statut === "en_cours"
}

/**
 * Message d'échec lu par la personne ; `motif_echec` est déjà en français
 * lisible. Sans motif : message générique.
 */
export function messageEchec(
  cause: DemandePanier["cause_echec"],
  motif: string | null
): string {
  if (!motif) return MESSAGE_ECHEC_DEFAUT
  if (cause === "injoignable") return `Ton exécuteur n’a pas répondu (${motif}).`
  if (cause === "executeur") return `Ton exécuteur a signalé un problème : ${motif}`
  return motif
}

function compter(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n >= 2 ? pluriel : singulier}`
}

/** `30 ajoutés · 5 à choisir · 1 introuvable` (« à choisir » invariable). */
export function resumeRapport(rapport: RapportPanier): string {
  return [
    compter(rapport.ajoutes.length, "ajouté", "ajoutés"),
    `${rapport.a_choisir.length} à choisir`,
    compter(rapport.introuvables.length, "introuvable", "introuvables"),
  ].join(" · ")
}

const FORMAT_HEURE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** Heure de Paris au format `HH h MM` (ex. `18 h 05`), espaces ordinaires. */
export function heureLancement(iso: string): string {
  const parties = FORMAT_HEURE.formatToParts(new Date(iso))
  const heure = parties.find((p) => p.type === "hour")?.value ?? "00"
  const minute = parties.find((p) => p.type === "minute")?.value ?? "00"
  return `${heure} h ${minute}`
}

/**
 * Ce que la carte doit montrer. La carte n'existe que pour un membre dont le
 * foyer a un exécuteur (RG-81) et sur le cycle courant : la demande vise
 * toujours le cycle courant. Une demande active bloque le bouton quelle que
 * soit son ancre (une seule par foyer, RG-83) ; échec et rapport ne sont
 * montrés que s'ils concernent le cycle affiché.
 */
export function affichagePanier(
  etat: EtatPanier,
  ancreAffichee: string,
  ancreCourante: string
): AffichagePanier {
  if (!etat.executeur || ancreAffichee !== ancreCourante) return { visible: false }

  const derniere = etat.derniere
  const actif = estActive(derniere)
  const duCycle = derniere !== null && derniere.ancre === ancreAffichee
  const rapport =
    duCycle && derniere.statut === "terminee" ? derniere.rapport : null

  return {
    visible: true,
    actif,
    lanceA: actif && derniere ? heureLancement(derniere.cree_le) : null,
    echec:
      duCycle && derniere.statut === "echec"
        ? messageEchec(derniere.cause_echec, derniere.motif_echec)
        : null,
    rapport,
    tardif: rapport !== null && derniere !== null && derniere.rapport_tardif,
  }
}
