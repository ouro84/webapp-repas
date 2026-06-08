"use client";

// Barre de navigation persistante — Client Component.
//
// Pourquoi "use client" ici ?
// usePathname() lit l'URL courante dans le navigateur. C'est un hook React
// qui ne peut pas s'exécuter côté serveur — d'où le Client Component.
// Le layout.tsx parent reste lui un Server Component : seul ce petit morceau
// interactif est "client".

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { Logo } from "@/components/ui/logo";

const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
  { href: "/recettes", label: "Recettes" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header role="banner">
      <nav
        aria-label="Navigation principale"
        className="sticky top-0 z-50 border-b border-brand-100 bg-white/90 backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          {/* Logo / accueil */}
          <Link
            href="/"
            aria-label="On mange quoi ? — accueil"
            className="flex items-center gap-2 font-semibold text-brand-700 transition-colors hover:text-brand-600"
          >
            <Logo className="size-6" />
            <span className="hidden sm:inline">On mange quoi&nbsp;?</span>
          </Link>

          {/* Liens de navigation */}
          <div className="flex items-center gap-1">
            {LIENS.map(({ href, label }) => {
              const actif = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={actif ? "page" : undefined}
                  // after:-inset-y-2 : étend la zone tactile verticale à ≥ 44px
                  // (inset-x-0 pour ne pas chevaucher le lien voisin, gap-1)
                  className={`relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
                    actif
                      ? "bg-brand-600 text-white"
                      : "text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
            {/* Réglages (#45) : icône engrenage, distincte des liens texte. */}
            {(() => {
              const actif = pathname.startsWith("/reglages");
              return (
                <Link
                  href="/reglages"
                  aria-label="Réglages"
                  aria-current={actif ? "page" : undefined}
                  className={`relative flex size-9 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1 after:content-[''] ${
                    actif
                      ? "bg-brand-600 text-white"
                      : "text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  <Settings className="size-5" aria-hidden="true" />
                </Link>
              );
            })()}
          </div>
        </div>
      </nav>
    </header>
  );
}
