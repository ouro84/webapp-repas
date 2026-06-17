// Sommaire de l'aide (#97) — route PUBLIQUE (hors protectedRoutes du proxy) :
// accessible sans connexion. Server Component : lit le contenu committé
// (content/aide/index.json) au build, rendu statique.

import type { Metadata } from "next";
import Link from "next/link";
import { chargerIndexAide, grouperParSection } from "@/lib/aide";

export const metadata: Metadata = {
  title: "Aide — On mange quoi ?",
  description: "Guide d'utilisation de l'application On mange quoi ?",
};

export default async function PageAide() {
  const articles = await chargerIndexAide();
  const sections = grouperParSection(articles);

  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-brand-900">Aide</h1>
        <p className="mt-2 text-brand-700/85">
          Comment utiliser « On mange quoi ? » — choisis un sujet ci-dessous.
        </p>
      </header>

      {/* État vide (RG-09) : aucune doc publiée. */}
      {sections.length === 0 ? (
        <p className="text-brand-700/85">La documentation arrive bientôt.</p>
      ) : (
        <div className="space-y-8">
          {sections.map(({ section, articles }) => (
            <section key={section}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-700/85">
                {section}
              </h2>
              <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-surface">
                {articles.map((article) => (
                  <li key={article.slug}>
                    <Link
                      href={`/aide/${article.slug}`}
                      className="block px-4 py-3 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      <span className="block font-medium text-brand-900">
                        {article.titre}
                      </span>
                      {article.resume && (
                        <span className="mt-0.5 block text-sm text-brand-700/85">
                          {article.resume}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
