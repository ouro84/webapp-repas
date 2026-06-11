import type { MetadataRoute } from "next";

// Manifest PWA (#71, P18) — convention App Router : ce fichier est servi en
// /manifest.webmanifest et Next injecte automatiquement <link rel="manifest">.
//
// Objectif : app installable sur l'écran d'accueil (usage en magasin, mobile-
// first). Pas de service worker ici — localStorage + le cache Next couvrent
// l'usage ; l'offline complet est un chantier séparé (cf. ticket).
//
// Icônes générées par scripts/generer-icones-pwa.mjs depuis app/icon.svg :
// - any        : mark blanc sur fond vert brand-600
// - maskable   : idem avec zone de sécurité (icône adaptative Android)
// - monochrome : mark blanc sur transparent → re-teinté par le launcher
//   (icônes thématiques Material You, Android 13+)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "On mange quoi ?",
    short_name: "On mange quoi",
    description:
      "Génère ton planning de repas hebdomadaire et ta liste de courses.",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf5", // canvas (écran de démarrage)
    theme_color: "#3d7a44", // brand-600 (barre système)
    categories: ["food", "lifestyle", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-monochrome-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
    // Appui long sur l'icône → actions rapides (B2).
    shortcuts: [
      {
        name: "Planning de la semaine",
        short_name: "Planning",
        url: "/planning",
      },
      {
        name: "Liste de courses",
        short_name: "Courses",
        url: "/courses",
      },
    ],
    // Dialogue d'installation enrichi sur Chrome Android (B3).
    screenshots: [
      {
        src: "/icons/screenshot-mobile.png",
        sizes: "390x844",
        type: "image/png",
        form_factor: "narrow",
        label: "Accueil — On mange quoi ?",
      },
      {
        src: "/icons/screenshot-desktop.png",
        sizes: "1280x800",
        type: "image/png",
        form_factor: "wide",
        label: "Accueil — On mange quoi ?",
      },
    ],
  };
}
