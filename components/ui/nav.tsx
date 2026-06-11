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
import { BasculeTheme } from "@/components/ui/bascule-theme";

const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
  { href: "/recettes", label: "Recettes" },
];

// État actif d'un lien de nav (#73, P20). Piège central : `startsWith("/")`
// matcherait TOUTES les routes → l'accueil se teste en égalité STRICTE. Les
// sections (/planning, /courses, /reglages…) restent en préfixe pour couvrir
// leurs sous-routes éventuelles. Centralisé ici pour ne pas re-tomber dans le
// piège ailleurs.
function estActif(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function NavBar() {
  const pathname = usePathname();
  const accueil = estActif(pathname, "/");

  return (
    <header role="banner">
      <nav
        aria-label="Navigation principale"
        className="sticky top-0 z-50 border-b border-brand-100 bg-surface/90 backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          {/* Logo / accueil */}
          {/* Logo / accueil — état actif sur « / » (#73, P20) : pastille de fond
              (bg-brand-50), cohérente avec les liens actifs. La pilule entoure
              le logo ET le wordmark, donc l'indice reste perceptible sur mobile
              où le wordmark est masqué (sm:) et seul le mark subsiste.
              aria-current annonce la page courante aux lecteurs d'écran. */}
          <Link
            href="/"
            aria-label="On mange quoi ? — accueil"
            aria-current={accueil ? "page" : undefined}
            className={`flex items-center gap-2 rounded-full px-2 py-1 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              accueil
                ? "bg-brand-50 text-brand-900"
                : "text-brand-700 hover:text-brand-600"
            }`}
          >
            <Logo className="size-6" />
            {/* Wordmark en Fredoka (#66, P14) — signature de marque */}
            <span className="hidden font-display text-[1.05rem] sm:inline">
              On mange quoi&nbsp;?
            </span>
          </Link>

          {/* Liens de navigation */}
          <div className="flex items-center gap-1">
            {LIENS.map(({ href, label }) => {
              const actif = estActif(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={actif ? "page" : undefined}
                  // after:-inset-y-2 : étend la zone tactile verticale à ≥ 44px
                  // (inset-x-0 pour ne pas chevaucher le lien voisin, gap-1)
                  className={`relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
                    actif
                      ? "bg-primary text-white"
                      : "text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
            {/* Réglages (#45) : icône engrenage, distincte des liens texte. */}
            {(() => {
              const actif = estActif(pathname, "/reglages");
              return (
                <Link
                  href="/reglages"
                  aria-label="Réglages"
                  aria-current={actif ? "page" : undefined}
                  className={`relative flex size-9 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1 after:content-[''] ${
                    actif
                      ? "bg-primary text-white"
                      : "text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  <Settings className="size-5" aria-hidden="true" />
                </Link>
              );
            })()}
            {/* Bascule de thème clair/sombre/système (#72, P19). */}
            <BasculeTheme />
          </div>
        </div>
      </nav>
    </header>
  );
}
