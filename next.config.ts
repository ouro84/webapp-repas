import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// En-têtes de sécurité (#188, audit F-01, palier 1). Statiques et sans risque
// fonctionnel : ils ne dépendent d'aucune origine externe (contrairement à la
// CSP, palier 2, qui doit lister Supabase/Sentry/Vercel et passe d'abord en
// report-only). Appliqués à toutes les routes via headers() ci-dessous.
//   - X-Frame-Options DENY : anti-clickjacking (interdit l'encadrement en iframe).
//   - X-Content-Type-Options nosniff : empêche la confusion de type MIME.
//   - Referrer-Policy : ne fuite pas l'URL complète (ex. ?code= d'invitation)
//     vers une origine tierce via l'en-tête Referer.
//   - Permissions-Policy : coupe l'accès aux API sensibles (caméra, micro, géoloc)
//     et désactive le FLoC (interest-cohort) — l'app n'en utilise aucune.
const ENTETES_SECURITE = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

// Content-Security-Policy (#188, audit F-01, palier 2). Stratégie `script-src`
// retenue : `'unsafe-inline'` (pragmatique) — conserve le rendu PRERENDER des
// pages statiques (/, /login) et reste simple ; le nonce (qui forcerait le rendu
// dynamique partout) a été écarté, la surface XSS réelle étant quasi nulle
// (React échappe, pas de rehype-raw, seul inline = script anti-FOUC statique).
//
// Origines autorisées (inventaire vérifié) :
//   - script-src : Vercel Analytics/Speed Insights (va.vercel-scripts.com)
//   - connect-src : Supabase REST + Realtime (wss), Sentry (ingest), Vercel insights
//   - style-src 'unsafe-inline' : Tailwind v4 / sonner / next-font injectent du style inline
//   - font-src 'self' : next/font est auto-hébergé (servi depuis /_next)
//   - img-src data:/blob: : SVG inline, QR code (qrcode.react), avatars
//
// ⚠️ Livrée en `Content-Security-Policy-Report-Only` (NON bloquant) : on observe
// d'abord les violations (console navigateur) sur les vrais parcours — Realtime à
// deux onglets, QR d'invitation, toasts, /aide, dark mode — AVANT de passer en
// enforcement (renommer la clé en `Content-Security-Policy`). Toute nouvelle
// origine externe devra être ajoutée ici (cf. ADR-10).
// Dev-only allowance pour le picker /impeccable live (localhost:8400).
// Gardé par NODE_ENV : n'apparaît jamais en dehors du dev, retirable en
// revertant ce fichier.
const __impeccableLiveDev =
  process.env.NODE_ENV === "development" ? " http://localhost:8400" : "";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com${__impeccableLiveDev}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io https://*.vercel-insights.com https://va.vercel-scripts.com${__impeccableLiveDev}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const ENTETES_AVEC_CSP = [
  ...ENTETES_SECURITE,
  // Report-only d'abord — cf. note ci-dessus (bascule en enforcement = renommer
  // cette clé en "Content-Security-Policy").
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig: NextConfig = {
  // Autorise l'accès au serveur de dev depuis le réseau local (test mobile).
  // Next 16 bloque par défaut les requêtes cross-origin vers les ressources
  // de dev (_next/*) — sans cela, la navigation depuis un téléphone casse.
  // Sans effet en production.
  allowedDevOrigins: ["10.0.0.18"],

  async headers() {
    return [{ source: "/:path*", headers: ENTETES_AVEC_CSP }];
  },
};

// withSentryConfig instrumente le build (injection des configs runtime).
// L'upload des source maps vers Sentry est inactif tant qu'aucun
// SENTRY_AUTH_TOKEN n'est fourni — les stack traces seront minifiées en
// prod, acceptable pour l'instant (le digest Next reste disponible).
export default withSentryConfig(nextConfig, {
  // Pas de télémétrie Sentry sur l'outillage de build.
  telemetry: false,
  // N'affiche les logs du plugin qu'en cas d'erreur.
  silent: true,
});
