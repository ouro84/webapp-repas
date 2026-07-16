"use client";

// Suppression de compte (#237, US-31) — droit à l'effacement RGPD. Section
// "Zone dangereuse" de /profil, même patron que ChangerMotDePasse : ré-auth
// par mot de passe + confirmation forte (saisie exacte de "SUPPRIMER"), pas de
// modale. Le mot "SUPPRIMER" est une confirmation UX — le contrôle de
// sécurité réel est la ré-authentification (RG design D6).

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reinitialiserCacheFoyer } from "@/lib/sync";
import { chargerFoyer } from "@/lib/foyer";

const MOT_CONFIRMATION = "SUPPRIMER";

export function SupprimerCompte() {
  const supabase = createClient();
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [suppression, setSuppression] = useState(false);
  // Réassurance contextuelle (audit critique) : même esprit que « Quitter le
  // foyer » (panneau-foyer.tsx) — dire précisément ce qui disparaît plutôt
  // qu'un « irréversible » générique. null = pas encore su (défaut prudent :
  // le message solo, qui décrit le pire cas).
  const [partage, setPartage] = useState<boolean | null>(null);

  useEffect(() => {
    let actif = true;
    chargerFoyer()
      .then((e) => actif && setPartage(e.membres > 1))
      .catch(() => {
        /* best-effort : le message solo (par défaut) reste affiché */
      });
    return () => {
      actif = false;
    };
  }, []);

  const confirmationValide = confirmation === MOT_CONFIRMATION;

  async function soumettre(evenement: React.FormEvent): Promise<void> {
    evenement.preventDefault();
    setErreur(null);
    if (!confirmationValide) return;

    setSuppression(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) {
        setErreur("Session expirée. Reconnecte-toi pour supprimer ton compte.");
        return;
      }

      const { error: erreurAuth } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: motDePasse,
      });
      if (erreurAuth) {
        setErreur("Mot de passe incorrect.");
        return;
      }

      const reponse = await fetch("/api/compte/supprimer", { method: "POST" });
      if (!reponse.ok) {
        const corps = await reponse.json().catch(() => null);
        setErreur(corps?.error ?? "Suppression impossible. Réessaie dans quelques instants.");
        return;
      }

      reinitialiserCacheFoyer();
      await supabase.auth.signOut({ scope: "local" });
      window.location.assign("/compte-supprime");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setSuppression(false);
    }
  }

  return (
    <section aria-labelledby="section-zone-dangereuse">
      <h2 id="section-zone-dangereuse" className="mb-4 text-lg font-semibold text-brand-900">
        Zone dangereuse
      </h2>
      <form onSubmit={soumettre} className="flex max-w-sm flex-col gap-4" noValidate>
        <p className="text-sm text-brand-700/85">
          {partage
            ? "Cette action supprime ton compte et ton profil. Tes recettes restent dans le foyer (les autres membres les conservent), mais ne te seront plus attribuées. Ton planning et ta liste de courses personnels disparaissent. Irréversible."
            : "Cette action supprime définitivement ton compte, ton foyer, tes recettes, ton planning et ta liste de courses. Irréversible."}
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="suppr-mdp" className="text-sm font-medium text-brand-900">
            Mot de passe
          </label>
          <input
            id="suppr-mdp"
            type="password"
            autoComplete="current-password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            required
            className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="suppr-confirmation" className="text-sm font-medium text-brand-900">
            Tape SUPPRIMER pour confirmer
          </label>
          <input
            id="suppr-confirmation"
            type="text"
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
          disabled={!confirmationValide || suppression}
          aria-busy={suppression}
          className="self-start rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {suppression ? "Suppression…" : "Supprimer mon compte"}
        </button>
      </form>
    </section>
  );
}
