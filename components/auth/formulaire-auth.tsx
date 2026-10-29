"use client";

// Formulaire d'authentification partagé — login et signup (#57, #60).
//
// Mutualise l'UI et l'accessibilité des deux pages, qui ne diffèrent que par
// l'appel Supabase, l'autocomplete du mot de passe, les libellés et le lien
// de pied. Aux couleurs du design system (brand/canvas), avec :
//   - autocomplete email + mot de passe (autofill, gestionnaires de mdp)
//   - toggle afficher/masquer le mot de passe
//   - erreur en role="alert" + retour du focus sur le 1er champ
//   - bouton en chargement : spinner + aria-busy
//
// Navigation pleine page après succès (et non router.push) : le cache du
// router Next peut contenir le résultat préfetché de /planning AVANT connexion
// (= redirection vers /login) et ignorer la session toute neuve. Un vrai
// chargement force le passage par le proxy avec le cookie.

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { cheminDeRetour } from "@/lib/redirection";

export function FormulaireAuth({
  titre,
  autocompletePassword,
  minLengthPassword,
  labelSoumettre,
  labelChargement,
  onSoumettre,
  pied,
  cguRequise = false,
}: {
  titre: string;
  /** "current-password" en connexion, "new-password" à l'inscription. */
  autocompletePassword: "current-password" | "new-password";
  minLengthPassword?: number;
  labelSoumettre: string;
  labelChargement: string;
  /** Soumet les identifiants ; renvoie un message d'erreur, ou null si succès. */
  onSoumettre: (email: string, password: string) => Promise<string | null>;
  pied: React.ReactNode;
  /** Signup uniquement (#235, US-29) : case CGU non pré-cochée, obligatoire —
   *  bloque la soumission (jamais envoyée à onSoumettre) tant qu'elle n'est
   *  pas cochée. Absente en connexion. */
  cguRequise?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
  const [cguAcceptees, setCguAcceptees] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const refEmail = useRef<HTMLInputElement>(null);
  const idErreur = useId();

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    // RG #235 : la case CGU (signup) bloque AVANT tout appel réseau — jamais
    // de compte créé sans acceptation explicite côté client.
    if (cguRequise && !cguAcceptees) {
      setErreur("Tu dois accepter les CGU et la politique de confidentialité pour créer un compte.");
      return;
    }
    setChargement(true);
    setErreur(null);

    const message = await onSoumettre(email, password);

    if (message !== null) {
      setErreur(message);
      setChargement(false);
      // Retour du focus sur le premier champ pour corriger la saisie (a11y).
      refEmail.current?.focus();
      return;
    }
    // Succès : navigation pleine page (cf. en-tête de fichier). Retour sur la
    // demande OAuth en cours si le proxy a posé `?suivant=` (#305, RG-72).
    window.location.assign(
      cheminDeRetour(new URLSearchParams(window.location.search).get("suivant"))
    );
  }

  return (
    <main
      id="contenu"
      className="flex min-h-[80dvh] flex-1 items-center justify-center p-4"
    >
      <div className="w-full max-w-sm">
        <h1 className="mb-6 font-display text-2xl font-semibold text-brand-900">{titre}</h1>

        <form onSubmit={soumettre} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-brand-900">
              Email
            </label>
            <input
              ref={refEmail}
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-invalid={erreur !== null}
              aria-describedby={erreur !== null ? idErreur : undefined}
              className="rounded-lg border border-brand-200 bg-surface px-3 py-2.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="password"
              className="text-sm font-medium text-brand-900"
            >
              Mot de passe
            </label>
            <div className="relative">
              <input
                id="password"
                type={motDePasseVisible ? "text" : "password"}
                autoComplete={autocompletePassword}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={minLengthPassword}
                aria-invalid={erreur !== null}
                aria-describedby={erreur !== null ? idErreur : undefined}
                // pr-12 : réserve la place du bouton œil, qui se superpose à droite
                className="w-full rounded-lg border border-brand-200 bg-surface px-3 py-2.5 pr-12 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
              />
              <button
                type="button"
                onClick={() => setMotDePasseVisible((v) => !v)}
                aria-pressed={motDePasseVisible}
                aria-label={
                  motDePasseVisible
                    ? "Masquer le mot de passe"
                    : "Afficher le mot de passe"
                }
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-brand-700 transition-colors hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <IconeOeil ouvert={motDePasseVisible} />
              </button>
            </div>
          </div>

          {cguRequise && (
            <label className="flex items-start gap-2 text-sm text-brand-900">
              <input
                type="checkbox"
                checked={cguAcceptees}
                onChange={(e) => setCguAcceptees(e.target.checked)}
                required
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand-600"
              />
              <span>
                J&apos;accepte les{" "}
                <Link
                  href="/legal/cgu"
                  target="_blank"
                  className="text-brand-700 underline underline-offset-2 hover:text-brand-900"
                >
                  Conditions générales d&apos;utilisation et la politique de confidentialité
                </Link>
                .
              </span>
            </label>
          )}

          {erreur !== null && (
            // role="alert" : annoncé immédiatement aux lecteurs d'écran
            <p
              id={idErreur}
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
            >
              {erreur}
            </p>
          )}

          <button
            type="submit"
            disabled={chargement}
            aria-busy={chargement}
            className="relative flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60"
          >
            {chargement && <Spinner />}
            {chargement ? labelChargement : labelSoumettre}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-brand-700/85">{pied}</p>
      </div>
    </main>
  );
}

// Lien de pied réutilisable — style cohérent du « S'inscrire » / « Se connecter ».
export function LienPied({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-medium text-brand-700 underline underline-offset-2 transition-colors hover:text-brand-600"
    >
      {children}
    </Link>
  );
}

// Œil ouvert / barré (toggle mot de passe) — SVG inline, pas de glyphe (audit #51).
function IconeOeil({ ouvert }: { ouvert: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {!ouvert && <path d="M3 3l18 18" />}
    </svg>
  );
}

// Spinner du bouton en chargement — SVG animé, masqué aux lecteurs d'écran
// (aria-busy porte déjà l'information sur le bouton).
function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 animate-spin"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
