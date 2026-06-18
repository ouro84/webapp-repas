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

const nextConfig: NextConfig = {
  // Autorise l'accès au serveur de dev depuis le réseau local (test mobile).
  // Next 16 bloque par défaut les requêtes cross-origin vers les ressources
  // de dev (_next/*) — sans cela, la navigation depuis un téléphone casse.
  // Sans effet en production.
  allowedDevOrigins: ["10.0.0.18"],

  async headers() {
    return [{ source: "/:path*", headers: ENTETES_SECURITE }];
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
