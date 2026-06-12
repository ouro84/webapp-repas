"use client";

// Changement de mot de passe (#22 PR1, US-22 scénario 3) — section Sécurité de
// /profil. Exige le mot de passe ACTUEL avant d'enregistrer le nouveau.
//
// Supabase `updateUser({ password })` ne revérifie PAS l'identité : on
// ré-authentifie d'abord (signInWithPassword avec le mot de passe actuel) pour
// que la modification soit gardée par une preuve de connaissance — sinon une
// session volée pourrait changer le mot de passe sans le connaître.

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { traduireErreurAuth } from "@/lib/messages-auth";

// Aligne la borne sur l'inscription (#57 : min 6 imposé par Supabase).
const LONGUEUR_MIN = 6;

export function ChangerMotDePasse() {
  const supabase = createClient();
  const [actuel, setActuel] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);

  async function soumettre(evenement: React.FormEvent): Promise<void> {
    evenement.preventDefault();
    setErreur(null);

    if (nouveau.length < LONGUEUR_MIN) {
      setErreur(`Le nouveau mot de passe doit faire au moins ${LONGUEUR_MIN} caractères.`);
      return;
    }
    if (nouveau !== confirmation) {
      setErreur("La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }

    setEnregistrement(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) {
        setErreur("Session expirée. Reconnecte-toi pour changer ton mot de passe.");
        return;
      }

      // 1) Preuve de connaissance du mot de passe actuel.
      const { error: erreurAuth } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: actuel,
      });
      if (erreurAuth) {
        setErreur("Mot de passe actuel incorrect.");
        return;
      }

      // 2) Mise à jour effective.
      const { error: erreurMaj } = await supabase.auth.updateUser({
        password: nouveau,
      });
      if (erreurMaj) {
        setErreur(traduireErreurAuth(erreurMaj));
        return;
      }

      setActuel("");
      setNouveau("");
      setConfirmation("");
      toast.success("Mot de passe mis à jour");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Modification impossible.");
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <section className="mb-8" aria-labelledby="section-securite">
      <h2
        id="section-securite"
        className="mb-4 text-lg font-semibold text-brand-900"
      >
        Sécurité
      </h2>
      <form onSubmit={soumettre} className="flex max-w-sm flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="mdp-actuel" className="text-sm font-medium text-brand-900">
            Mot de passe actuel
          </label>
          <input
            id="mdp-actuel"
            type="password"
            autoComplete="current-password"
            value={actuel}
            onChange={(e) => setActuel(e.target.value)}
            required
            className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          />
        </div>

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
            Confirme le nouveau mot de passe
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
          disabled={enregistrement}
          aria-busy={enregistrement}
          className="self-start rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
        >
          {enregistrement ? "Modification…" : "Changer le mot de passe"}
        </button>
      </form>
    </section>
  );
}
