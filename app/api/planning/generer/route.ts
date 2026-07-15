import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiError } from "@/lib/errors"
import { limiteGeneration } from "@/lib/rate-limit"
import {
  FENETRE_VARIETE,
  genererPlanning,
  joursSansLegume,
  reposNonSaison,
  slotsVegeNonHonores,
  type HistoriqueVariete,
  type PreferencesRecettes,
  type RecettePreference,
} from "@/lib/generateur"
import {
  decalageEntre,
  semaineDecalee,
  semaineISO,
  semaineParDefaut,
} from "@/lib/semaines"
import {
  dateVersSemaineJour,
  LONGUEUR_DEFAUT,
  LONGUEUR_MAX,
  planningGenereParSemaine,
} from "@/lib/cycles"
import { dbRecetteToDomain } from "@/lib/adapters"
import { dbReglagesToDomain, REGLAGES_DEFAUT } from "@/lib/reglages"

// Plage de génération autorisée (#5) : navigation historique −12 → +6 semaines.
const SEMAINES_PASSEES = 12
const SEMAINES_FUTURES = 6
import type { DbRecette, DbReglages } from "@/types"

export async function POST(request: Request) {
  const supabase = await createClient()

  // Vérifie que l'utilisateur est connecté
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return apiError(
      "POST /api/planning/generer",
      authError,
      "Tu dois être connecté pour générer un planning.",
      401
    )
  }

  // Rate-limiting (#191, audit F-04) : borne le nombre de générations par
  // utilisateur (clé = user.id). No-op si Upstash non configuré (CI/dev) et
  // fail-open si indisponible — cf. lib/rate-limit.ts.
  const { autorise } = await limiteGeneration(user.id)
  if (!autorise) {
    return apiError(
      "POST /api/planning/generer",
      null,
      "Trop de générations en peu de temps. Patiente une minute puis réessaie.",
      429
    )
  }

  // Corps : deux modes exclusifs (#259).
  //  • Mode SEMAINE (US-11/US-14, /planning) : `{ semaine }` → un planning de 14
  //    slots pour cette semaine ISO.
  //  • Mode CYCLE (#259, /courses « Générer mon cycle ») : `{ ancre, longueur }`
  //    → on remplit les jours du cycle (fenêtre non calendaire), répartis dans
  //    les 1-2 semaines ISO touchées et renvoyés PAR SEMAINE (le client persiste
  //    chaque semaine via `sauvegarder_slots` sans écraser les jours voisins).
  // Dans les deux cas, la plage de navigation (−12 → +6 semaines) est validée
  // côté serveur — le client n'en est pas l'autorité.
  const corps = (await request.json().catch(() => null)) as {
    semaine?: unknown
    ancre?: unknown
    longueur?: unknown
  } | null

  const modeCycle = corps != null && typeof corps.ancre === "string"

  // Semaine cible de la GÉNÉRATION (et de l'historique de variété). En mode
  // cycle, c'est la semaine ISO de l'ancre (saison = ancre du cycle, cf. design).
  let semaine = semaineParDefaut()
  let ancre = ""
  let longueur = LONGUEUR_DEFAUT

  if (modeCycle) {
    ancre = corps!.ancre as string
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ancre)) {
      return apiError("POST /api/planning/generer", null, "Ancre de cycle invalide.", 400)
    }
    if (corps!.longueur !== undefined) {
      const n = Number(corps!.longueur)
      if (!Number.isInteger(n) || n < 1 || n > LONGUEUR_MAX) {
        return apiError("POST /api/planning/generer", null, "Longueur de cycle invalide.", 400)
      }
      longueur = n
    }
    semaine = dateVersSemaineJour(ancre).semaine
    const decalage = decalageEntre(semaineISO(new Date()), semaine)
    if (decalage < -SEMAINES_PASSEES || decalage > SEMAINES_FUTURES) {
      return apiError(
        "POST /api/planning/generer",
        null,
        "Cycle hors de la plage autorisée.",
        400
      )
    }
  } else if (corps && typeof corps.semaine === "string") {
    if (!/^\d{4}-W\d{2}$/.test(corps.semaine)) {
      return apiError("POST /api/planning/generer", null, "Semaine invalide.", 400)
    }
    const decalage = decalageEntre(semaineISO(new Date()), corps.semaine)
    if (decalage < -SEMAINES_PASSEES || decalage > SEMAINES_FUTURES) {
      return apiError(
        "POST /api/planning/generer",
        null,
        "Semaine cible hors de la plage autorisée.",
        400
      )
    }
    semaine = corps.semaine
  }

  // Récupère les recettes de l'utilisateur
  const { data: recettes, error: recettesError } = await supabase
    .from("recette")
    .select(`
      id,
      nom,
      temps_preparation,
      vegetarien,
      accompagnement,
      saisons,
      etapes,
      recette_ingredient (
        quantite,
        unite,
        ingredient (
          nom,
          categorie,
          fond_de_placard
        )
      )
    `)

  if (recettesError) {
    return apiError(
      "POST /api/planning/generer",
      recettesError,
      "Impossible de récupérer tes recettes. Réessaie dans quelques instants."
    )
  }

  // Recettes « supprimées » (masquées) par l'utilisateur (#105) : on les exclut
  // de la génération. La RLS de recette_masquee ne renvoie que ses lignes. En
  // cas d'erreur de lecture, on n'exclut rien (la génération prime) et on
  // journalise — jamais de catch muet.
  const { data: masques, error: masquesError } = await supabase
    .from("recette_masquee")
    .select("recette_id")
  if (masquesError) {
    console.error("Lecture des recettes masquées échouée (aucune exclusion).", masquesError)
  }
  const idsMasques = new Set(
    (masques ?? []).map((m) => (m as { recette_id: string }).recette_id)
  )

  // Conversion DB → domaine, exclusion des masquées, puis génération (RG-01 à RG-03).
  const recettesDomain = (recettes as unknown as DbRecette[])
    .map(dbRecetteToDomain)
    .filter((r) => !idsMasques.has(r.id))

  // Réglages de génération personnalisés (#45, P09) : la RLS ne renvoie que la
  // ligne de l'utilisateur (ou aucune → réglages par défaut). Le client n'en
  // est pas l'autorité (les contraintes DB garantissent la validité). En cas
  // d'erreur de lecture, on retombe sur les défauts pour ne pas bloquer la
  // génération (et on le journalise).
  const { data: dbReglages, error: reglagesError } = await supabase
    .from("reglages")
    .select(
      "personnes_defaut, max_dejeuner_semaine, max_diner_semaine, max_dejeuner_weekend, max_diner_weekend, vege_dejeuner_semaine, vege_diner_semaine, vege_dejeuner_weekend, vege_diner_weekend, mix_accompagnement_jour, saisonnalite"
    )
    .maybeSingle()
  if (reglagesError) {
    console.error("Lecture des réglages échouée (défauts appliqués).", reglagesError)
  }
  const reglages = dbReglages
    ? dbReglagesToDomain(dbReglages as DbReglages)
    : REGLAGES_DEFAUT

  // RG-49/50/52 — Mémoire de variété (#218) : on lit les plannings du foyer des
  // FENETRE_VARIETE semaines PRÉCÉDANT la cible (RLS « foyer » → uniquement le
  // foyer courant) pour défavoriser dans le tirage les recettes servies
  // récemment. On ne récupère que `semaine` + les `recette_id` des slots (léger).
  // Best-effort : en cas d'erreur, on génère sans mémoire (jamais de blocage) et
  // on journalise — jamais de catch muet. La sélection manuelle n'est pas
  // concernée (RG-03 #23) : ce biais ne vit que dans la génération complète.
  const borneInf = semaineDecalee(semaine, -FENETRE_VARIETE)
  const { data: historique, error: historiqueError } = await supabase
    .from("planning")
    .select("semaine, planning_slot ( recette_id )")
    .gte("semaine", borneInf)
    .lt("semaine", semaine)
  if (historiqueError) {
    console.error(
      "Lecture de l'historique de variété échouée (variété ignorée).",
      historiqueError
    )
  }
  // id de recette → ancienneté en semaines de son apparition la PLUS RÉCENTE
  // (pénalité maximale) ; une recette vue plusieurs semaines ne compte qu'une fois.
  const historiqueVariete: HistoriqueVariete = new Map()
  for (const ligne of (historique ?? []) as Array<{
    semaine: string
    planning_slot: Array<{ recette_id: string }>
  }>) {
    const ancien = decalageEntre(ligne.semaine, semaine) // semaines écoulées (> 0)
    if (ancien < 1) continue
    for (const slot of ligne.planning_slot ?? []) {
      const courant = historiqueVariete.get(slot.recette_id)
      if (courant === undefined || ancien < courant) {
        historiqueVariete.set(slot.recette_id, ancien)
      }
    }
  }

  // RG-58/60/61 — Favoris/évités (#219) : préférences du FOYER (mon_foyer(),
  // pas de scope user comme recette_masquee) appliquées comme poids
  // multiplicatif, composé avec la mémoire de variété. Best-effort : en cas
  // d'erreur de lecture, on génère sans biais de préférence (jamais de
  // blocage) et on journalise — jamais de catch muet.
  const { data: preferencesDb, error: preferencesError } = await supabase
    .from("recette_preference")
    .select("recette_id, preference")
  if (preferencesError) {
    console.error(
      "Lecture des préférences favoris/évités échouée (préférence ignorée).",
      preferencesError
    )
  }
  const preferences: PreferencesRecettes = new Map(
    (preferencesDb ?? []).map((p) => [
      (p as { recette_id: string }).recette_id,
      (p as { preference: RecettePreference }).preference,
    ])
  )

  try {
    const planning = genererPlanning(
      recettesDomain,
      semaine,
      reglages,
      undefined,
      historiqueVariete,
      preferences
    )
    // RG-26 — préférence végé souple : on signale le NOMBRE de repas qui n'ont
    // pas pu être végétariens (vivier insuffisant) sans bloquer la génération.
    // Le client en fait un toast d'information (#86 PR2).
    const vegeNonHonore = slotsVegeNonHonores(planning, reglages).length
    // RG-27 — préférence « ≥1 légume/jour » souple : on signale le NOMBRE de
    // jours sans aucun repas « légumes » (vivier insuffisant), idem (#49 PR2).
    const mixNonHonore = joursSansLegume(planning, reglages).length
    // RG-28 — saisonnalité : on signale le NOMBRE de repas complétés hors-saison
    // par dégradation gracieuse (vivier de saison insuffisant) (#23 PR2).
    const saisonNonHonore = reposNonSaison(planning, reglages).length

    // Mode cycle (#259) : on projette le planning généré sur les jours du cycle,
    // regroupés par semaine ISO. Le client persiste chaque semaine via
    // `sauvegarder_slots` (upsert des seuls jours du cycle) puis re-projette.
    if (modeCycle) {
      const parSemaine = planningGenereParSemaine(planning, ancre, longueur)
      const semaines = Array.from(parSemaine, ([s, jours]) => ({ semaine: s, jours }))
      return NextResponse.json(
        { semaines, vegeNonHonore, mixNonHonore, saisonNonHonore },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { planning, vegeNonHonore, mixNonHonore, saisonNonHonore },
      { status: 200 }
    )
  } catch (erreur) {
    // genererPlanning lève si le vivier est insuffisant (trop peu de recettes
    // rapide/normal pour remplir la semaine) — message actionnable (RG-09).
    return apiError(
      "POST /api/planning/generer",
      erreur,
      "Pas assez de recettes pour générer un planning complet. Ajoute des recettes (notamment rapides ou normales) puis réessaie.",
      422
    )
  }
}
