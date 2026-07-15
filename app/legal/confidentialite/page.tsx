// Politique de confidentialité (#235/#236) — route publique, SSG.

import type { Metadata } from "next";
import { ArticleMarkdown } from "@/components/aide/article-markdown";
import { chargerPageLegale } from "@/lib/legal-fs";

export const metadata: Metadata = {
  title: "Politique de confidentialité — On mange quoi ?",
};

export default async function PageConfidentialite() {
  const contenu = await chargerPageLegale("confidentialite");
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-semibold text-brand-900">
        Politique de confidentialité
      </h1>
      <ArticleMarkdown contenu={contenu} />
    </>
  );
}
