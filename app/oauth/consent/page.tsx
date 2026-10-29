"use client";

// Écran de consentement OAuth 2.1 (#305, US-50, RG-72) — URL configurée dans
// Supabase OAuth Server (`site_url` + `/oauth/consent`). Route protégée par le
// proxy (session OMQ + onboarding terminé, retour via `/login?suivant=…`).
// Parcours focalisé comme /bienvenue : pas de nav (cf. components/ui/nav.tsx).

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EcranConsentement } from "@/components/oauth/ecran-consentement";

function Contenu() {
  const authorizationId = useSearchParams().get("authorization_id");
  return <EcranConsentement authorizationId={authorizationId} />;
}

export default function PageConsentement() {
  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-1 flex-col justify-center p-6"
    >
      <Suspense
        fallback={
          <p role="status" className="animate-pulse text-center text-brand-700/85">
            Chargement de la demande…
          </p>
        }
      >
        <Contenu />
      </Suspense>
    </main>
  );
}
