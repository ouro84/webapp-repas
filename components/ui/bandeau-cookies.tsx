"use client";

// Bandeau de consentement cookies (#236, US-30) — non bloquant : reste tant
// qu'aucun choix n'est fait (useConsentementAnalytics() === null), sur TOUTES
// les pages (publiques et app). Monté une seule fois dans app/layout.tsx,
// même patron que AlerteModifPlanning (composant qui se rend lui-même en
// null quand il n'a rien à afficher).
//
// Accepter / Refuser à PROMINENCE ÉGALE (RG #236) : pas de simple croix de
// fermeture qui vaudrait acceptation implicite — les deux actions sont des
// boutons de même poids visuel.

import { accepterConsentement, refuserConsentement, useConsentementAnalytics } from "@/lib/consentement";

export function BandeauCookies() {
  const choix = useConsentementAnalytics();
  if (choix !== null) return null;

  return (
    // PAS de position fixed/sticky (bug vécu, e2e profil.spec) : un bandeau
    // fixe en bas recouvre et bloque les clics sur des boutons de bas de page
    // (ex. « Se déconnecter » de /profil). En flux normal, dernier enfant du
    // <body flex flex-col>, la zone flex-1 des pages se réduit d'elle-même
    // pour lui faire de la place — aucun chevauchement possible.
    <div
      role="region"
      aria-label="Consentement aux cookies"
      className="border-t border-brand-100 bg-surface p-4"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-brand-900">
          On utilise des cookies pour mesurer l&apos;audience de l&apos;application. Tu peux
          accepter ou refuser — voir notre{" "}
          <a
            href="/legal/confidentialite"
            className="text-brand-700 underline underline-offset-2 hover:text-brand-900"
          >
            politique de confidentialité
          </a>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={refuserConsentement}
            className="rounded-full border border-brand-200 px-5 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            Refuser
          </button>
          <button
            type="button"
            onClick={accepterConsentement}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
