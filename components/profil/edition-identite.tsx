"use client";

// Édition de l'identité visible (#22 PR1, RG-35) — avatar + prénom + couleur.
// Section de la page /profil.
//
// Lit le profil via le store partagé useProfil() (le même qui pilote l'avatar
// de la nav) → toute écriture s'y reflète sans rechargement. Le prénom suit le
// motif « enregistrement explicite » du projet (bouton actif seulement si
// modifié) ; la couleur, elle, s'enregistre au clic (choix discret parmi huit).

import { useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { PALETTE_AVATAR } from "@/lib/avatar";
import { sauvegarderProfil, useProfil } from "@/lib/profil";

export function EditionIdentite() {
  const profil = useProfil();
  // Brouillon local du prénom (null = pas encore initialisé depuis le profil).
  const [prenomSaisi, setPrenomSaisi] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [couleurEnCours, setCouleurEnCours] = useState<string | null>(null);

  if (profil === null) {
    return (
      <section className="mb-8" aria-labelledby="section-identite">
        <h2
          id="section-identite"
          className="mb-4 text-lg font-semibold text-brand-900"
        >
          Mon identité
        </h2>
        <p role="status" className="animate-pulse text-brand-700/85">
          Chargement…
        </p>
      </section>
    );
  }

  // Le brouillon s'amorce sur la valeur du profil au premier rendu chargé.
  const prenom = prenomSaisi ?? profil.prenom ?? "";
  const prenomModifie = prenom.trim() !== (profil.prenom ?? "").trim();
  const couleurActuelle = profil.couleurAvatar;

  async function enregistrerPrenom(): Promise<void> {
    const valeur = prenom.trim();
    if (!valeur || !prenomModifie) return;
    setEnregistrement(true);
    try {
      await sauvegarderProfil({ prenom: valeur });
      setPrenomSaisi(null); // re-synchronise le brouillon sur le profil à jour
      toast.success("Prénom enregistré");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnregistrement(false);
    }
  }

  async function choisirCouleur(couleur: string): Promise<void> {
    if (couleur === couleurActuelle) return;
    setCouleurEnCours(couleur);
    try {
      await sauvegarderProfil({ couleurAvatar: couleur });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setCouleurEnCours(null);
    }
  }

  return (
    <section className="mb-8" aria-labelledby="section-identite">
      <h2
        id="section-identite"
        className="mb-4 text-lg font-semibold text-brand-900"
      >
        Mon identité
      </h2>

      <div className="flex items-center gap-4">
        <Avatar prenom={profil.prenom} couleur={couleurActuelle} taille="lg" />
        <div className="flex-1">
          <label
            htmlFor="prenom"
            className="mb-1 block text-sm font-medium text-brand-900"
          >
            Prénom
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="prenom"
              type="text"
              autoComplete="given-name"
              maxLength={50}
              value={prenom}
              onChange={(e) => setPrenomSaisi(e.target.value)}
              placeholder="Ton prénom"
              className="flex-1 rounded-full border border-brand-200 bg-surface px-4 py-2.5 text-brand-900 placeholder:text-brand-700/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            />
            <button
              type="button"
              onClick={enregistrerPrenom}
              disabled={!prenomModifie || prenom.trim().length === 0 || enregistrement}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enregistrement ? "…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>

      {/* Choix de la couleur d'avatar (RG-35) — palette fixe, pas de saisie
          libre. Enregistrement au clic. */}
      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium text-brand-900">
          Couleur de l’avatar
        </legend>
        <div className="flex flex-wrap gap-2">
          {PALETTE_AVATAR.map((couleur) => {
            const actif = couleur === couleurActuelle;
            return (
              <button
                key={couleur}
                type="button"
                onClick={() => choisirCouleur(couleur)}
                disabled={couleurEnCours !== null}
                aria-pressed={actif}
                aria-label={`Couleur ${couleur}`}
                className={`size-9 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100 disabled:opacity-50 ${
                  actif ? "ring-2 ring-brand-900 ring-offset-2 ring-offset-surface" : ""
                }`}
                style={{ backgroundColor: couleur }}
              />
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
