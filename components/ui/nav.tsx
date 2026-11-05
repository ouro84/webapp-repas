"use client";

// Navigation persistante — Client Components.
//
// Pourquoi "use client" ici ?
// usePathname() lit l'URL courante dans le navigateur. C'est un hook React
// qui ne peut pas s'exécuter côté serveur — d'où le Client Component.
// Le layout.tsx parent reste lui un Server Component : seuls ces morceaux
// interactifs sont "client".
//
// Deux barres (#335) :
// - `NavBar` (haut, sticky) : marque + aide + profil à toutes les largeurs ;
//   liens de section libellés à partir de `md:` seulement.
// - `OngletsBas` (bas, fixe, sous `md:`) : les 4 destinations du quotidien,
//   icône + libellé, sous le pouce. Remplace l'ex-nav mobile en icônes seules,
//   illisible pour un nouvel utilisateur (6 cibles sur 7 sans texte) ; un
//   burger aurait caché ces destinations derrière un tap de plus.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  ChefHat,
  HelpCircle,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { useProfil } from "@/lib/profil";
import { useEstConnecte } from "@/lib/session";
import { libelleMomentActuel } from "@/lib/prochain-repas";
import { estCheminOAuth } from "@/lib/redirection";

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

// Signal partagé par les deux barres.
// - `masquee` : parcours focalisés, sans nav — tunnel d'onboarding (#22 PR2,
//   aucune échappatoire tant que l'onboarding n'est pas terminé) et
//   consentement OAuth (#305, une seule décision : autoriser ou refuser).
// - `navApp` : nav applicative (sections + avatar) réservée aux connectés
//   (#207). Tant que le signal d'auth est indéterminé (null), on retombe sur
//   « suis-je sur une route protégée ? » : le proxy y garantit la session.
function useEtatNav() {
  const pathname = usePathname();
  const estConnecte = useEstConnecte();
  const masquee = pathname === "/bienvenue" || estCheminOAuth(pathname);
  const surRouteProtegee = ROUTES_PROTEGEES.some((r) => pathname.startsWith(r));
  return { pathname, masquee, navApp: estConnecte ?? surRouteProtegee };
}

type Section = { href: string; label: string; Icone: LucideIcon };

// Page d'arrivée d'un connecté (#335) : cible du logo et première section.
const HREF_CE_SOIR = "/ce-soir";

// Sections de l'app, DANS L'ORDRE D'AFFICHAGE, commun aux deux barres (#351) :
// fréquence d'usage — Ce soir (page d'arrivée) · Planning · Courses · Recettes.
// Aucune barre ne réordonne localement : deux ordres différents déroutaient en
// passant d'un appareil à l'autre.
// Libellé « Ce soir »/« Ce midi » dynamique (#279/#280) : la page /ce-soir
// affiche le prochain repas ACTIF, qui peut être le déjeuner — un libellé figé
// sur « Ce soir » serait faux le midi. Même seuil que lib/prochain-repas.ts.
// Toque plutôt qu'horloge (#335) : `Clock` se lisait « historique » ou
// « minuteur ».
function sections(): Section[] {
  return [
    { href: HREF_CE_SOIR, label: libelleMomentActuel(new Date()), Icone: ChefHat },
    { href: "/planning", label: "Planning", Icone: CalendarDays },
    { href: "/courses", label: "Courses", Icone: ShoppingCart },
    { href: "/recettes", label: "Recettes", Icone: BookOpen },
  ];
}

// Lien de section de la barre du haut (`md:` et plus) : libellé texte seul,
// la largeur n'y est pas contrainte.
function LienSection({ href, label, actif }: Section & { actif: boolean }) {
  return (
    <Link
      href={href}
      aria-current={actif ? "page" : undefined}
      // after:-inset-y-2 : étend la zone tactile verticale à ≥ 44px
      // (inset-x-0 pour ne pas chevaucher le lien voisin, gap-1)
      className={`relative flex items-center whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
        actif ? "bg-primary text-white" : "text-brand-700 hover:bg-brand-50"
      }`}
    >
      {label}
    </Link>
  );
}

export function NavBar() {
  const { pathname, masquee, navApp } = useEtatNav();
  const accueil = estActif(pathname, "/");
  const profil = useProfil();

  if (masquee) return null;

  return (
    <header role="banner">
      <nav
        aria-label="Navigation principale"
        // pt safe-area : PWA iOS en `viewportFit: "cover"` (#335).
        className="sticky top-0 z-50 border-b border-brand-100 bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          {/* Logo / accueil — état actif sur « / » (#73, P20) : pastille de fond
              (bg-brand-50), cohérente avec les liens actifs. aria-current
              annonce la page courante aux lecteurs d'écran. Connecté, il mène
              directement à /ce-soir (#335) : « / » n'est plus que la vitrine
              publique (le proxy y redirige aussi un accès direct). Wordmark
              visible à toutes les largeurs : la barre du haut n'a plus que
              l'aide et l'avatar à côté. */}
          <Link
            href={navApp ? HREF_CE_SOIR : "/"}
            aria-label="On mange quoi ? — accueil"
            aria-current={accueil ? "page" : undefined}
            className={`flex min-w-0 items-center gap-2 rounded-full px-2 py-1 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              accueil
                ? "bg-brand-50 text-brand-900"
                : "text-brand-700 hover:text-brand-600"
            }`}
          >
            <Logo className="size-6 shrink-0" />
            {/* Wordmark en Fredoka (#66, P14) — signature de marque */}
            <span className="truncate font-display text-[1.05rem]">
              On mange quoi&nbsp;?
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-1">
            {navApp ? (
              <>
                {/* Sections en haut à partir de `md:` seulement ; en dessous,
                    elles vivent dans OngletsBas. Même ordre que les onglets,
                    tel que donné par sections() (#351). */}
                <div className="hidden items-center gap-1 md:flex">
                  {sections().map((s) => (
                    <LienSection key={s.href} {...s} actif={estActif(pathname, s.href)} />
                  ))}
                </div>
                {/* Raccourci aide (audit critique, #97) : distinct de l'avatar —
                    déconnecté, la nav garde un vrai lien texte « Aide » (cf.
                    branche ci-dessous). Icône seule, même style tactile. */}
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

// Barre d'onglets du bas (#335), sous `md:` uniquement. Ordre = celui de
// sections(), partagé avec la barre du haut (#351).
// Montée en fin de <body> (cf. app/layout.tsx) : l'espaceur, dans le flux,
// garde le pied de page et le bandeau cookies au-dessus de la barre.
// `data-onglets-bas` sert aussi de signal CSS pour remonter les toasts
// (`--decalage-toasts`, app/globals.css).
export function OngletsBas() {
  const { pathname, masquee, navApp } = useEtatNav();
  if (masquee || !navApp) return null;

  return (
    <>
      <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" />
      <nav
        aria-label="Sections"
        data-onglets-bas=""
        className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-100 bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto flex max-w-md">
          {sections().map(({ href, label, Icone }) => {
            const actif = estActif(pathname, href);
            return (
              <li key={href} className="min-w-0 flex-1">
                <Link
                  href={href}
                  aria-current={actif ? "page" : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 ${
                    actif ? "text-brand-900" : "text-brand-700"
                  }`}
                >
                  {/* Pastille d'état actif autour de l'icône (convention des
                      barres d'onglets mobiles) : l'état se lit sans la couleur
                      du texte seule. */}
                  <span
                    className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors ${
                      actif ? "bg-brand-100" : ""
                    }`}
                  >
                    <Icone className="size-5" aria-hidden="true" />
                  </span>
                  <span className="max-w-full truncate px-1">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
