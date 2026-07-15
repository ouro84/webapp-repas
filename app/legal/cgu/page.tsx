// Conditions générales d'utilisation (#235, US-29) — route publique, SSG.

import type { Metadata } from "next";
import { ArticleMarkdown } from "@/components/aide/article-markdown";
import { chargerPageLegale } from "@/lib/legal-fs";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation — On mange quoi ?",
};

export default async function PageCGU() {
  const contenu = await chargerPageLegale("cgu");
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-semibold text-brand-900">
        Conditions générales d&apos;utilisation
      </h1>
      <ArticleMarkdown contenu={contenu} />
    </>
  );
}
