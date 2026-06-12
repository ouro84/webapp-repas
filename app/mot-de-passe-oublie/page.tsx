"use client";

// Mot de passe oublié — demande de réinitialisation (#22 PR1, US-22 scénario 2,
// absorbe #82). Étape 1/2 : l'utilisateur saisit son email, Supabase envoie un
// lien de récupération pointant vers /auth/reinitialiser (étape 2).
//
// Confidentialité : on affiche le MÊME message de succès que l'email existe ou
// non (pas d'énumération de comptes). resetPasswordForEmail ne révèle pas non
// plus l'existence du compte.

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LienPied } from "@/components/auth/formulaire-auth";

export default function PageMotDePasseOublie() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);

  async function soumettre(evenement: React.FormEvent): Promise<void> {
    evenement.preventDefault();
    setChargement(true);
    setErreur(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reinitialiser`,
    });

    setChargement(false);
    if (error) {
      setErreur("Envoi impossible pour le moment. Réessaie dans un instant.");
      return;
    }
    setEnvoye(true);
  }

  return (
    <main
      id="contenu"
      className="flex min-h-[80dvh] flex-1 items-center justify-center p-4"
    >
      <div className="w-full max-w-sm">
        <h1 className="mb-2 font-display text-2xl font-semibold text-brand-900">
          Mot de passe oublié
        </h1>

        {envoye ? (
          <>
            <p
              role="status"
              className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900"
            >
              Si un compte existe pour cette adresse, un lien de réinitialisation
              vient d’être envoyé. Pense à vérifier tes spams.
            </p>
            <p className="mt-4 text-center text-sm text-brand-700/85">
              <LienPied href="/login">Retour à la connexion</LienPied>
            </p>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-brand-700/85">
              Saisis ton adresse : on t’envoie un lien pour définir un nouveau mot
              de passe.
            </p>
            <form onSubmit={soumettre} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="text-sm font-medium text-brand-900">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                {chargement ? "Envoi…" : "Envoyer le lien"}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-brand-700/85">
              <Link
                href="/login"
                className="font-medium text-brand-700 underline underline-offset-2 transition-colors hover:text-brand-600"
              >
                Retour à la connexion
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
