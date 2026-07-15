// Lecture du contenu Markdown des pages légales (#235) — SERVER ONLY (node:fs).
// Contenu committé, édité directement dans content/legal/*.md — pas de
// pipeline de pull, contrairement à /aide (source Notion) : un changement de
// texte juridique est une simple édition de fichier, sans nouvelle migration.
// N'importer que depuis des Server Components (cf. lib/legal.ts pour les
// constantes client-safe).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SlugLegal } from "@/lib/legal";

const RACINE = join(process.cwd(), "content", "legal");

/** Corps Markdown d'une page légale. */
export async function chargerPageLegale(slug: SlugLegal): Promise<string> {
  return readFile(join(RACINE, `${slug}.md`), "utf8");
}
