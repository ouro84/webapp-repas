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

/**
 * Forme de la RPC `etat_panier(p_ancre)` : `derniere` = dernière demande du
 * cycle demandé (ou du foyer sans ancre), `active` = la demande en attente ou
 * en cours du foyer, quel que soit son cycle (RG-83).
 */
export type EtatPanier = {
  executeur: boolean
  derniere: DemandePanier | null
  active: DemandePanier | null
}

export type AffichagePanier =
  | { visible: false }
  | {
      visible: true
      /** Bouton de lancement : sur le cycle courant seulement (RG-81). Ailleurs, lecture seule. */
      boutonDisponible: boolean
      /** Après un `terminee` du cycle courant : bouton secondaire « Relancer… » (RG-83). */
      relance: boolean
      actif: boolean
      lanceA: string | null
      echec: string | null
      rapport: RapportPanier | null
      tardif: boolean
      /** Heure de fin (`termine_le`) d'un échec ou d'un compte-rendu affiché. */
      termineA: string | null
    }

const MESSAGE_ECHEC_DEFAUT = "Le panier n’a pas pu être constitué."
const MESSAGE_ECHEC_INJOIGNABLE = "Ton exécuteur n’a pas répondu. Vérifie qu’il est allumé, puis réessaie."

/** Une demande active (RG-83) : `en_attente` ou `en_cours`. */
export function estActive(demande: DemandePanier | null): boolean {
  return demande?.statut === "en_attente" || demande?.statut === "en_cours"
}

/**
 * Message d'échec lu par la personne ; `motif_echec` est déjà en français
 * lisible. Sans motif : message générique. Injoignable : mots simples, sans
 * le motif technique (« réponse HTTP 500 », « erreur réseau »), qui reste en base.
 */
export function messageEchec(
  cause: DemandePanier["cause_echec"],
  motif: string | null
): string {
  if (cause === "injoignable") return MESSAGE_ECHEC_INJOIGNABLE
  if (!motif) return MESSAGE_ECHEC_DEFAUT
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

/**
 * Heure de Paris au format `HH h MM` (ex. `18 h 05`), espaces ordinaires.
 * Date invalide → `""` : l'appelant n'affiche alors pas la ligne d'heure.
 */
export function heureLancement(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const parties = FORMAT_HEURE.formatToParts(date)
  const heure = parties.find((p) => p.type === "hour")?.value
  const minute = parties.find((p) => p.type === "minute")?.value
  return heure && minute ? `${heure} h ${minute}` : ""
}

/** Un rapport qui a quelque chose à lire (au moins une liste non vide). */
function rapportNonVide(rapport: RapportPanier | null): rapport is RapportPanier {
  return (
    rapport !== null &&
    (rapport.ajoutes.length > 0 || rapport.a_choisir.length > 0 || rapport.introuvables.length > 0)
  )
}

/**
 * Ce que la carte doit montrer. La carte n'existe que pour un membre dont le
 * foyer a un exécuteur (RG-81). Le bouton n'existe que sur le cycle courant :
 * la demande vise toujours le cycle courant. Une demande active le bloque
 * quelle que soit son ancre (une seule par foyer, RG-83). État en cours,
 * échec et rapport ne sont montrés que sur le cycle auquel ils appartiennent :
 * sur un autre cycle, la carte est en lecture seule, et absente si aucune
 * demande ne le concerne (RG-84).
 */
export function affichagePanier(
  etat: EtatPanier,
  ancreAffichee: string,
  ancreCourante: string
): AffichagePanier {
  if (!etat.executeur) return { visible: false }

  const derniere = etat.derniere
  const courant = ancreAffichee === ancreCourante
  const duCycle = derniere !== null && derniere.ancre === ancreAffichee
  if (!courant && !duCycle) return { visible: false }

  // Hors cycle courant, `derniere` est forcément de ce cycle (duCycle).
  const actif = estActive(derniere)
  const echec =
    duCycle && derniere.statut === "echec"
      ? messageEchec(derniere.cause_echec, derniere.motif_echec)
      : null
  // `rapporter_panier` stocke le rapport même en `echec` : un rapport partiel
  // (ce qui a été ajouté avant la panne) se montre avec le message d'échec.
  const rapport =
    duCycle &&
    (derniere.statut === "terminee" ||
      (derniere.statut === "echec" && rapportNonVide(derniere.rapport)))
      ? derniere.rapport
      : null

  if (!courant && !actif && echec === null && rapport === null) return { visible: false }

  const lanceA = actif && derniere ? heureLancement(derniere.cree_le) : ""
  const termineA =
    duCycle && (echec !== null || rapport !== null) && derniere.termine_le
      ? heureLancement(derniere.termine_le)
      : ""

  return {
    visible: true,
    boutonDisponible: courant,
    relance: courant && duCycle && derniere.statut === "terminee",
    actif,
    lanceA: lanceA || null,
    echec,
    rapport,
    tardif: rapport !== null && derniere !== null && derniere.rapport_tardif,
    termineA: termineA || null,
  }
}
