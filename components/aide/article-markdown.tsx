// Rendu Markdown d'un article d'aide (#97), stylé aux tokens du design system
// (pas de plugin typography). react-markdown rend côté serveur → HTML statique
// au build, aucun JS client. remark-gfm pour les tableaux. Pas de rehype-raw :
// le HTML brut éventuel est échappé (le script de pull ne produit que du
// Markdown pur, cf. scripts/pull-aide.mjs).

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const composants: Components = {
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 font-display text-xl font-semibold text-brand-900">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 font-semibold text-brand-900">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-3 leading-relaxed text-brand-900/90">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-5 text-brand-900/90">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-5 text-brand-900/90">{children}</ol>
  ),
  // Callouts Notion → blockquote : encadré terracotta (touche d'accent de marque).
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-lg border-l-4 border-accent-500 bg-accent-50 px-4 py-3 text-brand-900/90 [&>p]:my-0">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => {
    const cible = href ?? "#";
    const classe =
      "text-brand-700 underline underline-offset-2 transition-colors hover:text-brand-900";
    // Liens internes (/aide/…, autres routes) via next/link ; externes en <a>.
    return cible.startsWith("/") ? (
      <Link href={cible} className={classe}>
        {children}
      </Link>
    ) : (
      <a href={cible} className={classe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  code: ({ children }) => (
    <code className="rounded bg-brand-50 px-1 py-0.5 font-mono text-sm text-accent-700">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg bg-brand-900 p-4 text-sm text-canvas">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-6 border-brand-100" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-brand-100 bg-brand-50 px-3 py-2 text-left font-semibold text-brand-900">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-brand-100 px-3 py-2 text-brand-900/90">{children}</td>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      // Images rapatriées dans public/aide/ par le script de pull.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt ?? ""} className="my-4 rounded-lg" />
    ) : null,
};

export function ArticleMarkdown({ contenu }: { contenu: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={composants}>
      {contenu}
    </ReactMarkdown>
  );
}
