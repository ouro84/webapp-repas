// Confirmation de suppression de compte (#237, US-31) — route PUBLIQUE,
// statique. Un compte qui vient d'être supprimé n'est plus authentifié :
// hors protectedRoutes ET hors garde d'onboarding du proxy (comme /legal/*,
// #235).

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Compte supprimé — On mange quoi ?",
};

export default function PageCompteSupprime() {
  return (
    <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center p-8 text-center">
      <h1 className="font-display text-2xl font-semibold text-brand-900">
        Ton compte a été supprimé
      </h1>
      <p className="mt-2 text-brand-700/85">
        Toutes tes données ont été effacées. Merci d&apos;avoir utilisé « On mange quoi ? ».
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
      >
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
