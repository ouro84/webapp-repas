"use client";

// Écran de consentement OAuth 2.1 (#305, US-50, RG-72) — URL configurée dans
// Supabase OAuth Server (`site_url` + `/oauth/consent`). Route protégée par le
// proxy (session OMQ + onboarding terminé, retour via `/login?suivant=…`).

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EcranConsentement } from "@/components/oauth/ecran-consentement";

function Contenu() {
  const authorizationId = useSearchParams().get("authorization_id");
  return <EcranConsentement authorizationId={authorizationId} />;
}

export default function PageConsentement() {
  return (
    <main id="contenu" className="mx-auto w-full max-w-md flex-1 p-4 md:p-8">
      <Suspense fallback={<p className="text-sm text-brand-700/85">Chargement de la demande…</p>}>
        <Contenu />
      </Suspense>
    </main>
  );
}
