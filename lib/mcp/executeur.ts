// Outils du run de l'exécuteur de panier, sur l'endpoint dédié /api/mcp/executeur
// (#330, RG-83, RG-85) : `prendre_demande_panier` renvoie la liste à remplir,
// signée article par article, et `cocher_article_demande` coche sur le cycle de
// la demande prise. Pourquoi : un run a sauté la prise, inventé une ancre et
// rempli le vrai panier ; l'exécuteur ne reçoit désormais ni ancre à deviner ni
// terme à inventer, et le MCP chronodrive refuse tout ajout sans jeton valide.
//
// Sous le propre jeton OAuth de l'appelant (RLS mon_foyer(), RG-71), jamais
// `service_role`. La liste est lue par les services de `lib/` comme
// `lire_liste_courses` (règle du jumeau) ; les jetons sont signés dans Postgres
// par `signer_jetons_panier` (le secret ne quitte jamais la base).

import { resoudreCycle } from "@/lib/ancre-cycle"
import { chargerLongueurCycle } from "@/lib/persistance"
import { LIBELLES_CATEGORIES } from "@/lib/courses"
import { libelleCycle } from "@/lib/cycles"
import { cleJeton } from "@/lib/jeton-panier"
import { retirerArticlesCoches } from "@/lib/liste-courses"
import { chargerListeCoursesCycle } from "@/lib/liste-courses-cycle"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { cocherArticleDansCycle, type CochageMcp } from "@/lib/mcp/ecriture-courses"
import { versArticle } from "@/lib/mcp/lecture"
import { rapporterPanier } from "@/lib/mcp/panier"
import { MESSAGES_PANIER, type RapportPanier } from "@/lib/panier"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { Ingredient } from "@/types"

export type ArticleDemande = {
  libelle: string
  quantite: string
  rayon: string
  placard: boolean
  manuel: boolean
  jeton: string
}

export type PriseDemande =
  | {
      demande: {
        id: string
        ancre: string
        cycle: { du: string; au: string; libelle: string }
        expire_le: string
        articles: ArticleDemande[]
      }
    }
  | { demande: null; raison: string }

const RAISON_AUCUNE_DEMANDE = "Aucune demande en attente : arrête-toi sans rien faire d'autre."
const MOTIF_CYCLE_CHANGE =
  "Le cycle de courses a changé depuis la demande : relance le panier depuis /courses."
const RAISON_LISTE_VIDE = "Liste de courses vide : rien à ajouter, compte-rendu envoyé."

// Fabrique, pas constante : les listes ne doivent jamais être partagées par référence entre deux rapports.
const rapportVide = (): RapportPanier => ({ ajoutes: [], a_choisir: [], introuvables: [] })

type DemandeEnCours = { id: string; ancre: string; pris_le: string }

const MOTIF_ERREUR_INTERNE =
  "Erreur interne d’OMQ pendant la préparation du panier : relance le panier depuis /courses."

/**
 * `prendre_demande_panier` de l'exécuteur : passe la plus ancienne demande
 * `en_attente` en `en_cours` (RPC), lit la liste NON cochée du cycle
 * `demande.ancre` et la renvoie avec un jeton signé par article. Si le cycle a
 * changé depuis la demande, ou si la liste est vide, la prise rapporte elle-même
 * (`echec` / `terminee`) et ne renvoie aucune liste : l'exécuteur s'arrête.
 *
 * Toute exception APRÈS la prise (lecture du cycle, de la liste, signature)
 * est rapportée en `echec` avant d'être relancée : sans cela la demande resterait
 * `en_cours` sans rapport, un nouveau `prendre` répondrait « aucune demande » et
 * le foyer serait bloqué jusqu'à l'expiration (30 min, RG-83).
 */
export async function prendreDemandeExecuteur(
  supabase: ClientSupabase,
  aujourdhui: Date
): Promise<PriseDemande> {
  const { data, error } = await supabase.rpc("prendre_demande_panier")
  if (error) throw new Error(`Prise de la demande de panier impossible : ${error.message}`)
  if (!data) return { demande: null, raison: RAISON_AUCUNE_DEMANDE }
  const demande = data as DemandeEnCours

  try {
    return await preparerPrise(supabase, demande, aujourdhui)
  } catch (erreur) {
    // Une `ErreurOutil` post-prise vient d'un rapport ou d'une signature qui dit
    // déjà que la demande est close ou expirée (OMQ03, OMQ05) : rien à rapporter.
    if (!(erreur instanceof ErreurOutil)) {
      try {
        await rapporterPanier(supabase, {
          demande_id: demande.id,
          statut: "echec",
          motif: MOTIF_ERREUR_INTERNE,
          ...rapportVide(),
        })
      } catch (erreurRapport) {
        // Best effort : l'erreur d'origine reste celle qui remonte.
        console.error("[mcp prendre_demande_panier] rapport d'échec impossible", erreurRapport)
      }
    }
    throw erreur
  }
}

async function preparerPrise(
  supabase: ClientSupabase,
  demande: DemandeEnCours,
  aujourdhui: Date
): Promise<PriseDemande> {
  // Jour de courses changé entre la demande et la prise : l'ancre ne désigne
  // plus un cycle de la grille, remplir ce panier serait faux (RG-83).
  const resolution = await resoudreCycle(supabase, { date: demande.ancre }, aujourdhui)
  if (!resolution.ok || resolution.cycle.ancre !== demande.ancre) {
    await rapporterPanier(supabase, {
      demande_id: demande.id,
      statut: "echec",
      motif: MOTIF_CYCLE_CHANGE,
      ...rapportVide(),
    })
    return { demande: null, raison: MOTIF_CYCLE_CHANGE }
  }

  const { cycle } = resolution
  const { liste, coches } = await chargerListeCoursesCycle(supabase, cycle)
  const restante = retirerArticlesCoches(liste, coches)
  const lignes: Array<{ i: Ingredient; placard: boolean }> = [
    ...restante.normal.flatMap((ligne) => ligne.ingredients.map((i) => ({ i, placard: false }))),
    ...restante.fondDePlacard.map((i) => ({ i, placard: true })),
  ]

  if (lignes.length === 0) {
    await rapporterPanier(supabase, {
      demande_id: demande.id,
      statut: "terminee",
      ...rapportVide(),
    })
    return { demande: null, raison: RAISON_LISTE_VIDE }
  }

  const articles = lignes.map(({ i, placard }) => ({
    ...versArticle(i, null),
    placard,
    rayon: LIBELLES_CATEGORIES[i.categorie],
  }))
  const { data: signes, error: erreurSignature } = await supabase.rpc("signer_jetons_panier", {
    p_demande: demande.id,
    p_cles: articles.map((a) => cleJeton(a.nom)),
  })
  if (erreurSignature) {
    // Demande expirée entre la prise et la signature : l'exécuteur doit s'arrêter.
    if (erreurSignature.code === "OMQ05") throw new ErreurOutil(MESSAGES_PANIER.OMQ05)
    throw new Error(`Signature des jetons de panier impossible : ${erreurSignature.message}`)
  }
  const { expire_le, jetons } = signes as { expire_le: number; jetons: string[] }
  if (!Array.isArray(jetons) || jetons.length !== articles.length) {
    throw new Error(
      `Signature des jetons de panier incohérente : ${articles.length} articles, ${Array.isArray(jetons) ? jetons.length : "aucun"} jetons.`
    )
  }

  return {
    demande: {
      id: demande.id,
      ancre: demande.ancre,
      cycle: { du: cycle.du, au: cycle.au, libelle: libelleCycle(cycle.ancre, cycle.longueur) },
      expire_le: new Date(expire_le * 1000).toISOString(),
      articles: articles.map((a, n) => ({
        libelle: a.nom,
        quantite: a.quantite,
        rayon: a.rayon,
        placard: a.placard,
        manuel: a.manuel,
        jeton: jetons[n],
      })),
    },
  }
}

/**
 * `cocher_article_demande` : coche un article du cycle de la demande en cours
 * (`demande_panier_en_cours`), jamais celui du jour, sans argument `ancre` à
 * inventer. Vise exactement `demande.ancre`, sans la re-résoudre : si le jour de
 * courses change pendant le run, la coche ne part pas sur un autre cycle. Ne
 * décoche jamais. Ambiguïté → `candidats`, rien coché, comme
 * `cocher_article`. Sans demande prise, OMQ05 : l'exécuteur s'arrête (RG-83).
 */
export async function cocherArticleDemande(
  supabase: ClientSupabase,
  args: { libelle: string; quantite?: string }
): Promise<CochageMcp> {
  const { data, error } = await supabase.rpc("demande_panier_en_cours")
  if (error) throw new Error(`Lecture de la demande de panier en cours impossible : ${error.message}`)
  if (!data) throw new ErreurOutil(MESSAGES_PANIER.OMQ05)
  const { ancre } = data as DemandeEnCours
  const longueur = await chargerLongueurCycle(ancre, supabase)
  return cocherArticleDansCycle(supabase, { libelle: args.libelle, quantite: args.quantite }, { ancre, longueur })
}
