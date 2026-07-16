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
import { HelpCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { useProfil } from "@/lib/profil";
import { useEstConnecte } from "@/lib/session";
import { libelleMomentActuel } from "@/lib/prochain-repas";

const LIENS = [
  { href: "/planning", label: "Planning" },
  { href: "/courses", label: "Courses" },
  { href: "/recettes", label: "Recettes" },
];

// Routes protégées (cf. proxy.ts) : le proxy y garantit une session → on peut
// afficher la nav complète sans attendre le signal d'auth client (pas de
// scintillement sur le chemin chaud). Les pages publiques (/, /aide, /login…)
// attendent, elles, le vrai signal `useEstConnecte`.
const ROUTES_PROTEGEES = ["/planning", "/courses", "/recettes", "/reglages", "/profil", "/ce-soir"];

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
  const profil = useProfil();
  const estConnecte = useEstConnecte();
  // Libellé dynamique (#suite #279/#280) : la page /ce-soir affiche le
  // prochain repas ACTIF, qui peut être le déjeuner — un lien figé sur
  // « Ce soir » serait faux le midi. Même seuil que lib/prochain-repas.ts.
  const libelleCeSoir = libelleMomentActuel(new Date());

  // Tunnel d'onboarding (#22 PR2) : parcours focalisé, sans nav (on ne propose
  // aucune échappatoire tant que l'onboarding n'est pas terminé).
  if (pathname === "/bienvenue") return null;

  // Nav applicative (liens de section + avatar) réservée aux connectés (#207).
  // Tant que le signal d'auth est indéterminé (null), on retombe sur « suis-je
  // sur une route protégée ? » : le proxy y garantit la session → nav complète
  // sans attendre, donc aucun scintillement sur le chemin chaud.
  const surRouteProtegee = ROUTES_PROTEGEES.some((r) => pathname.startsWith(r));
  const afficherNavApp = estConnecte ?? surRouteProtegee;

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
            {afficherNavApp ? (
              <>
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
                {/* Lien « Ce soir »/« Ce midi » (#suite #279/#280) : sorti de la
                    boucle générique ci-dessus car son libellé est calculé
                    (heure réelle), pas un texte statique — même style/logique
                    active que les liens de section. */}
                <Link
                  href="/ce-soir"
                  aria-current={estActif(pathname, "/ce-soir") ? "page" : undefined}
                  className={`relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
                    estActif(pathname, "/ce-soir")
                      ? "bg-primary text-white"
                      : "text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  {libelleCeSoir}
                </Link>
                {/* Raccourci aide (audit critique, #97) : distinct de l'avatar —
                    déconnecté, la nav garde un vrai lien texte « Aide » (cf.
                    branche ci-dessous), mais il disparaissait entièrement une
                    fois connecté, reporté à un lien texte enfoui en bas de
                    /profil. Icône seule (place limitée à côté des 4 sections +
                    l'avatar), même style tactile que les liens de section. */}
                <Link
                  href="/aide"
                  aria-label="Aide"
                  title="Aide"
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-brand-700 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 hover:text-brand-900"
                >
                  <HelpCircle className="size-5" aria-hidden="true" />
                </Link>
                {/* Profil (#22 PR1) : l'avatar remplace l'ex-engrenage de réglages
                    (#45). Point d'entrée « mon compte » (prénom, foyer, sécurité,
                    réglages de génération, thème, déconnexion). Anneau actif sur
                    /profil. La bascule de thème vit désormais dans /profil (#205). */}
                {(() => {
                  const actif = estActif(pathname, "/profil");
                  return (
                    <Link
                      href="/profil"
                      aria-label={
                        profil?.prenom ? `Profil de ${profil.prenom}` : "Profil"
                      }
                      aria-current={actif ? "page" : undefined}
                      className={`relative flex items-center justify-center rounded-full transition-colors after:absolute after:-inset-1 after:content-[''] ${
                        actif ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""
                      }`}
                    >
                      <Avatar
                        prenom={profil?.prenom}
                        couleur={profil?.couleurAvatar}
                        taille="sm"
                      />
                    </Link>
                  );
                })()}
              </>
            ) : (
              /* Déconnecté (#207) : nav minimale — pas de liens applicatifs qui
                 rebondiraient vers /login. Seule l'aide (route publique) reste. */
              <Link
                href="/aide"
                aria-current={estActif(pathname, "/aide") ? "page" : undefined}
                className="relative rounded-full px-4 py-1.5 text-sm font-medium text-brand-700 transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] hover:bg-brand-50"
              >
                Aide
              </Link>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
