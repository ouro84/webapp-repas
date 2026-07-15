// Pied de page global (#235) — liens vers les documents légaux, sur toutes
// les pages. Pas de footer global avant cette PR.

import Link from "next/link";
import { PAGES_LEGALES } from "@/lib/legal";

export function PiedDePage() {
  return (
    <footer className="border-t border-brand-100 p-4 text-center text-xs text-brand-700/85">
      <nav aria-label="Documents légaux" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {PAGES_LEGALES.map((page) => (
          <Link
            key={page.slug}
            href={`/legal/${page.slug}`}
            className="underline-offset-2 transition-colors hover:text-brand-900 hover:underline"
          >
            {page.titre}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
