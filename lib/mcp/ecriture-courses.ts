// Outils MCP d'écriture de la liste de courses (#306, US-52, RG-77, RG-79).
//
// Mêmes écritures que /courses, sous RLS mon_foyer() (RG-71) : un article
// manuel du cycle courant (#216, RG-40→43) et la coche d'un article (RG-10),
// désigné par son libellé. Les tables étant publiées en temps réel, un
// navigateur ouvert sur /courses voit le changement sans code dédié (RG-79).

import {
  basculerCocheArticleManuelDistant,
  chargerLongueurCycle,
  cocherArticleDistant,
  creerArticleManuelDistant,
  decocherArticleDistant,
} from "@/lib/persistance"
import { chargerJourCoursesFoyer } from "@/lib/foyer"
import { chargerListeCoursesCycle } from "@/lib/liste-courses-cycle"
import { articleManuelVersIngredient } from "@/lib/articles-manuels"
import { ancreParDefaut, joursDuCycle } from "@/lib/cycles"
import { cleAgregation } from "@/lib/courses"
import { estCoche } from "@/lib/coches"
import { accorderNom } from "@/lib/pluriels"
import { normaliser } from "@/lib/recherche"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { ancreDemandee, libellePeriode, versArticle, type ArticleMcp } from "@/lib/mcp/lecture"
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

  const ancre = ancreParDefaut(aujourdhui, await chargerJourCoursesFoyer(supabase))
  const longueur = await chargerLongueurCycle(ancre, supabase)
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
  const jours = joursDuCycle(ancre, longueur)
  const du = jours[0]
  const au = jours[jours.length - 1]
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

/**
 * `cocher_article` (RG-77) : met l'article désigné par son libellé dans l'état
 * `coche` (défaut : coché ; idempotent). Ambiguïté → candidats, rien coché ;
 * `quantite` (texte exact de lire_liste_courses) départage des homonymes. Sans
 * `ancre`, le cycle courant ; avec, le cycle qui la contient (#320, RG-85) :
 * la liste lue et la coche écrite sont celles de CE cycle, jamais du courant.
 */
export async function cocherArticle(
  supabase: ClientSupabase,
  args: { libelle: string; coche?: boolean; quantite?: string; ancre?: string },
  aujourdhui: Date = new Date()
): Promise<CochageMcp> {
  const coche = args.coche !== false
  const cycle = args.ancre !== undefined ? await ancreDemandee(supabase, args.ancre, aujourdhui) : undefined
  const { ancre, liste, coches } = await chargerListeCoursesCycle(supabase, { aujourdhui, ancre: cycle })
  let articles = [...liste.normal.flatMap((l) => l.ingredients), ...liste.fondDePlacard]
  if (args.quantite !== undefined) {
    const voulue = args.quantite.trim()
    articles = articles.filter((i) => versArticle(i, null).quantite === voulue)
  }

  let trouves = trouverArticles(articles, args.libelle)
  if (trouves.length === 0) {
    throw new ErreurOutil(
      `Aucun article « ${args.libelle} » dans la liste de courses du cycle. Appelle lire_liste_courses pour voir les libellés exacts.`
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
  if (trouves.length > 1) {
    return { modifie: false, candidats: trouves.map((i) => versArticle(i, coches)) }
  }

  const [article] = trouves
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
