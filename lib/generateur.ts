// Générateur de planning — logique métier pure (sans UI)
//
// Implémente les règles métier RG-01 à RG-04 de SPECS_FONCTIONNELLES.md (section 6).
// Aucune dépendance à React, au navigateur ou à Supabase : testable en isolation.

import { saisonDeSemaine, semaineISO } from "@/lib/semaines"
import { estDeSaison } from "@/lib/saisons"
import {
  ORDRE_TEMPS,
  rangTemps,
  REGLAGES_DEFAUT,
  tempsAuPlafond,
} from "@/lib/reglages"
import type {
  Recette,
  Planning,
  JourPlanning,
  Jour,
  Saison,
  TempsPreparation,
  ReglagesGeneration,
} from "@/types"

// Jours de semaine (lundi → vendredi) : l'éligibilité y est restreinte selon
// le type de repas (RG-01) ; le week-end accepte tout.
const JOURS_SEMAINE: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"]

// Ordre canonique imposé par le modèle de données (section 5.5 : 7 entrées lundi → dimanche).
const ORDRE_JOURS: Jour[] = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
]

type TypeRepas = "diner" | "dejeuner"

type Slot = {
  jour: Jour
  typeRepas: TypeRepas
}

// RG-01 — Éligibilité par slot (jour × type de repas), paramétrée par les
// réglages utilisateur (#45, P09). Chaque créneau a un temps de préparation
// MAXIMUM autorisé (« plafond ») ; une recette est éligible si son temps est ≤
// plafond. Les réglages par défaut (REGLAGES_DEFAUT) reproduisent l'ancienne
// table en dur : dîner de semaine "rapide", déjeuner de semaine "normal",
// week-end "long" (tout).
type CleCreneau = keyof ReglagesGeneration["plafonds"]

// Créneau (jour × type de repas) → clé des réglages. Partagé par le plafond de
// temps (#45) et la préférence végé (#86 PR2) pour éviter de dupliquer la
// logique semaine/week-end.
function creneauSlot(jour: Jour, typeRepas: TypeRepas): CleCreneau {
  const enSemaine = JOURS_SEMAINE.includes(jour)
  if (enSemaine) return typeRepas === "diner" ? "dinerSemaine" : "dejeunerSemaine"
  return typeRepas === "diner" ? "dinerWeekend" : "dejeunerWeekend"
}

function plafondSlot(
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): TempsPreparation {
  return reglages.plafonds[creneauSlot(jour, typeRepas)]
}

/**
 * Vrai si l'utilisateur a demandé de privilégier le végétarien sur ce créneau
 * (#86 PR2, RG-26). Préférence SOUPLE : exploitée comme biais de sélection, pas
 * comme contrainte. Absente (réglages sans `vegetarienPrefere`) = false.
 */
export function prefereVegeSlot(
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): boolean {
  return reglages.vegetarienPrefere?.[creneauSlot(jour, typeRepas)] ?? false
}

/**
 * Restreint des candidats éligibles au sous-ensemble végétarien SI le créneau
 * privilégie le végé ET qu'au moins une recette végé est disponible ; sinon
 * renvoie les candidats tels quels (repli souple, RG-26). Le biais reste dans
 * le même palier de temps → la faisabilité de la génération est inchangée.
 */
function biaiserVege(
  candidats: Recette[],
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): Recette[] {
  if (!prefereVegeSlot(jour, typeRepas, reglages)) return candidats
  const vege = candidats.filter((r) => r.vegetarien === true)
  return vege.length > 0 ? vege : candidats
}

/**
 * Vrai si la saisonnalité est active (#23 PR2, RG-28). ⚠️ ON par défaut :
 * `undefined` (REGLAGES_DEFAUT, ligne DB absente) compte comme actif ; seul
 * `false` désactive — inverse des préférences végé/mix.
 */
function saisonnaliteActive(reglages: ReglagesGeneration): boolean {
  return reglages.saisonnalite !== false
}

/**
 * Filtre DUR « recettes de saison » à dégradation gracieuse (#23 PR2, RG-28).
 * Si la saisonnalité est active, on restreint aux recettes de la saison cible ;
 * mais s'il n'en reste AUCUNE (vivier de saison épuisé pour ce slot), on replie
 * sur tous les candidats (= complétion hors-saison). Ce repli est la dégradation
 * gracieuse : la génération n'échoue jamais à cause de la saison, exactement
 * comme les biais souples. Les recettes sans saison déclarée sont de toute
 * saison (estDeSaison).
 */
function biaiserSaison(
  candidats: Recette[],
  saison: Saison,
  reglages: ReglagesGeneration
): Recette[] {
  if (!saisonnaliteActive(reglages)) return candidats
  const deSaison = candidats.filter((r) => estDeSaison(r, saison))
  return deSaison.length > 0 ? deSaison : candidats
}

/** Vrai si un repas « légumes » a déjà été attribué à ce jour (l'un des 2 slots). */
function jourADejaLegume(jour: Jour, attributions: Map<string, Recette>): boolean {
  const dej = attributions.get(cleSlot(jour, "dejeuner"))
  const din = attributions.get(cleSlot(jour, "diner"))
  return dej?.accompagnement === "legumes" || din?.accompagnement === "legumes"
}

/**
 * Biais « au moins un repas légumes par jour » (#49 PR2, RG-27). Préférence
 * SOUPLE et JOINTE, en deux temps selon l'état de la journée :
 *  - journée PAS encore pourvue d'un légume → on restreint aux candidats
 *    « légumes » s'il en reste (sinon repli sur tous) → on sécurise le jour ;
 *  - journée DÉJÀ pourvue → **anti-biais** : on préfère les candidats NON
 *    « légumes » (sinon repli sur tous) pour **préserver le vivier de légumes
 *    aux jours pas encore sécurisés** — sans cela, le 2ᵉ slot d'un jour déjà
 *    honoré pourrait consommer le dernier légume dont un autre jour a besoin.
 *
 * Chaque branche replie toujours sur l'ensemble des candidats et reste dans le
 * même palier de temps → la faisabilité (Hall, analyserVivier) est inchangée :
 * la génération n'échoue jamais à cause de cette préférence.
 */
function biaiserMixLegume(
  candidats: Recette[],
  jour: Jour,
  attributions: Map<string, Recette>,
  reglages: ReglagesGeneration
): Recette[] {
  if (!reglages.mixAccompagnementJour) return candidats
  if (jourADejaLegume(jour, attributions)) {
    const nonLegumes = candidats.filter((r) => r.accompagnement !== "legumes")
    return nonLegumes.length > 0 ? nonLegumes : candidats
  }
  const legumes = candidats.filter((r) => r.accompagnement === "legumes")
  return legumes.length > 0 ? legumes : candidats
}

function tempsEligibles(
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): TempsPreparation[] {
  return tempsAuPlafond(plafondSlot(jour, typeRepas, reglages))
}

function estEligible(
  recette: Recette,
  jour: Jour,
  typeRepas: TypeRepas,
  reglages: ReglagesGeneration
): boolean {
  return tempsEligibles(jour, typeRepas, reglages).includes(
    recette.tempsPreparation
  )
}

// RG-03 — Sélection aléatoire parmi les recettes éligibles.
//
// La source d'aléa est INJECTABLE (`random`, défaut `Math.random`) : en prod le
// comportement est inchangé, mais les tests peuvent passer un PRNG seedé pour
// rendre la génération déterministe (cf. #157 — sans cela, `genererPlanning`
// pouvait épuiser aléatoirement le vivier « rapide » et faire échouer par
// intermittence les assertions de remplacement).
type Aleatoire = () => number

function choisirAleatoire<T>(elements: T[], random: Aleatoire = Math.random): T {
  const index = Math.floor(random() * elements.length)
  return elements[index]!
}

/**
 * Mémoire de variété (#218, RG-50/RG-52) : id de recette → ancienneté EN
 * SEMAINES de sa dernière apparition au planning (1 = la semaine précédant la
 * cible). Une recette absente n'a pas été servie dans la fenêtre → poids plein
 * (non pénalisée). Construite côté serveur depuis l'historique des plannings du
 * foyer (RG-52), jamais en sélection manuelle (RG-03).
 */
export type HistoriqueVariete = Map<string, number>

/**
 * Fenêtre glissante de référence de la mémoire de variété (#218, RG-50), en
 * semaines. Bornée par la rétention ~12 semaines (#5). 4 ≈ un mois : assez pour
 * ne pas revoir un plat « du mois dernier » sans appauvrir durablement un petit
 * vivier (au-delà de la fenêtre, plus aucune pénalité).
 */
export const FENETRE_VARIETE = 4

/**
 * Poids de variété d'une recette (#218, RG-49/50/51). Vaut 1 (poids plein) si la
 * recette n'a pas été servie dans la fenêtre ; sinon une pénalité DÉGRESSIVE
 * selon l'ancienneté : vue il y a 1 semaine = fortement défavorisée, vue il y a
 * `fenetre` semaines = à peine. Le poids reste STRICTEMENT positif (jamais 0) :
 * toute recette demeure sélectionnable en dernier recours → la faisabilité (Hall)
 * est inchangée (RG-49) et le biais ne bloque jamais (repli implicite, RG-50).
 */
export function poidsVariete(
  recette: Recette,
  historique: HistoriqueVariete,
  fenetre: number = FENETRE_VARIETE
): number {
  const ancien = historique.get(recette.id)
  if (ancien === undefined || ancien < 1 || ancien > fenetre) return 1
  // ancien ∈ [1, fenetre] → poids ∈ [1/(fenetre+1), fenetre/(fenetre+1)] ⊂ (0,1).
  return ancien / (fenetre + 1)
}

/**
 * Tirage pondéré (#218) : choisit un élément avec une probabilité
 * proportionnelle à son poids (≥ 0). Généralise `choisirAleatoire` (cas des
 * poids égaux). Repli sur un tirage uniforme si la somme des poids est nulle
 * (cas théorique : ne survient pas tant qu'au moins un poids est > 0).
 */
function choisirPondere<T>(
  elements: T[],
  poids: (element: T) => number,
  random: Aleatoire = Math.random
): T {
  const poidsParElement = elements.map((e) => Math.max(0, poids(e)))
  const somme = poidsParElement.reduce((acc, p) => acc + p, 0)
  if (somme <= 0) return choisirAleatoire(elements, random)
  let seuil = random() * somme
  for (let i = 0; i < elements.length; i++) {
    seuil -= poidsParElement[i]!
    if (seuil < 0) return elements[i]!
  }
  return elements[elements.length - 1]!
}

// Clé unique d'un slot, utilisée pour mémoriser les attributions.
function cleSlot(jour: Jour, typeRepas: TypeRepas): string {
  return `${jour}-${typeRepas}`
}

// Le calcul de l'identifiant de semaine ISO vit dans lib/semaines.ts
// (semaineISO), partagé avec la page planning.

/**
 * Génère un planning complet pour la semaine.
 *
 * Composition (section 5.5) : un déjeuner ET un dîner chaque jour, du lundi au
 * dimanche — soit 14 repas.
 *
 * Règles métier appliquées :
 *  - RG-01 : éligibilité par slot (jour × type de repas) — dîner de semaine =
 *            "rapide", déjeuner de semaine = "rapide"/"normal", week-end = tout.
 *  - RG-02 : aucune recette n'apparaît deux fois dans la semaine, tous slots confondus.
 *  - RG-03 : parmi les recettes éligibles restantes, le choix est aléatoire.
 *  - RG-49/50/51 : mémoire de variété (#218) — les recettes servies dans les
 *    `FENETRE_VARIETE` semaines précédentes sont DÉFAVORISÉES dans le tirage
 *    (biais souple, pénalité dégressive selon l'ancienneté), composé APRÈS les
 *    filtres durs : il ne change ni la faisabilité ni le palier de temps.
 *
 * Stratégie de remplissage : les slots les plus contraints sont attribués en
 * premier (dîners de semaine = "rapide", puis déjeuners de semaine =
 * "rapide"/"normal", puis week-end = tout). Comme toute recette éligible sur un
 * slot contraint l'est aussi sur un slot plus permissif, cet ordre évite
 * d'épuiser à tort un vivier restreint et de faire échouer un slot alors qu'une
 * solution existe : il n'échoue que si aucune attribution valide n'existe.
 *
 * @param semaine identifiant ISO "AAAA-Wnn" de la semaine cible (US-11, RG-21).
 *                Défaut : la semaine courante.
 * @param random source d'aléa (RG-03), injectable pour des tests déterministes
 *               (#157) ; défaut `Math.random` (comportement prod inchangé).
 * @param historiqueVariete mémoire de variété (#218, RG-49/50) : id de recette →
 *               ancienneté en semaines de sa dernière apparition. Défaut Map vide
 *               = aucune pénalité (comportement prod inchangé). Lu côté serveur.
 * @throws {Error} si le vivier de recettes éligibles est insuffisant pour remplir
 *                 les 14 slots sans répétition.
 */
export function genererPlanning(
  recettes: Recette[],
  semaine: string = semaineISO(),
  reglages: ReglagesGeneration = REGLAGES_DEFAUT,
  random: Aleatoire = Math.random,
  historiqueVariete: HistoriqueVariete = new Map()
): Planning {
  const slots: Slot[] = ORDRE_JOURS.flatMap((jour): Slot[] => [
    { jour, typeRepas: "dejeuner" },
    { jour, typeRepas: "diner" },
  ])

  // Slots contraints (plafond le plus bas → vivier le plus restreint) d'abord,
  // slots permissifs ensuite (RG-01). Comme toute recette éligible sur un slot
  // contraint l'est aussi sur un slot plus permissif (plafonds = seuils sur un
  // ordre total), cet ordre évite d'épuiser à tort un vivier restreint.
  // À palier de contrainte égal, les créneaux « privilégier végé » (#86 PR2)
  // passent en premier pour capter les recettes végé avant les autres slots
  // (meilleur taux d'honoring de la préférence souple ; sans incidence sur la
  // faisabilité, cf. biaiserVege).
  const slotsTries = [...slots].sort((a, b) => {
    const d = poidsContrainte(a, reglages) - poidsContrainte(b, reglages)
    if (d !== 0) return d
    const va = prefereVegeSlot(a.jour, a.typeRepas, reglages) ? 0 : 1
    const vb = prefereVegeSlot(b.jour, b.typeRepas, reglages) ? 0 : 1
    return va - vb
  })

  const utilisees = new Set<string>() // RG-02 : ids déjà placés cette semaine
  const attributions = new Map<string, Recette>()
  // RG-28 — saison de la semaine cible (filtre dur à dégradation gracieuse).
  const saison = saisonDeSemaine(semaine)

  for (const slot of slotsTries) {
    const eligibles = recettes.filter(
      (r) =>
        !utilisees.has(r.id) &&
        estEligible(r, slot.jour, slot.typeRepas, reglages)
    )
    if (eligibles.length === 0) {
      throw new Error(
        `Pas assez de recettes éligibles pour générer le planning ` +
          `(slot ${slot.jour} ${slot.typeRepas}).`
      )
    }
    // RG-28 / RG-26 / RG-27 — filtres composés, chacun avec repli :
    //  1. saison (filtre dur, mais repli hors-saison = dégradation gracieuse) ;
    //  2. végé (par créneau) ; 3. légumes (joint par jour), à l'intérieur.
    // Le repli évite tout échec et garde la faisabilité inchangée.
    const candidats = biaiserMixLegume(
      biaiserVege(
        biaiserSaison(eligibles, saison, reglages),
        slot.jour,
        slot.typeRepas,
        reglages
      ),
      slot.jour,
      attributions,
      reglages
    )
    // RG-49/50/51 — mémoire de variété (#218) : tirage PONDÉRÉ dans le même
    // ensemble de candidats (filtres durs déjà appliqués), pénalisant de façon
    // dégressive les recettes vues récemment. Historique vide → poids tous égaux
    // → équivaut exactement à choisirAleatoire (comportement prod inchangé).
    const choisie = choisirPondere(
      candidats,
      (r) => poidsVariete(r, historiqueVariete),
      random
    )
    utilisees.add(choisie.id)
    attributions.set(cleSlot(slot.jour, slot.typeRepas), choisie)
  }

  // Réassemblage dans l'ordre canonique lundi → dimanche (section 5.5).
  // Déjeuner ET dîner sont peuplés chaque jour désormais. Chaque slot est doté
  // du nombre de personnes par défaut des réglages (#45) — base recette 2
  // inchangée (RG-16), seul le défaut affiché change.
  const jours: JourPlanning[] = ORDRE_JOURS.map((jour) => ({
    jour,
    dejeuner: attributions.get(cleSlot(jour, "dejeuner"))!,
    diner: attributions.get(cleSlot(jour, "diner"))!,
    personnes: {
      dejeuner: reglages.personnesDefaut,
      diner: reglages.personnesDefaut,
    },
  }))

  return { semaine, jours }
}

// Poids de contrainte d'un slot : plus il est bas, plus le slot est restrictif
// et doit être servi tôt. Mesuré par la taille du vivier de temps éligibles
// (RG-01) selon le plafond du créneau (1 si plafond "rapide", 2 si "normal",
// 3 si "long").
function poidsContrainte(slot: Slot, reglages: ReglagesGeneration): number {
  return tempsEligibles(slot.jour, slot.typeRepas, reglages).length
}

/**
 * Remplace une seule recette d'un planning existant, sans toucher aux autres slots.
 *
 * Règles métier appliquées (RG-04) :
 *  - RG-01 : la recette de remplacement doit être éligible pour le jour ciblé.
 *  - RG-02 : elle ne doit pas être déjà utilisée ailleurs dans la semaine.
 *            Les recettes des autres slots restent « bloquées » : seul le slot ciblé
 *            est libéré, sa recette actuelle étant exclue des candidats pour garantir
 *            un vrai changement.
 *
 * Immutabilité : le planning passé en argument n'est jamais muté. Une nouvelle
 * structure est retournée (les `JourPlanning` non concernés sont réutilisés tels quels).
 *
 * @param random source d'aléa (RG-03), injectable pour des tests déterministes
 *               (#157) ; défaut `Math.random` (comportement prod inchangé).
 * @returns le nouveau planning, ou `null` si aucune recette de remplacement n'est
 *          disponible — ou si le slot ciblé n'existe pas (planning antérieur
 *          à 14 repas, sans déjeuner ce jour-là). L'UI affiche alors
 *          « Pas de recette disponible ».
 */
export function remplacerSlot(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  recettes: Recette[],
  reglages: ReglagesGeneration = REGLAGES_DEFAUT,
  random: Aleatoire = Math.random
): Planning | null {
  const jourPlanning = planning.jours.find((jp) => jp.jour === jour)
  if (!jourPlanning) return null // jour absent du planning

  const actuelle =
    typeRepas === "diner" ? jourPlanning.diner : jourPlanning.dejeuner
  if (!actuelle) return null // aucun slot à remplacer (planning antérieur sans ce déjeuner)

  // RG-02 : on collecte tout ce qui est déjà utilisé SAUF le slot ciblé,
  // qui est sur le point d'être remplacé.
  const utilisees = new Set<string>()
  for (const jp of planning.jours) {
    const cibleDiner = jp.jour === jour && typeRepas === "diner"
    const cibleDejeuner = jp.jour === jour && typeRepas === "dejeuner"
    if (jp.diner && !cibleDiner) utilisees.add(jp.diner.id)
    if (jp.dejeuner && !cibleDejeuner) utilisees.add(jp.dejeuner.id)
  }

  // Candidats : éligibles pour ce slot (RG-01, jour × type), non utilisés
  // ailleurs (RG-02), et différents de la recette actuelle (US-04).
  const eligibles = recettes.filter(
    (r) =>
      !utilisees.has(r.id) &&
      r.id !== actuelle.id &&
      estEligible(r, jour, typeRepas, reglages)
  )
  if (eligibles.length === 0) return null

  // RG-28 / RG-26 / RG-27 — mêmes filtres que la génération complète. On applique
  // d'abord le filtre de saison (dur, repli hors-saison = dégradation gracieuse),
  // la saison étant celle de la semaine du planning. Puis le biais végé. Pour le
  // mix « légumes » (joint par jour), on regarde le repas FRÈRE déjà présent ce
  // jour-là : s'il est déjà « légumes », la journée est honorée → pas de biais ;
  // sinon on biaise le remplaçant vers « légumes » (repli souple).
  const frere =
    typeRepas === "diner" ? jourPlanning.dejeuner : jourPlanning.diner
  let candidats = biaiserVege(
    biaiserSaison(eligibles, saisonDeSemaine(planning.semaine), reglages),
    jour,
    typeRepas,
    reglages
  )
  if (
    reglages.mixAccompagnementJour &&
    frere?.accompagnement !== "legumes"
  ) {
    const legumes = candidats.filter((r) => r.accompagnement === "legumes")
    if (legumes.length > 0) candidats = legumes
  }
  const choisie = choisirAleatoire(candidats, random)

  // Reconstruction immuable : seul le jour ciblé est recréé. Remplacer la
  // recette efface un éventuel marquage « restes » sur ce slot (RG-22 : on
  // recuisine).
  const jours: JourPlanning[] = planning.jours.map((jp) => {
    if (jp.jour !== jour) return jp
    return typeRepas === "diner"
      ? { ...jp, diner: choisie, restes: { ...jp.restes, diner: false } }
      : { ...jp, dejeuner: choisie, restes: { ...jp.restes, dejeuner: false } }
  })

  return { semaine: planning.semaine, jours }
}

/**
 * Remplace un slot par une recette choisie PAR L'UTILISATEUR (US-06, RG-15).
 *
 * Contrairement à `remplacerSlot` (aléatoire), la sélection manuelle by-passe
 * RG-01 (une recette « long » est permise un soir de semaine) et RG-02 (le
 * doublon est permis) : l'utilisateur arbitre, informé par les badges du
 * sélecteur. L'opération ne peut donc échouer que si le slot ciblé n'existe
 * pas (planning antérieur sans ce déjeuner) — cas impossible depuis l'UI, qui
 * n'affiche un bouton que sur les slots existants.
 *
 * Immutabilité : même contrat que `remplacerSlot`.
 *
 * @returns le nouveau planning, ou `null` si le slot ciblé n'existe pas.
 */
export function remplacerSlotManuel(
  planning: Planning,
  jour: Jour,
  typeRepas: TypeRepas,
  recette: Recette
): Planning | null {
  const jourPlanning = planning.jours.find((jp) => jp.jour === jour)
  if (!jourPlanning) return null // jour absent du planning

  const actuelle =
    typeRepas === "diner" ? jourPlanning.diner : jourPlanning.dejeuner
  if (!actuelle) return null // aucun slot à remplacer (planning antérieur sans ce déjeuner)

  // Reconstruction immuable : seul le jour ciblé est recréé. Choisir une
  // recette efface un éventuel marquage « restes » sur ce slot (RG-22).
  const jours: JourPlanning[] = planning.jours.map((jp) => {
    if (jp.jour !== jour) return jp
    return typeRepas === "diner"
      ? { ...jp, diner: recette, restes: { ...jp.restes, diner: false } }
      : { ...jp, dejeuner: recette, restes: { ...jp.restes, dejeuner: false } }
  })

  return { semaine: planning.semaine, jours }
}

/**
 * Identifiants des recettes présentes dans le planning, tous slots confondus.
 * Sert au badge « déjà au planning » du sélecteur (US-06, RG-15).
 */
export function recettesUtilisees(planning: Planning): Set<string> {
  const ids = new Set<string>()
  for (const jp of planning.jours) {
    ids.add(jp.diner.id)
    if (jp.dejeuner) ids.add(jp.dejeuner.id)
  }
  return ids
}

/**
 * Slots dont le créneau privilégie le végétarien mais qui portent une recette
 * NON végétarienne (#86 PR2, RG-26) — c.-à-d. les cas où la préférence souple
 * n'a pas pu être honorée (vivier végé insuffisant). Calculé depuis le planning
 * final : indépendant de l'aléatoire de génération, et valable aussi bien après
 * une génération complète qu'après un remplacement unitaire. Sert à avertir
 * l'utilisateur sans bloquer (la génération aboutit toujours).
 */
export function slotsVegeNonHonores(
  planning: Planning,
  reglages: ReglagesGeneration
): Slot[] {
  const slots: Slot[] = []
  for (const jp of planning.jours) {
    if (
      jp.dejeuner &&
      prefereVegeSlot(jp.jour, "dejeuner", reglages) &&
      jp.dejeuner.vegetarien !== true
    ) {
      slots.push({ jour: jp.jour, typeRepas: "dejeuner" })
    }
    if (
      jp.diner &&
      prefereVegeSlot(jp.jour, "diner", reglages) &&
      jp.diner.vegetarien !== true
    ) {
      slots.push({ jour: jp.jour, typeRepas: "diner" })
    }
  }
  return slots
}

/**
 * Jours dont aucun des deux repas n'est « légumes » alors que la préférence
 * « au moins un légume par jour » est active (#49 PR2, RG-27) — c.-à-d. les
 * jours où la préférence souple n'a pas pu être honorée (vivier « légumes »
 * insuffisant). Calculé depuis le planning final : indépendant de l'aléatoire,
 * valable après une génération complète comme après un remplacement unitaire.
 * Préférence inactive → liste vide. Sert à avertir sans bloquer.
 */
export function joursSansLegume(
  planning: Planning,
  reglages: ReglagesGeneration
): Jour[] {
  if (!reglages.mixAccompagnementJour) return []
  const jours: Jour[] = []
  for (const jp of planning.jours) {
    const aLegume =
      jp.dejeuner?.accompagnement === "legumes" ||
      jp.diner?.accompagnement === "legumes"
    if (!aLegume) jours.push(jp.jour)
  }
  return jours
}

/**
 * Slots dont la recette n'est PAS de la saison de la semaine alors que la
 * saisonnalité est active (#23 PR2, RG-28) — c.-à-d. les repas complétés
 * hors-saison par dégradation gracieuse (vivier de saison insuffisant). Calculé
 * depuis le planning final : indépendant de l'aléatoire, valable après une
 * génération complète comme après un remplacement. Saisonnalité inactive →
 * liste vide. Sert à avertir sans bloquer.
 */
export function reposNonSaison(
  planning: Planning,
  reglages: ReglagesGeneration
): Slot[] {
  if (!saisonnaliteActive(reglages)) return []
  const saison = saisonDeSemaine(planning.semaine)
  const slots: Slot[] = []
  for (const jp of planning.jours) {
    if (jp.dejeuner && !estDeSaison(jp.dejeuner, saison)) {
      slots.push({ jour: jp.jour, typeRepas: "dejeuner" })
    }
    if (jp.diner && !estDeSaison(jp.diner, saison)) {
      slots.push({ jour: jp.jour, typeRepas: "diner" })
    }
  }
  return slots
}

// Nombre de slots par créneau dans une semaine (section 5.5) : 5 jours de
// semaine + 2 jours de week-end, chacun déjeuner + dîner → 14 slots.
const SLOTS_PAR_CRENEAU = {
  dejeunerSemaine: 5,
  dinerSemaine: 5,
  dejeunerWeekend: 2,
  dinerWeekend: 2,
} as const

export type AnalyseVivier = {
  suffisant: boolean
  total: number
  /** Recettes rapide ou normale (temps ≠ long). */
  rapideNormal: number
  /** Recettes rapide. */
  rapide: number
  /** Message d'alerte si insuffisant, sinon null. */
  message: string | null
}

/**
 * Analyse si le vivier de recettes permet de générer une semaine complète
 * (#2, bonus PR3) sous les réglages donnés (#45) — anticipe l'échec « Pas de
 * recette disponible » du générateur. Sert aussi de garde de faisabilité avant
 * d'enregistrer des réglages (B3).
 *
 * Faisabilité (affectation distincte recette → slot) : comme les temps sont
 * totalement ordonnés et l'éligibilité est « temps ≤ plafond », les viviers
 * sont emboîtés. Par le théorème de Hall, il suffit qu'à CHAQUE niveau `k`
 * (rapide ⊂ rapide+normal ⊂ tout) le nombre de slots de plafond ≤ k ne dépasse
 * pas le nombre de recettes de temps ≤ k. Avec REGLAGES_DEFAUT, on retrouve
 * exactement les anciens seuils 14 / 10 / 5.
 */
export function analyserVivier(
  recettes: Recette[],
  reglages: ReglagesGeneration = REGLAGES_DEFAUT
): AnalyseVivier {
  const total = recettes.length
  const rapide = recettes.filter((r) => r.tempsPreparation === "rapide").length
  const rapideNormal = recettes.filter((r) => r.tempsPreparation !== "long").length
  // Recettes cumulées par niveau (≤ rang) : index 0 = rapide, 1 = +normal, 2 = tout.
  const recettesCum = [rapide, rapideNormal, total]

  // Slots requis cumulés par niveau : un créneau de plafond de rang r pèse sur
  // tous les niveaux ≥ r (ses slots ne peuvent piocher que dans temps ≤ r).
  const besoin = ORDRE_TEMPS.map(() => 0)
  const p = reglages.plafonds
  const creneaux: [keyof typeof SLOTS_PAR_CRENEAU, TempsPreparation][] = [
    ["dejeunerSemaine", p.dejeunerSemaine],
    ["dinerSemaine", p.dinerSemaine],
    ["dejeunerWeekend", p.dejeunerWeekend],
    ["dinerWeekend", p.dinerWeekend],
  ]
  for (const [cle, plafond] of creneaux) {
    for (let k = rangTemps(plafond); k < ORDRE_TEMPS.length; k++) {
      besoin[k]! += SLOTS_PAR_CRENEAU[cle]
    }
  }

  const suffisant = besoin.every((req, k) => req <= recettesCum[k]!)
  if (suffisant) {
    return { suffisant, total, rapideNormal, rapide, message: null }
  }

  const reqTotal = besoin[2]! // tous les slots → toujours 14
  const reqRapideNormal = besoin[1]!
  const reqRapide = besoin[0]!
  const message =
    `Pour générer une semaine (14 repas), il faut au moins ${reqTotal} recettes` +
    (reqRapideNormal > 0 ? `, dont ${reqRapideNormal} rapides/normales` : ``) +
    (reqRapide > 0 ? `, dont ${reqRapide} rapides` : ``) +
    `. Tu en as ${total} (dont ${rapideNormal} rapide/normale, dont ${rapide} rapide).`
  return { suffisant, total, rapideNormal, rapide, message }
}

/**
 * Réinjecte une recette modifiée dans le planning (US-08/#2, RG-03) : tout slot
 * qui référence cette recette (par id) reçoit sa nouvelle version (nom, temps,
 * ingrédients), pour que la liste de courses reflète immédiatement l'édition.
 * Le nombre de personnes du slot (porté par le jour) est préservé.
 *
 * @returns un nouveau planning si au moins un slot était concerné, sinon `null`
 *          (la recette n'est pas au planning courant — rien à faire).
 */
export function remplacerRecetteDansPlanning(
  planning: Planning,
  recette: Recette
): Planning | null {
  let modifie = false
  const jours: JourPlanning[] = planning.jours.map((jp) => {
    const nouveau: JourPlanning = { ...jp }
    if (jp.diner.id === recette.id) {
      nouveau.diner = recette
      modifie = true
    }
    if (jp.dejeuner && jp.dejeuner.id === recette.id) {
      nouveau.dejeuner = recette
      modifie = true
    }
    return nouveau
  })
  return modifie ? { semaine: planning.semaine, jours } : null
}
