import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Autorise l'accès au serveur de dev depuis le réseau local (test mobile).
  // Next 16 bloque par défaut les requêtes cross-origin vers les ressources
  // de dev (_next/*) — sans cela, la navigation depuis un téléphone casse.
  // Sans effet en production.
  allowedDevOrigins: ["10.0.0.18"],
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
