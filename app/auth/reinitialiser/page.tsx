"use client";

// Réinitialisation du mot de passe (#22 PR1, US-22 scénario 2, absorbe #82).
// Étape 2/2 : l'utilisateur arrive ici depuis le lien de récupération reçu par
// email. supabase-js (createBrowserClient, detectSessionInUrl par défaut) établit
// une session de récupération à partir du fragment d'URL → updateUser peut poser
// le nouveau mot de passe.
//
// Au succès, on coupe la session de récupération et on invite à se reconnecter
// avec le nouveau mot de passe (confirmation visible, plutôt qu'un toast perdu à
// la navigation).

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { traduireErreurAuth } from "@/lib/messages-auth";
import { LONGUEUR_MIN_MDP } from "@/lib/auth-regles";

// Source unique partagée (#189) — garde-fou UX ; l'autorité réelle est Supabase.
const LONGUEUR_MIN = LONGUEUR_MIN_MDP;

export default function PageReinitialiser() {
  const supabase = createClient();
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [reussi, setReussi] = useState(false);

  async function soumettre(evenement: React.FormEvent): Promise<void> {
    evenement.preventDefault();
    setErreur(null);

    if (nouveau.length < LONGUEUR_MIN) {
      setErreur(`Le mot de passe doit faire au moins ${LONGUEUR_MIN} caractères.`);
      return;
    }
    if (nouveau !== confirmation) {
      setErreur("La confirmation ne correspond pas.");
      return;
    }

    setChargement(true);
    const { error } = await supabase.auth.updateUser({ password: nouveau });
    if (error) {
      setChargement(false);
      // Lien expiré / déjà utilisé / session absente : message actionnable.
      setErreur(
        traduireErreurAuth(error) +
          " Le lien a peut-être expiré : redemande-en un."
      );
      return;
    }

    // Coupe la session de récupération : la reconnexion se fait avec le nouveau
    // mot de passe (parcours propre).
    await supabase.auth.signOut();
    setChargement(false);
    setReussi(true);
  }

  return (
    <main
      id="contenu"
      className="flex min-h-[80dvh] flex-1 items-center justify-center p-4"
    >
      <div className="w-full max-w-sm">
        <h1 className="mb-2 font-display text-2xl font-semibold text-brand-900">
          Nouveau mot de passe
        </h1>

        {reussi ? (
          <>
            <p
              role="status"
              className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900"
            >
              Ton mot de passe a été mis à jour. Tu peux te reconnecter.
            </p>
            <Link
              href="/login"
              className="mt-4 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Se connecter
            </Link>
          </>
        ) : (
          <form onSubmit={soumettre} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1">
              <label htmlFor="mdp-nouveau" className="text-sm font-medium text-brand-900">
                Nouveau mot de passe
              </label>
              <input
                id="mdp-nouveau"
                type="password"
                autoComplete="new-password"
                minLength={LONGUEUR_MIN}
                value={nouveau}
                onChange={(e) => setNouveau(e.target.value)}
                required
                className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="mdp-confirmation" className="text-sm font-medium text-brand-900">
                Confirme le mot de passe
              </label>
              <input
                id="mdp-confirmation"
                type="password"
                autoComplete="new-password"
                minLength={LONGUEUR_MIN}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
                className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
              />
            </div>

            {erreur !== null && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {erreur}
              </p>
            )}

            <button
              type="submit"
              disabled={chargement}
              aria-busy={chargement}
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
            >
              {chargement ? "Mise à jour…" : "Définir le mot de passe"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
