// Accès au contenu de la doc utilisateur (#97, modèle B).
//
// Le contenu est COMMITTÉ au repo par scripts/pull-aide.mjs (source de vérité =
// Notion). Ces helpers le lisent au build (SSG) : aucune dépendance réseau ni
// Supabase. Toute la logique calendaire de tri vit ici, pas dans les pages.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ArticleAide = {
  titre: string;
  slug: string;
  section: string;
  ordre: number;
  resume: string;
  motsCles: string[];
  majLe: string;
};

// Ordre canonique des sections (miroir de scripts/pull-aide.mjs — figé côté
// code, pas dans Notion). Toute évolution doit être faite des deux côtés.
export const ORDRE_SECTIONS = [
  "Démarrage",
  "Planning",
  "Recettes",
  "Courses",
  "Réglages",
  "Foyer",
  "Mon compte",
  "Dépannage",
] as const;

const RACINE = join(process.cwd(), "content", "aide");

/** Sommaire : tous les articles publiés, déjà triés par le script. */
export async function chargerIndexAide(): Promise<ArticleAide[]> {
  const brut = await readFile(join(RACINE, "index.json"), "utf8");
  return JSON.parse(brut) as ArticleAide[];
}

/** Corps Markdown d'un article, ou null si le slug n'existe pas. */
export async function chargerCorpsArticle(slug: string): Promise<string | null> {
  try {
    return await readFile(join(RACINE, `${slug}.md`), "utf8");
  } catch {
    // Slug inconnu : la page appelante renvoie notFound().
    return null;
  }
}

/** Regroupe les articles par section, dans l'ordre canonique. */
export function grouperParSection(
  articles: ArticleAide[]
): { section: string; articles: ArticleAide[] }[] {
  return ORDRE_SECTIONS.map((section) => ({
    section,
    articles: articles
      .filter((a) => a.section === section)
      .sort((a, b) => a.ordre - b.ordre),
  })).filter((groupe) => groupe.articles.length > 0);
}
