// Mentions légales (#235, US-29) — route publique, SSG.

import type { Metadata } from "next";
import { ArticleMarkdown } from "@/components/aide/article-markdown";
import { chargerPageLegale } from "@/lib/legal-fs";

export const metadata: Metadata = {
  title: "Mentions légales — On mange quoi ?",
};

export default async function PageMentionsLegales() {
  const contenu = await chargerPageLegale("mentions-legales");
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-semibold text-brand-900">
        Mentions légales
      </h1>
      <ArticleMarkdown contenu={contenu} />
    </>
  );
}
