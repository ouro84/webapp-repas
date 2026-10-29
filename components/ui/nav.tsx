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
import {
  BookOpen,
  CalendarDays,
  Clock,
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

// Chaque section porte une icône : sous `sm:` la nav n'affiche QUE l'icône
// (cf. LienSection). Le libellé texte des 4 sections + le wordmark + l'aide +
// l'avatar dépassaient la largeur d'un mobile 390 px → débordement horizontal
// du body (la barre n'a ni wrap ni scroll interne).
const LIENS: { href: string; label: string; Icone: LucideIcon }[] = [
  { href: "/planning", label: "Planning", Icone: CalendarDays },
  { href: "/courses", label: "Courses", Icone: ShoppingCart },
  { href: "/recettes", label: "Recettes", Icone: BookOpen },
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

// Lien de section (Planning / Courses / Recettes / Ce soir).
//
// Mobile-first : sous `sm:` seule l'ICÔNE est rendue — les 4 libellés texte,
// additionnés au logo, à l'aide et à l'avatar, dépassaient 390 px de large et
// faisaient déborder le body horizontalement (la barre n'a ni `flex-wrap` ni
// scroll interne). Le texte réapparaît dès `sm:`.
//
// A11y : `aria-label` est posé EN PERMANENCE, pas seulement en icône. Le span
// de libellé est masqué par `hidden` (= `display:none`), qui le retire aussi de
// l'arbre d'accessibilité → sans aria-label le lien serait anonyme sur mobile
// (l'icône est `aria-hidden`). Corollaire : le nom accessible reste identique
// aux deux paliers, donc les e2e `getByRole("link", { name })` sont inchangés.
function LienSection({
  href,
  label,
  Icone,
  actif,
}: {
  href: string;
  label: string;
  Icone: LucideIcon;
  actif: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={actif ? "page" : undefined}
      // after:-inset-y-2 : étend la zone tactile verticale à ≥ 44px
      // (inset-x-0 pour ne pas chevaucher le lien voisin, gap-1)
      className={`relative flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] sm:px-4 ${
        actif ? "bg-primary text-white" : "text-brand-700 hover:bg-brand-50"
      }`}
    >
      <Icone className="size-5 sm:hidden" aria-hidden="true" />
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </Link>
  );
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

  // Parcours focalisés, sans nav : tunnel d'onboarding (#22 PR2, aucune
  // échappatoire tant que l'onboarding n'est pas terminé) et consentement
  // OAuth (#305, une seule décision à prendre : autoriser ou refuser).
  if (pathname === "/bienvenue" || estCheminOAuth(pathname)) return null;

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
                {LIENS.map(({ href, label, Icone }) => (
                  <LienSection
                    key={href}
                    href={href}
                    label={label}
                    Icone={Icone}
                    actif={estActif(pathname, href)}
                  />
                ))}
                {/* Lien « Ce soir »/« Ce midi » (#suite #279/#280) : sorti de la
                    boucle générique ci-dessus car son libellé est calculé
                    (heure réelle), pas un texte statique — même style/logique
                    active que les liens de section. */}
                <LienSection
                  href="/ce-soir"
                  label={libelleCeSoir}
                  Icone={Clock}
                  actif={estActif(pathname, "/ce-soir")}
                />
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
