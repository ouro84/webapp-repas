// Hook d'instrumentation Next.js : charge la config Sentry adaptée au
// runtime au démarrage du serveur (convention Next, pas spécifique Sentry).

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture les erreurs des React Server Components et des route handlers,
// invisibles autrement (elles ne passent pas par les error boundaries client).
export const onRequestError = Sentry.captureRequestError;
