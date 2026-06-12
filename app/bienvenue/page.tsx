"use client";

// Tunnel d'onboarding (#22 PR2, US-23) — affiché aux nouveaux inscrits tant que
// profiles.onboarding_complete est faux (le proxy y redirige). Deux écrans :
//   1. Calibration : prénom + nombre de personnes + foyer végétarien (→ profiles
//      + reglages). La couleur d'avatar est dérivée de l'email (RG-35).
//   2. Foyer : rejoindre un foyer existant par code, ou démarrer en solo.
// Puis : génération du PREMIER planning (solo) ou réhydratation du foyer rejoint,
// clôture de l'onboarding, et redirection vers /planning (l'« aha moment » : on
// n'arrive jamais sur un planning vide).
//
// useSync() est monté ici pour que le planning généré (sauvegarderPlanningComplet)
// soit marqué « dirty » et poussé en base — sinon il resterait local (cf. #6).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { chargerProfil, marquerOnboardingComplete, sauvegarderProfil } from "@/lib/profil";
import { couleurAvatar } from "@/lib/avatar";
import { chargerReglages, sauvegarderReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { rejoindreFoyer } from "@/lib/foyer";
import {
  apercuInvitation,
  effacerCodeEnAttente,
  lireCodeEnAttente,
  type ApercuInvitation,
} from "@/lib/invitation";
import { reinitialiserCacheFoyer, useSync } from "@/lib/sync";
import { sauvegarderPlanningComplet } from "@/lib/stockage";
import { PERSONNES_MAX, PERSONNES_MIN } from "@/lib/personnes";
import type { Planning, ReglagesGeneration } from "@/types";

type Etape = "chargement" | "identite" | "foyer" | "generation";

export default function PageBienvenue() {
  // Monte la synchro : le planning généré sera poussé en base (#6).
  useSync();

  const [etape, setEtape] = useState<Etape>("chargement");
  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [personnes, setPersonnes] = useState(REGLAGES_DEFAUT.personnesDefaut);
  const [vege, setVege] = useState(false);
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  // Deep-link d'acquisition (#22 PR3) : aperçu de l'invitation en attente
  // (null = aucune / pas encore vérifiée). `valide` → écran de confirmation.
  const [apercu, setApercu] = useState<ApercuInvitation | null>(null);

  // Pré-remplissage en cas de reprise du tunnel (prénom/personnes déjà saisis à
  // une session précédente interrompue). setState dans la promesse (conforme à
  // set-state-in-effect).
  useEffect(() => {
    let actif = true;
    (async () => {
      const supabase = createClient();
      const [{ data }, profil, reglages] = await Promise.all([
        supabase.auth.getUser(),
        chargerProfil().catch(() => null),
        chargerReglages().catch(() => null),
      ]);
      if (!actif) return;
      setEmail(data.user?.email ?? "");
      if (profil?.prenom) setPrenom(profil.prenom);
      if (reglages) {
        setPersonnes(reglages.personnesDefaut);
        setVege(Boolean(reglages.vegetarienPrefere?.dinerSemaine));
      }
      setEtape("identite");
      // Deep-link : un code d'invitation a pu être capté (sessionStorage) depuis
      // le lien /signup?code=… → on en récupère un aperçu pour l'écran 2.
      const codeEnAttente = lireCodeEnAttente();
      if (codeEnAttente) {
        setCode(codeEnAttente);
        apercuInvitation(codeEnAttente)
          .then((a) => {
            if (!actif) return;
            setApercu(a);
            if (!a.valide) effacerCodeEnAttente(); // expiré/invalide : on oublie
          })
          .catch(() => {});
      }
    })().catch(() => actif && setEtape("identite"));
    return () => {
      actif = false;
    };
  }, []);

  // Réglages dérivés de l'écran 1 : on part des défauts et on surcharge le
  // nombre de personnes et la préférence végé de semaine (le week-end reste au
  // défaut, ajustable plus tard dans /reglages).
  function reglagesSaisis(): ReglagesGeneration {
    return {
      ...REGLAGES_DEFAUT,
      personnesDefaut: personnes,
      ...(vege
        ? {
            vegetarienPrefere: {
              dejeunerSemaine: true,
              dinerSemaine: true,
              dejeunerWeekend: false,
              dinerWeekend: false,
            },
          }
        : {}),
    };
  }

  // Écran 1 validé : enregistre identité (prénom + couleur) et réglages, puis
  // passe au choix du foyer.
  async function validerIdentite(): Promise<void> {
    if (prenom.trim().length === 0 || enCours) return;
    setEnCours(true);
    try {
      await sauvegarderProfil({
        prenom: prenom.trim(),
        couleurAvatar: couleurAvatar(email),
      });
      await sauvegarderReglages(reglagesSaisis());
      setEtape("foyer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnCours(false);
    }
  }

  // Clôture commune : (solo) génère le premier planning et le persiste ;
  // (rejoint) réinitialise le cache du nouveau foyer ; puis marque l'onboarding
  // terminé et bascule sur /planning (rechargement plein → le proxy laisse
  // désormais passer, et /planning hydrate le planning).
  async function finaliser(options: { genererPlanning: boolean }): Promise<void> {
    setEtape("generation");
    try {
      if (options.genererPlanning) {
        const reponse = await fetch("/api/planning/generer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (reponse.ok) {
          const { planning } = (await reponse.json()) as { planning: Planning };
          sauvegarderPlanningComplet(planning);
        }
        // Si la génération échoue, on ne piège pas l'utilisateur dans le tunnel :
        // on termine quand même l'onboarding (il pourra générer depuis /planning).
      } else {
        // Foyer rejoint : le foyer a changé → cache local périmé (cf. #56 PR3).
        reinitialiserCacheFoyer();
      }
      await marquerOnboardingComplete();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      // Rechargement plein : le proxy réévalue l'onboarding (désormais terminé)
      // et /planning réhydrate depuis le cache/la base.
      window.location.assign("/planning");
    }
  }

  async function rejoindre(): Promise<void> {
    const valeur = code.trim();
    if (!valeur || enCours) return;
    setEnCours(true);
    try {
      await rejoindreFoyer(valeur);
      effacerCodeEnAttente(); // code consommé (deep-link ou saisie manuelle)
      await finaliser({ genererPlanning: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de rejoindre ce foyer.");
      setEnCours(false);
    }
  }

  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-1 flex-col justify-center p-6"
    >
      {etape === "chargement" && (
        <p role="status" className="animate-pulse text-center text-brand-700/85">
          Chargement…
        </p>
      )}

      {(etape === "identite" || etape === "foyer") && (
        <BarreProgression etape={etape === "identite" ? 1 : 2} />
      )}

      {etape === "identite" && (
        <section aria-labelledby="titre-identite">
          <h1
            id="titre-identite"
            className="mb-2 font-display text-2xl font-semibold text-brand-900"
          >
            Bienvenue&nbsp;! On fait connaissance&nbsp;?
          </h1>
          <p className="mb-6 text-sm text-brand-700/85">
            Deux questions pour calibrer ton premier planning.
          </p>

          <label htmlFor="prenom" className="mb-1 block text-sm font-medium text-brand-900">
            Comment t’appelles-tu&nbsp;?
          </label>
          <input
            id="prenom"
            type="text"
            autoComplete="given-name"
            maxLength={50}
            value={prenom}
            onChange={(e) => setPrenom(e.target.value)}
            placeholder="Ton prénom"
            className="mb-6 w-full rounded-full border border-brand-200 bg-surface px-4 py-2.5 text-brand-900 placeholder:text-brand-700/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          />

          <p className="mb-1 text-sm font-medium text-brand-900">
            Vous êtes combien à table&nbsp;?
          </p>
          <p className="mb-2 text-xs text-brand-700/70">
            Sert de base aux portions de tes recettes.
          </p>
          <Stepper valeur={personnes} onChange={setPersonnes} />

          <div className="mb-8 mt-6">
            <InterrupteurVege actif={vege} onChange={setVege} />
          </div>

          <button
            type="button"
            onClick={validerIdentite}
            disabled={prenom.trim().length === 0 || enCours}
            className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enCours ? "…" : "Suivant"}
          </button>
        </section>
      )}

      {/* Deep-link valide (#22 PR3, US-23 sc.4) : on a été invité → confirmation
          directe « Vous rejoignez le foyer de X », sans ressaisir le code. */}
      {etape === "foyer" && apercu?.valide && (
        <section aria-labelledby="titre-invite">
          <h1
            id="titre-invite"
            className="mb-2 font-display text-2xl font-semibold text-brand-900"
          >
            Tu as été invité·e&nbsp;!
          </h1>
          <p className="mb-8 text-brand-700/85">
            {apercu.prenom
              ? `Tu rejoins le foyer de ${apercu.prenom}.`
              : "Tu rejoins un foyer existant."}{" "}
            Vous partagerez recettes, planning et liste de courses.
          </p>
          <button
            type="button"
            onClick={() => void rejoindre()}
            disabled={enCours}
            className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50"
          >
            {enCours ? "…" : "C’est parti !"}
          </button>
        </section>
      )}

      {etape === "foyer" && !apercu?.valide && (
        <section aria-labelledby="titre-foyer">
          <h1
            id="titre-foyer"
            className="mb-2 font-display text-2xl font-semibold text-brand-900"
          >
            Tu cuisines avec quelqu’un&nbsp;?
          </h1>
          <p className="mb-6 text-sm text-brand-700/85">
            Rejoins le foyer d’un proche pour tout partager (recettes, planning,
            liste de courses), ou commence seul·e — tu pourras inviter plus tard.
          </p>

          <label htmlFor="code-foyer" className="mb-2 block text-sm font-medium text-brand-900">
            J’ai un code d’invitation
          </label>
          <div className="mb-6 flex flex-col gap-2 sm:flex-row">
            <input
              id="code-foyer"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Code reçu (ex. K7M2PQ9X)"
              className="flex-1 rounded-full border border-brand-200 bg-surface px-4 py-2.5 font-mono tracking-widest text-brand-900 placeholder:font-sans placeholder:tracking-normal placeholder:text-brand-700/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            />
            <button
              type="button"
              onClick={rejoindre}
              disabled={enCours || code.trim().length === 0}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enCours ? "…" : "Rejoindre"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => void finaliser({ genererPlanning: true })}
            disabled={enCours}
            className="w-full rounded-full border border-brand-200 px-6 py-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50"
          >
            Démarrer seul·e
          </button>
        </section>
      )}

      {etape === "generation" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <Spinner />
          <p role="status" className="font-display text-lg font-semibold text-brand-900">
            On prépare ton premier planning…
          </p>
          <p className="text-sm text-brand-700/85">Ça ne prend qu’un instant.</p>
        </div>
      )}
    </main>
  );
}

function BarreProgression({ etape }: { etape: 1 | 2 }) {
  return (
    <div className="mb-8">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-700/70">
        Étape {etape} sur 2
      </p>
      <div className="flex gap-2" aria-hidden="true">
        <span className="h-1.5 flex-1 rounded-full bg-primary" />
        <span
          className={`h-1.5 flex-1 rounded-full ${etape === 2 ? "bg-primary" : "bg-brand-100"}`}
        />
      </div>
    </div>
  );
}

function Stepper({
  valeur,
  onChange,
}: {
  valeur: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-4">
      <button
        type="button"
        aria-label="Moins de personnes"
        onClick={() => onChange(Math.max(PERSONNES_MIN, valeur - 1))}
        disabled={valeur <= PERSONNES_MIN}
        className="flex size-10 items-center justify-center rounded-full border border-brand-200 text-xl text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40"
      >
        −
      </button>
      <span
        aria-live="polite"
        className="min-w-8 text-center text-xl font-semibold text-brand-900"
      >
        {valeur}
      </span>
      <button
        type="button"
        aria-label="Plus de personnes"
        onClick={() => onChange(Math.min(PERSONNES_MAX, valeur + 1))}
        disabled={valeur >= PERSONNES_MAX}
        className="flex size-10 items-center justify-center rounded-full border border-brand-200 text-xl text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function InterrupteurVege({
  actif,
  onChange,
}: {
  actif: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="text-sm font-medium text-brand-900">
        Foyer végétarien
        <span className="block text-xs font-normal text-brand-700/70">
          Privilégie les recettes végé en semaine (ajustable ensuite).
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={actif}
        aria-label="Foyer végétarien"
        onClick={() => onChange(!actif)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
          actif ? "bg-primary" : "bg-brand-200"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-transform ${
            actif ? "translate-x-[1.375rem]" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 animate-spin text-primary" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
