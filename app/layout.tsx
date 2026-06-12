import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "sonner";
import "./globals.css";
import { NavBar } from "@/components/ui/nav";
import { AlerteModifPlanning } from "@/components/ui/alerte-modif-planning";

// Identité de marque (#66, P14) — pairing rond et chaleureux qui remplace Geist
// (police « outil de dev », neutre). Fredoka habille le wordmark et les titres
// de page (classe `font-display`) ; Nunito porte tout le corps de texte
// (--font-sans). Polices variables : next/font gère l'axe de poids et le
// size-adjust (CLS minimal). Geist_Mono est conservé : seul `app/error.tsx`
// l'utilise (digest d'erreur en font-mono).
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "On mange quoi ?",
  description:
    "La question du soir a enfin sa réponse : génère ton planning de repas hebdomadaire et ta liste de courses.",
  applicationName: "On mange quoi ?",
  // PWA iOS (#71, P18) : iOS ignore le manifest pour l'icône d'accueil et le
  // mode standalone — il faut ces meta + app/apple-icon.png (apple-touch-icon
  // auto-lié par Next). Le manifest est, lui, auto-injecté via app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: "On mange quoi ?",
    statusBarStyle: "default",
  },
};

// Clavier mobile (#98) : par défaut Android/Chrome ne redimensionne que le
// visual viewport à l'ouverture du clavier — un bottom sheet ancré en bas
// (`dvh` + `mb-0`) glisse alors DERRIÈRE le clavier, masquant les résultats.
// `resizes-content` fait réduire le viewport de layout par le clavier : le
// sheet reste au-dessus. iOS/Safari n'implémente pas `interactive-widget`,
// d'où le complément côté sélecteur via l'API visualViewport (lib/clavier.ts).
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
  // Barre système (#71/#72) : vert brand en clair, charbon sombre en dark
  // (suit prefers-color-scheme de l'OS ; le toggle manuel ne pilote pas cette
  // meta, c'est un détail mineur acceptable).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#3d7a44" },
    { media: "(prefers-color-scheme: dark)", color: "#141815" },
  ],
};

// Script anti-FOUC (#72, P19) : résout la préférence de thème (clair/sombre/
// système) AVANT le premier paint et pose data-theme sur <html>. « système »
// → suit prefers-color-scheme ; un choix manuel le force. try/catch : si
// localStorage est inaccessible, on retombe sur le mode clair par défaut.
const SCRIPT_THEME = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang="fr" corrigé : important pour les lecteurs d'écran et le SEO
    <html
      lang="fr"
      className={`${fredoka.variable} ${nunito.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/*
        body en flex flex-col h-full : la NavBar prend sa hauteur naturelle,
        le contenu (children) remplit le reste via flex-1 sur chaque page.
      */}
      <body className="flex min-h-full flex-col">
        {/* Anti-FOUC dark mode (#72) : pose data-theme avant le paint du body. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_THEME }} />
        {/* Skip link (WCAG 2.4.1) : visible uniquement au focus clavier,
            permet de sauter la NavBar pour atteindre le contenu directement */}
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
        >
          Aller au contenu
        </a>
        <NavBar />
        {/*
          Notifications toast (sonner) — aux couleurs du design system via les
          variables CSS émises par le @theme de globals.css.
        */}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--color-surface)",
              border: "1px solid var(--color-brand-100)",
              color: "var(--color-brand-900)",
            },
          }}
        />
        {children}
        {/* Alerte intrusive de modif planning (#56 PR5, US-21) — montée une
            seule fois ici ; inerte hors des pages synchronisées. */}
        <AlerteModifPlanning />
        {/* Vercel Analytics : mesure d'audience, sans cookie */}
        <Analytics />
        {/* Vercel Speed Insights : mesure des Core Web Vitals en réel */}
        <SpeedInsights />
      </body>
    </html>
  );
}
