// Initialisation Sentry côté navigateur (remplace l'ancien
// sentry.client.config.ts depuis @sentry/nextjs v9).
//
// Le DSN vient de NEXT_PUBLIC_SENTRY_DSN : le préfixe NEXT_PUBLIC_ est
// obligatoire pour que Next.js inline la valeur dans le bundle client.
// Un DSN n'est pas un secret (il ne permet que d'envoyer des événements).
// Si la variable est absente (DSN vide), Sentry se désactive silencieusement.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Monitoring d'erreurs uniquement : pas de tracing (tracesSampleRate
  // absent = désactivé) ni de session replay — trop intrusif pour un
  // usage perso et consommateur du quota gratuit.

  // Logs SDK en console uniquement en dev.
  debug: false,
});

// Instrumente les navigations App Router (contexte des erreurs).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
