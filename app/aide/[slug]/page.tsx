// Article d'aide (#97) — route PUBLIQUE, rendu statique (SSG).
// generateStaticParams pré-génère une page par article publié ; un slug
// inconnu renvoie notFound().

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleMarkdown } from "@/components/aide/article-markdown";
import { chargerCorpsArticle, chargerIndexAide } from "@/lib/aide";

export async function generateStaticParams() {
  const articles = await chargerIndexAide();
  return articles.map((article) => ({ slug: article.slug }));
}

async function trouverMeta(slug: string) {
  const articles = await chargerIndexAide();
  return articles.find((a) => a.slug === slug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = await trouverMeta(slug);
  if (!meta) return { title: "Aide — On mange quoi ?" };
  return {
    title: `${meta.titre} — Aide — On mange quoi ?`,
    description: meta.resume,
  };
}

export default async function PageArticleAide({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [meta, contenu] = await Promise.all([
    trouverMeta(slug),
    chargerCorpsArticle(slug),
  ]);
  if (!meta || contenu === null) notFound();

  const majLe = new Date(meta.majLe).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
      <Link
        href="/aide"
        className="inline-block text-sm text-brand-700 underline-offset-2 transition-colors hover:text-brand-900 hover:underline"
      >
        ← Toute l’aide
      </Link>

      <header className="mt-4 mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
          {meta.section}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-brand-900">
          {meta.titre}
        </h1>
        <p className="mt-1 text-xs text-brand-700/85">Mis à jour le {majLe}</p>
      </header>

      <article>
        <ArticleMarkdown contenu={contenu} />
      </article>
    </main>
  );
}
