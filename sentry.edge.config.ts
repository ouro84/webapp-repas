// Initialisation Sentry pour le runtime Edge (middleware/proxy, routes edge).
// Chargé via instrumentation.ts.

import * as Sentry from "@sentry/nextjs";
import { COLLECTE_SENTRY } from "@/lib/sentry-collecte";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Base restrictive explicite (cf. lib/sentry-collecte.ts).
  dataCollection: COLLECTE_SENTRY,

  // Monitoring d'erreurs uniquement — pas de tracing (cf. instrumentation-client.ts).
  debug: false,
});
