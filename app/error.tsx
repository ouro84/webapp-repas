"use client";

// Error boundary global (App Router) — attrape toute erreur de rendu non
// gérée par les pages et affiche un écran de repli au lieu d'un crash blanc.
//
// Convention Next.js : ce fichier doit être un Client Component et reçoit
// l'erreur capturée + reset() qui re-tente le rendu du segment en échec.
// Reprend l'idiome visuel des états erreur des pages (cf. planning RG-09).

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  // Next.js enrichit l'erreur d'un digest (hash du log serveur) en prod.
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Toute erreur capturée est loggée (règle de code n°4) — en prod le
  // message affiché côté serveur est masqué, le digest permet de la retrouver.
  useEffect(() => {
    console.error("Erreur non gérée attrapée par l'error boundary :", error);
    // Remontée vers Sentry — les erreurs de rendu attrapées par une error
    // boundary ne sont pas capturées automatiquement par le SDK.
    Sentry.captureException(error);
  }, [error]);

  return (
    <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <p className="font-medium text-red-800">Quelque chose s&apos;est mal passé</p>
        <p className="mt-1 text-sm text-red-700">
          Une erreur inattendue est survenue. Tu peux réessayer — si le
          problème persiste, recharge la page.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-red-700/70">
            Référence : {error.digest}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Réessayer
      </button>
    </main>
  );
}
