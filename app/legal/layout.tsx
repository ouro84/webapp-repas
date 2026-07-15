// Layout des pages légales (#235) — route PUBLIQUE (hors protectedRoutes ET
// hors garde onboarding du proxy, cf. proxy.ts) : accessible déconnecté et
// pendant le tunnel d'onboarding. Nav simple entre les 3 pages.

import Link from "next/link";
import { PAGES_LEGALES } from "@/lib/legal";

export default function LayoutLegal({ children }: { children: React.ReactNode }) {
  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
      <nav aria-label="Documents légaux" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {PAGES_LEGALES.map((page) => (
          <Link
            key={page.slug}
            href={`/legal/${page.slug}`}
            className="text-brand-700 underline-offset-2 transition-colors hover:text-brand-900 hover:underline"
          >
            {page.titre}
          </Link>
        ))}
      </nav>
      <article>{children}</article>
    </main>
  );
}
