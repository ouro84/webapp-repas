// Initialisation Sentry pour le runtime Edge (middleware/proxy, routes edge).
// Chargé via instrumentation.ts.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Monitoring d'erreurs uniquement — pas de tracing (cf. instrumentation-client.ts).
  debug: false,
});
