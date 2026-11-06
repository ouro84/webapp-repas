// Outils MCP d'écriture de la liste de courses (#306, US-52, RG-77, RG-79).
//
// Mêmes écritures que /courses, sous RLS mon_foyer() (RG-71) : un article
// manuel du cycle courant (#216, RG-40→43) et la coche d'un article (RG-10),
// désigné par sa `ref` stable (#372) ou son libellé. Les tables étant publiées en temps réel, un
// navigateur ouvert sur /courses voit le changement sans code dédié (RG-79).

import {
  basculerCocheArticleManuelDistant,
  cocherArticleDistant,
  creerArticleManuelDistant,
  decocherArticleDistant,
} from "@/lib/persistance"
import { chargerListeCoursesCycle } from "@/lib/liste-courses-cycle"
import { articleManuelVersIngredient } from "@/lib/articles-manuels"
import { cleAgregation } from "@/lib/courses"
import { estCoche, type Coches } from "@/lib/coches"
import { accorderNom } from "@/lib/pluriels"
import { normaliser } from "@/lib/recherche"
import { lireRef, refArticle } from "@/lib/ref-article"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { cycleVise } from "@/lib/mcp/cycle"
import { libellePeriode, versArticle, type ArticleMcp } from "@/lib/mcp/lecture"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { CategorieIngredient, Ingredient, Unite } from "@/types"

// Bornes du libellé : celles du formulaire et de la contrainte article_manuel.
const LIBELLE_MAX = 200

/**
 * `ajouter_article_courses` : article manuel sur le cycle COURANT (même ancre
 * que /courses), règles du formulaire : libellé 1 à 200 caractères, quantité
 * ignorée si non positive, catégorie « autre » par défaut. Jamais fusionné
 * avec un homonyme (RG-42).
 */
export async function ajouterArticleCourses(
  supabase: ClientSupabase,
  args: {
    libelle: string
    quantite?: number
    unite?: Unite
    categorie?: CategorieIngredient
    fond_de_placard?: boolean
  },
  aujourdhui: Date = new Date()
): Promise<{ article: ArticleMcp; periode: { du: string; au: string; libelle: string } }> {
  const libelle = args.libelle.trim()
  if (libelle.length === 0 || libelle.length > LIBELLE_MAX) {
    throw new ErreurOutil(`Libellé invalide : entre 1 et ${LIBELLE_MAX} caractères.`)
  }
  const q = args.quantite
  const quantite = q !== undefined && Number.isFinite(q) && q > 0 ? q : null

  const { ancre, du, au } = await cycleVise(supabase, undefined, aujourdhui)
  const article = await creerArticleManuelDistant(
    ancre,
    {
      libelle,
      quantite,
      unite: args.unite ?? null,
      categorie: args.categorie ?? "autre",
      fondDePlacard: args.fond_de_placard === true,
    },
    supabase
  )
  return {
    article: versArticle(articleManuelVersIngredient(article), null),
    periode: { du, au, libelle: libellePeriode(du, au) },
  }
}

export type CochageMcp =
  | { modifie: boolean; article: ArticleMcp }
  | { modifie: false; candidats: ArticleMcp[] }

// Libellé exact (casse, accents, pluriel affiché ignorés) d'abord, sinon
// inclusion : « lait » ne doit pas tomber en ambiguïté face à « lait de coco ».
function trouverArticles(articles: Ingredient[], libelle: string): Ingredient[] {
  const aiguille = normaliser(libelle)
  const noms = (i: Ingredient) => [normaliser(accorderNom(i)), normaliser(i.nom)]
  const exacts = articles.filter((i) => noms(i).includes(aiguille))
  return exacts.length > 0 ? exacts : articles.filter((i) => noms(i).some((n) => n.includes(aiguille)))
}

/** Désignation d'un article à cocher : `ref` (prioritaire, #372) ou libellé. */
export type DesignationArticle = { ref?: string; libelle?: string; quantite?: string }

const SANS_DESIGNATION =
  "Désigne l'article par sa `ref` ou par son `libelle`, tels que reçus avec la liste."
const REF_INCONNUE = "Cet article n'est plus dans la liste."
const REF_INVALIDE =
  "Référence d'article invalide : recopie telle quelle la `ref` reçue avec la liste."
const QUANTITE_CHANGEE = "La quantité de cet article a changé depuis la lecture : relis la liste."

// Refus avant toute lecture : ni `ref` ni libellé, rien à désigner.
function exigerDesignation(args: DesignationArticle): void {
  if (args.ref === undefined && args.libelle === undefined) throw new ErreurOutil(SANS_DESIGNATION)
}

// Égalité exacte de `ref` (espaces autour retirés), jamais de repli sur le
// libellé (#372) : la quantité cochée reste celle de la liste courante (RG-12).
// Une `quantite` fournie avec la `ref` doit être la quantité courante, sinon
// refus : la coche couvrirait plus que ce qui a été acheté (liste modifiée
// pendant le run de l'exécuteur, RG-12).
function articleParRef(articles: Ingredient[], ref: string, quantite: string | undefined): Ingredient {
  const article = articles.find((i) => refArticle(i) === ref)
  if (!article) throw new ErreurOutil(REF_INCONNUE)
  if (quantite !== undefined && versArticle(article, null).quantite !== quantite.trim()) {
    throw new ErreurOutil(QUANTITE_CHANGEE)
  }
  return article
}

// Chemin par libellé (inchangé par #372) : exact > inclusion, `quantite` pour
// départager, homonymes indiscernables traités l'un après l'autre.
function choisirParLibelle(
  tous: Ingredient[],
  libelle: string,
  quantite: string | undefined,
  coche: boolean,
  coches: Coches
): { article: Ingredient } | { candidats: ArticleMcp[] } {
  let articles = tous
  if (quantite !== undefined) {
    const voulue = quantite.trim()
    articles = articles.filter((i) => versArticle(i, null).quantite === voulue)
  }

  let trouves = trouverArticles(articles, libelle)
  if (trouves.length === 0) {
    throw new ErreurOutil(
      `Aucun article « ${libelle} » dans la liste de courses du cycle. Appelle lire_liste_courses pour voir les libellés exacts.`
    )
  }
  // Homonymes indiscernables (même libellé affiché, même quantité, ex. deux
  // articles manuels « Piles », RG-42) : l'assistant ne pourrait jamais
  // trancher. On traite le premier qui n'est pas déjà dans l'état visé.
  const signature = (i: Ingredient) => {
    const a = versArticle(i, null)
    return `${normaliser(a.nom)}|${a.quantite}`
  }
  if (trouves.length > 1 && trouves.every((i) => signature(i) === signature(trouves[0]))) {
    trouves = [trouves.find((i) => estCoche(coches, i) !== coche) ?? trouves[0]]
  }
  if (trouves.length > 1) return { candidats: trouves.map((i) => versArticle(i, coches)) }
  return { article: trouves[0] }
}

/**
 * `cocher_article` (RG-77) : met l'article désigné par sa `ref` (#372) ou son
 * libellé dans l'état `coche` (défaut : coché ; idempotent). Ambiguïté de
 * libellé → candidats, rien coché ; `quantite` (texte exact de
 * lire_liste_courses) départage des homonymes. Sans `ancre`, le cycle courant ;
 * avec, le cycle qui la contient (#320, RG-85) : la liste lue et la coche
 * écrite sont celles de CE cycle, jamais du courant.
 */
export async function cocherArticle(
  supabase: ClientSupabase,
  args: DesignationArticle & { coche?: boolean; ancre?: string },
  aujourdhui: Date = new Date()
): Promise<CochageMcp> {
  exigerDesignation(args)
  return cocherArticleDansCycle(supabase, args, await cycleVise(supabase, args.ancre, aujourdhui))
}

/**
 * Cœur de `cocher_article` sur un cycle DÉJÀ résolu. Ne résout jamais le
 * cycle : l'exécuteur de panier (#330, RG-83) coche exactement le cycle de sa
 * demande, même si le jour de courses change pendant le run (une re-résolution
 * viserait un autre cycle).
 *
 * Une `ref` (#372) prime sur le libellé : absente de la liste (cycle régénéré
 * entre la lecture et la coche), `ErreurOutil` sans repli sur le libellé, qui
 * pourrait viser un autre article. Une `quantite` fournie avec elle doit être la
 * quantité courante, sinon `ErreurOutil` (RG-12).
 */
export async function cocherArticleDansCycle(
  supabase: ClientSupabase,
  args: DesignationArticle & { coche?: boolean },
  cycle: { ancre: string; longueur: number }
): Promise<CochageMcp> {
  exigerDesignation(args)
  const ref = args.ref?.trim()
  if (ref !== undefined && lireRef(ref) === null) throw new ErreurOutil(REF_INVALIDE)
  const coche = args.coche !== false
  const { ancre, liste, coches } = await chargerListeCoursesCycle(supabase, cycle)
  const articles = [...liste.normal.flatMap((l) => l.ingredients), ...liste.fondDePlacard]

  const choix =
    ref !== undefined
      ? { article: articleParRef(articles, ref, args.quantite) }
      : choisirParLibelle(articles, args.libelle!, args.quantite, coche, coches)
  if ("candidats" in choix) return { modifie: false, candidats: choix.candidats }

  const { article } = choix
  if (estCoche(coches, article) === coche) {
    return { modifie: false, article: versArticle(article, coches) }
  }
  if (article.source === "manuel") {
    await basculerCocheArticleManuelDistant(article.id!, coche, supabase)
    return { modifie: true, article: versArticle({ ...article, coche }, coches) }
  }
  const cle = cleAgregation(article)
  if (coche) {
    // RG-12 : la coche mémorise la quantité au moment du cochage.
    await cocherArticleDistant(ancre, cle, article.quantite, supabase)
    return { modifie: true, article: versArticle(article, { ...coches, [cle]: article.quantite }) }
  }
  await decocherArticleDistant(ancre, cle, supabase)
  const restantes = { ...coches }
  delete restantes[cle]
  return { modifie: true, article: versArticle(article, restantes) }
}
