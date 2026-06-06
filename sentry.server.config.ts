// Initialisation Sentry côté serveur Node.js (chargé via instrumentation.ts).

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Monitoring d'erreurs uniquement — pas de tracing (cf. instrumentation-client.ts).
  debug: false,
});
