"use client";

// Error boundary RACINE (App Router) — attrape les erreurs de rendu du layout
// racine (app/layout.tsx) et de ses enfants directs (NavBar, Toaster, polices,
// Analytics…), que app/error.tsx ne couvre PAS (celui-ci ne protège que les
// pages, à l'intérieur du layout). Cf. #30.
//
// Particularités vs app/error.tsx :
// - Il REMPLACE le layout racine entier → il doit rendre ses propres <html>/<body>.
// - globals.css est importé par le layout qui vient de crasher → Tailwind n'est
//   PAS garanti. Tous les styles sont donc autonomes (<style> embarqué + inline),
//   avec les valeurs hex du design system en dur (mode clair, cf. globals.css).
// - Pas de polices custom ni de NavBar (composants du layout en échec) → fallback
//   Arial. N'est actif qu'en PRODUCTION (en dev, Next affiche son overlay).

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  // Next.js enrichit l'erreur d'un digest (hash du log serveur) en prod.
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Toute erreur capturée est loggée (règle de code n°4) — en prod le message
  // affiché côté serveur est masqué, le digest permet de la retrouver.
  useEffect(() => {
    console.error(
      "Erreur non gérée attrapée par l'error boundary racine :",
      error,
    );
    // Remontée vers Sentry — les erreurs de rendu attrapées par une error
    // boundary ne sont pas capturées automatiquement par le SDK.
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "2rem",
          backgroundColor: "#fafaf5", // canvas
          color: "#1a3820", // brand-900
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {/* Styles autonomes (hover/focus du bouton) — zéro dépendance à globals.css. */}
        <style>{`
          .ge-bouton {
            border: none;
            cursor: pointer;
            border-radius: 9999px;
            padding: 0.75rem 1.5rem;
            font-size: 1rem;
            font-weight: 500;
            color: #ffffff;
            background-color: #3d7a44; /* brand-600 */
            transition: background-color 150ms ease;
          }
          .ge-bouton:hover { background-color: #2e5e34; } /* brand-700 */
          .ge-bouton:focus-visible {
            outline: 2px solid #3d7a44;
            outline-offset: 2px;
          }
        `}</style>

        <div
          style={{
            maxWidth: "28rem",
            borderRadius: "0.5rem",
            border: "1px solid #fecaca",
            backgroundColor: "#fef2f2",
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontWeight: 500, color: "#991b1b" }}>
            Quelque chose s&apos;est mal passé
          </p>
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.875rem",
              color: "#b91c1c",
            }}
          >
            Une erreur inattendue est survenue. Tu peux réessayer — si le
            problème persiste, recharge la page.
          </p>
          {error.digest && (
            <p
              style={{
                margin: "0.5rem 0 0",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                color: "#b91c1c",
              }}
            >
              Référence : {error.digest}
            </p>
          )}
        </div>

        <button type="button" onClick={reset} className="ge-bouton">
          Réessayer
        </button>
      </body>
    </html>
  );
}
