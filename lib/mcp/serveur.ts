// Enregistrement des outils du serveur MCP d'OMQ (#305, US-51, RG-73, RG-78).
//
// Chaque appel d'outil crée un client Supabase « par jeton » avec le jeton
// OAuth de la requête (RG-71 : RLS mon_foyer(), jamais `service_role`) et
// délègue à lib/mcp/lecture.ts, avec la date du jour à Paris (le serveur est
// en UTC). Noms d'outils en français `snake_case`.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { creerClientParJeton } from "@/lib/supabase/par-jeton"
import { ErreurOutil } from "@/lib/mcp/erreurs"
import { lireListeCourses, lirePlanning, lireRecette } from "@/lib/mcp/lecture"
import { aujourdhuiParis } from "@/lib/mcp/repas"
import type { ClientSupabase } from "@/lib/supabase/types"

const ERREUR_INTERNE = "Erreur interne d'OMQ. Réessaie dans un instant."

type ContexteOutil = { http?: { authInfo?: { token: string } } }

// Exécute un outil avec le client de l'utilisateur ; traduit les erreurs en
// résultat `isError` lisible par l'assistant (RG-78).
async function executer<T extends Record<string, unknown>>(
  ctx: ContexteOutil,
  outil: (supabase: ClientSupabase) => Promise<T>
): Promise<CallToolResult> {
  try {
    const jeton = ctx.http?.authInfo?.token
    if (!jeton) throw new ErreurOutil("Connexion à OMQ requise : reconnecte l'assistant.")
    const resultat = await outil(creerClientParJeton(jeton))
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
        "Repas prévus, chacun désigné par date (AAAA-MM-JJ) et créneau (midi | soir), avec la recette et le nombre de personnes. Sans argument : le cycle de courses en cours. Avec `semaine` (AAAA-Www) : cette semaine ISO. Une liste vide signifie qu'aucun repas n'est prévu : l'utilisateur peut générer son planning depuis l'app OMQ.",
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
        "Ingrédients à l'échelle du repas et étapes d'une recette prévue, désignée par date et créneau. Appelle d'abord lire_planning si tu ne connais pas la date.",
      inputSchema: z.object({
        date: z.string().describe("Date du repas, AAAA-MM-JJ."),
        creneau: z.enum(["midi", "soir"]).describe("Créneau du repas."),
      }),
    },
    async (args, ctx) => executer(ctx, (supabase) => lireRecette(supabase, args, aujourdhuiParis()))
  )
}
