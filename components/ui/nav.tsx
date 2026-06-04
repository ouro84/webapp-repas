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

const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
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
            aria-label="Repas de la semaine — accueil"
            className="flex items-center gap-2 font-semibold text-brand-700 transition-colors hover:text-brand-600"
          >
            <span aria-hidden="true" className="text-xl">🥗</span>
            <span className="hidden sm:inline">Repas de la semaine</span>
          </Link>

          {/* Liens de navigation */}
          <div className="flex gap-1">
            {LIENS.map(({ href, label }) => {
              const actif = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={actif ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    actif
                      ? "bg-brand-600 text-white"
                      : "text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </header>
  );
}
