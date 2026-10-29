// Enregistrement des outils du serveur MCP d'OMQ (#305, #306, US-51, US-52,
// RG-73→79).
//
// Chaque appel d'outil crée un client Supabase « par jeton » avec le jeton
// OAuth de la requête (RG-71 : RLS mon_foyer(), jamais `service_role`) et
// délègue à lib/mcp/lecture.ts ou lib/mcp/ecriture-*.ts, avec la date du jour
// à Paris (le serveur est en UTC). Noms d'outils en français `snake_case`.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { creerClientParJeton } from "@/lib/supabase/par-jeton"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { lireListeCourses, lirePlanning, lireRecette } from "@/lib/mcp/lecture"
import { changerPersonnes, genererCycle, remplacerRepas } from "@/lib/mcp/ecriture-planning"
import { ajouterRecette } from "@/lib/mcp/ecriture-recettes"
import { ajouterArticleCourses, cocherArticle } from "@/lib/mcp/ecriture-courses"
import { limiteGeneration } from "@/lib/rate-limit"
import { aujourdhuiParis } from "@/lib/semaines"
import { LIBELLES_UNITES } from "@/lib/unites"
import { ORDRE_CATEGORIES } from "@/lib/courses"
import { SAISONS } from "@/lib/saisons"
import type { ClientSupabase } from "@/lib/supabase/types"
import type { CategorieIngredient, Saison, Unite } from "@/types"

const ERREUR_INTERNE = "Erreur interne d'OMQ. Réessaie dans un instant."

type ContexteOutil = { http?: { authInfo?: { token: string; extra?: Record<string, unknown> } } }

const CONNEXION_REQUISE = "Connexion à OMQ requise : reconnecte l'assistant."

// Exécute un outil avec le client de l'utilisateur ; traduit les erreurs en
// résultat `isError` lisible par l'assistant (RG-78).
async function executer<T extends Record<string, unknown>>(
  ctx: ContexteOutil,
  outil: (supabase: ClientSupabase, userId: string) => Promise<T>
): Promise<CallToolResult> {
  try {
    const jeton = ctx.http?.authInfo?.token
    const userId = ctx.http?.authInfo?.extra?.userId
    if (!jeton || typeof userId !== "string") throw new ErreurOutil(CONNEXION_REQUISE)
    const resultat = await outil(creerClientParJeton(jeton), userId)
    return {
      content: [{ type: "text", text: JSON.stringify(resultat) }],
      structuredContent: resultat,
    }
  } catch (erreur) {
    if (erreur instanceof ErreurOutil) {
      return { isError: true, content: [{ type: "text", text: erreur.message }] }
    }
    console.error("Outil MCP en échec.", erreur)
    return { isError: true, content: [{ type: "text", text: ERREUR_INTERNE }] }
  }
}

export function enregistrerOutilsLecture(server: McpServer): void {
  server.registerTool(
    "lire_planning",
    {
      title: "Lire le planning des repas",
      description:
        "Repas prévus, chacun désigné par date (AAAA-MM-JJ) et créneau (midi | soir), avec la recette et le nombre de personnes. Sans argument : le cycle de courses en cours. Avec `semaine` (AAAA-Www) : cette semaine ISO. Une liste vide signifie qu'aucun repas n'est prévu : propose generer_cycle. Un repas `restes: true` ne se cuisine pas : on finit les restes du plat indiqué.",
      inputSchema: z.object({
        semaine: z.string().optional().describe("Semaine ISO, ex. 2026-W44. Par défaut : le cycle en cours."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => lirePlanning(supabase, args, aujourdhuiParis()))
  )

  server.registerTool(
    "lire_liste_courses",
    {
      title: "Lire la liste de courses",
      description:
        "Liste de courses du cycle en cours, groupée par rayon, articles ajoutés à la main compris. Par défaut, seulement ce qu'il reste à acheter (articles non cochés) ; `inclure_coches: true` renvoie aussi les articles cochés. `a_verifier_au_placard` liste les produits à vérifier avant d'acheter.",
      inputSchema: z.object({
        inclure_coches: z.boolean().optional().describe("Inclure les articles déjà cochés (défaut : non)."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => lireListeCourses(supabase, args, aujourdhuiParis()))
  )

  server.registerTool(
    "lire_recette",
    {
      title: "Lire la recette d'un repas",
      description:
        "Ingrédients à l'échelle du repas et étapes d'une recette prévue, désignée par date et créneau. Appelle d'abord lire_planning si tu ne connais pas la date. Si `restes: true`, il n'y a rien à cuisiner : on finit les restes de ce plat, ingrédients et étapes ne servent qu'à le rappeler.",
      inputSchema: z.object({
        date: z.string().describe("Date du repas, AAAA-MM-JJ."),
        creneau: z.enum(["midi", "soir"]).describe("Créneau du repas."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => lireRecette(supabase, args, aujourdhuiParis()))
  )
}

const DATE = z.string().describe("Date du repas, AAAA-MM-JJ.")
const CRENEAU = z.enum(["midi", "soir"]).describe("Créneau du repas.")
const UNITES = Object.keys(LIBELLES_UNITES) as [Unite, ...Unite[]]
const CATEGORIES = ORDRE_CATEGORIES as [CategorieIngredient, ...CategorieIngredient[]]

export function enregistrerOutilsEcriture(server: McpServer): void {
  server.registerTool(
    "generer_cycle",
    {
      title: "Générer le cycle de repas",
      description:
        "Génère le cycle de courses en cours (ou celui qui contient `ancre`, AAAA-MM-JJ) avec les réglages du foyer, comme « Générer mon cycle » dans l'app, et renvoie les repas créés (date + créneau). Si le cycle contient déjà des repas, l'outil refuse : demande alors confirmation à l'utilisateur, puis rappelle avec `remplacer: true`. Réinitialise les coches de la liste de courses du cycle. `avertissements` compte les préférences (végé, légumes, saison) non honorées faute de recettes.",
      inputSchema: z.object({
        ancre: z.string().optional().describe("Une date du cycle visé, AAAA-MM-JJ. Par défaut : le cycle en cours."),
        remplacer: z
          .boolean()
          .optional()
          .describe("true pour écraser un cycle existant, seulement après accord de l'utilisateur."),
      }),
    },
    async (args, ctx) =>
      executer(ctx, (supabase, userId) =>
        // Même seau que la génération web (rl:generer, 10/min) : un seul quota de
        // génération par utilisateur, consommé seulement si on génère vraiment.
        genererCycle(supabase, args, aujourdhuiParis(), async () => {
          if (!(await limiteGeneration(userId)).autorise) {
            throw new ErreurOutil("Trop de générations en peu de temps. Patiente une minute puis réessaie.")
          }
        })
      )
  )

  server.registerTool(
    "remplacer_repas",
    {
      title: "Remplacer un repas",
      description:
        "Remplace le repas désigné par date et créneau. Sans `recette` : tirage automatique, comme le bouton « Changer » de l'app. Avec `recette` : recherche ce nom dans le catalogue et les recettes du foyer ; un nom exact l'emporte. Si plusieurs recettes correspondent, rien n'est modifié : `modifie: false`, `candidats` (10 au plus) et `total` ; demande à l'utilisateur laquelle choisir (ou d'affiner si `total` dépasse la liste), puis rappelle avec le nom exact. Si aucune ne correspond, propose ajouter_recette. Le nombre de personnes du repas est conservé. Un repas marqué restes redevient un repas à cuisiner. Après un tirage automatique, `avertissements` signale les préférences (végé, légumes, saison) non honorées.",
      inputSchema: z.object({
        date: DATE,
        creneau: CRENEAU,
        recette: z.string().optional().describe("Nom de la recette voulue. Absent : tirage automatique."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => remplacerRepas(supabase, args, aujourdhuiParis()))
  )

  server.registerTool(
    "changer_personnes",
    {
      title: "Changer le nombre de personnes",
      description:
        "Change le nombre de personnes d'un repas (entier de 1 à 12), désigné par date et créneau. Les quantités de la liste de courses suivent aussitôt, sauf pour un repas marqué restes, qui n'entre pas dans la liste.",
      inputSchema: z.object({
        date: DATE,
        creneau: CRENEAU,
        personnes: z.number().describe("Nombre de personnes, entier de 1 à 12."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => changerPersonnes(supabase, args, aujourdhuiParis()))
  )

  server.registerTool(
    "ajouter_recette",
    {
      title: "Ajouter une recette du foyer",
      description:
        "Crée une recette dans les recettes du foyer, que la génération et remplacer_repas pourront ensuite utiliser. Structure toi-même la recette : nom, temps de préparation (rapide < 20 min, normal 20-45 min, long > 45 min), ingrédients pour 2 personnes avec quantité, unité et rayon, étapes. Nomme chaque ingrédient au singulier et en minuscules (« oignon », pas « Oignons ») : la liste de courses additionne les ingrédients de même nom et de même unité. `vegetarien`, `accompagnement` et `saisons` sont déduits des ingrédients s'ils sont omis. Refuse si le foyer a déjà une recette de ce nom (casse et accents ignorés) et la décrit.",
      inputSchema: z.object({
        nom: z.string().describe("Nom de la recette."),
        temps_preparation: z.enum(["rapide", "normal", "long"]),
        vegetarien: z.boolean().optional(),
        accompagnement: z.enum(["feculents", "legumes"]).nullable().optional(),
        saisons: z
          .array(z.enum(SAISONS as [Saison, ...Saison[]]))
          .optional()
          .describe("Vide ou absent : toute l'année."),
        etapes: z.array(z.string()).optional().describe("Étapes de préparation, dans l'ordre."),
        ingredients: z
          .array(
            z.object({
              nom: z.string(),
              quantite: z.number().describe("Quantité pour 2 personnes, strictement positive."),
              unite: z.enum(UNITES).describe("piece = à l'unité ; cas / cac = cuillère à soupe / à café."),
              categorie: z.enum(CATEGORIES).describe("Rayon du magasin."),
              fond_de_placard: z.boolean().optional().describe("Produit qu'on a d'habitude (sel, huile…)."),
            })
          )
          .describe("Au moins un ingrédient."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase, userId) => ajouterRecette(supabase, userId, args))
  )

  server.registerTool(
    "ajouter_article_courses",
    {
      title: "Ajouter un article à la liste de courses",
      description:
        "Ajoute un article à la main à la liste de courses du cycle en cours (hors recettes : lessive, piles…). Quantité et unité facultatives ; rayon « autre » par défaut.",
      inputSchema: z.object({
        libelle: z.string().describe("Libellé de l'article, 200 caractères au plus."),
        quantite: z.number().optional(),
        unite: z.enum(UNITES).optional(),
        categorie: z.enum(CATEGORIES).optional().describe("Rayon du magasin."),
        fond_de_placard: z.boolean().optional(),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => ajouterArticleCourses(supabase, args, aujourdhuiParis()))
  )

  server.registerTool(
    "cocher_article",
    {
      title: "Cocher un article de la liste de courses",
      description:
        "Coche (ou décoche avec `coche: false`) un article de la liste de courses du cycle en cours, désigné par son libellé tel que renvoyé par lire_liste_courses. Si plusieurs articles correspondent (même nom en deux unités, par exemple), rien n'est coché : `modifie: false` et `candidats` ; rappelle avec `quantite` (texte exact du candidat) pour départager.",
      inputSchema: z.object({
        libelle: z.string().describe("Libellé de l'article."),
        coche: z.boolean().optional().describe("false pour décocher. Par défaut : cocher."),
        quantite: z.string().optional().describe("Quantité exacte du candidat voulu, ex. « 200 g »."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => cocherArticle(supabase, args, aujourdhuiParis()))
  )
}
