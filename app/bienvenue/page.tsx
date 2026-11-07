"use client";

// Tunnel d'onboarding (#22 PR2, US-23, #386) — affiché aux nouveaux inscrits tant
// que profiles.onboarding_complete est faux (le proxy y redirige). Trois écrans :
//   1. Calibration : prénom + nombre de personnes + foyer végétarien + déjeuner
//      de semaine (→ profiles + reglages, cf. reglagesInitiaux). La couleur
//      d'avatar est dérivée de l'email (RG-35).
//   2. Foyer : rejoindre un foyer existant par code (fin du tunnel), ou démarrer
//      en solo.
//   3. Solo seulement : jour de courses (RG-90), puis génération du PREMIER CYCLE
//      de courses à partir d'aujourd'hui (RG-91, jours déjà passés retirés).
// Puis : clôture de l'onboarding et redirection vers /planning en vue Cycle
// (l'« aha moment » : on n'arrive jamais sur un planning vide), avec le toast
// « liste prête » si la génération a réussi (?bienvenue=1).
//
// useSync() est monté ici pour que l'écriture du cycle (appliquerGenerationCycle,
// qui vide d'abord les envois en attente) se fasse avec la synchro démarrée.
// La logique pure (réglages, cycle, filtre, URL de fin) vit dans lib/onboarding.ts.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { chargerProfil, marquerOnboardingComplete, sauvegarderProfil } from "@/lib/profil";
import { couleurAvatar } from "@/lib/avatar";
import { chargerReglages, sauvegarderReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { definirJourCoursesFoyer, rejoindreFoyer } from "@/lib/foyer";
import {
  apercuInvitation,
  effacerCodeEnAttente,
  lireCodeEnAttente,
  type ApercuInvitation,
} from "@/lib/invitation";
import { appliquerGenerationCycle, reinitialiserCacheFoyer, useSync } from "@/lib/sync";
import { storeVuePlanning } from "@/lib/stockage";
import { PERSONNES_MAX, PERSONNES_MIN } from "@/lib/personnes";
import { versISO } from "@/lib/dates-iso";
import { parseApiError } from "@/lib/errors";
import {
  JOUR_COURSES_PROPOSE,
  joursAPartirDe,
  midiSemaineDepuisReglages,
  premierCycle,
  reglagesInitiaux,
  urlFinOnboarding,
} from "@/lib/onboarding";
import { Interrupteur } from "@/components/ui/interrupteur";
import { SelecteurJourCourses } from "@/components/ui/selecteur-jour-courses";
import type { SemaineGeneree } from "@/types";

type Etape = "chargement" | "identite" | "foyer" | "courses" | "generation";

export default function PageBienvenue() {
  // Monte la synchro : l'écriture du premier cycle part synchro démarrée (#6).
  useSync();

  const [etape, setEtape] = useState<Etape>("chargement");
  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [personnes, setPersonnes] = useState(REGLAGES_DEFAUT.personnesDefaut);
  const [vege, setVege] = useState(false);
  // Déjeuner de semaine (#386) : désactivé → plafond « aucun » (RG-44).
  const [midiSemaine, setMidiSemaine] = useState(true);
  // Jour de courses du premier cycle (RG-90, écran 3, solo).
  const [jourCourses, setJourCourses] = useState(JOUR_COURSES_PROPOSE);
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  // Deep-link d'acquisition (#22 PR3) : aperçu de l'invitation en attente
  // (null = aucune / pas encore vérifiée). `valide` → écran de confirmation.
  const [apercu, setApercu] = useState<ApercuInvitation | null>(null);
  // Mémo de la dernière génération réussie du premier cycle (#386) : si seul
  // marquerOnboardingComplete a échoué, le réessai avec le même jour de courses
  // va directement au marquage, sans réécrire le jour ni régénérer le cycle.
  const generationMemo = useRef<{ jour: number; ancre: string } | null>(null);

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
      setMidiSemaine(midiSemaineDepuisReglages(reglages));
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

  // Écran 1 validé : enregistre identité (prénom + couleur) et réglages
  // initiaux (reglagesInitiaux, lib/onboarding.ts), puis passe au choix du foyer.
  async function validerIdentite(): Promise<void> {
    if (prenom.trim().length === 0 || enCours) return;
    setEnCours(true);
    try {
      await sauvegarderProfil({
        prenom: prenom.trim(),
        couleurAvatar: couleurAvatar(email),
      });
      await sauvegarderReglages(reglagesInitiaux({ personnes, vege, midiSemaine }));
      setEtape("foyer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnCours(false);
    }
  }

  // Fin de la branche « rejoindre » : le foyer a déjà ses données, rien à
  // générer. Cache local réinitialisé (le foyer a changé, cf. #56 PR3),
  // onboarding marqué terminé, vue Cycle posée en préférence (#386), puis
  // rechargement plein vers /planning (le proxy laisse désormais passer).
  async function finaliserRejoindre(): Promise<void> {
    setEtape("generation");
    try {
      reinitialiserCacheFoyer();
      await marquerOnboardingComplete();
    } catch (e) {
      // Échec du marquage d'onboarding : NE PAS rediriger vers /planning (#167).
      // Le proxy relirait onboarding_complete=false et renverrait ici → boucle
      // de redirections. On revient à l'écran foyer pour réessayer.
      toast.error(e instanceof Error ? e.message : "Une erreur est survenue. Réessaie.");
      setEtape("foyer");
      setEnCours(false);
      return;
    }
    storeVuePlanning.ecrire("cycle");
    window.location.assign(urlFinOnboarding({ solo: false, generationReussie: false }));
  }

  async function rejoindre(): Promise<void> {
    const valeur = code.trim();
    if (!valeur || enCours) return;
    setEnCours(true);
    try {
      await rejoindreFoyer(valeur);
      effacerCodeEnAttente(); // code consommé (deep-link ou saisie manuelle)
      await finaliserRejoindre();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de rejoindre ce foyer.");
      setEnCours(false);
    }
  }

  // Écran 3 validé (solo, #386) : jour de courses (RG-90), premier cycle à
  // partir d'aujourd'hui (RG-91), clôture de l'onboarding, puis /planning en
  // vue Cycle.
  async function demarrerSolo(): Promise<void> {
    if (enCours) return;
    // Bouton désactivé et écran d'attente AVANT tout await : un double clic ne
    // lance qu'une génération.
    setEnCours(true);
    setEtape("generation");

    let generationReussie = false;
    if (generationMemo.current?.jour === jourCourses) {
      // Réessai après un échec du seul marquage : jour et cycle déjà écrits.
      generationReussie = true;
    } else {
      // Jour changé (« Retour ») ou première tentative : séquence complète.
      generationMemo.current = null;
      try {
        await definirJourCoursesFoyer(jourCourses);
      } catch (erreur) {
        console.error(erreur);
        toast.error("Impossible d’enregistrer ton jour de courses. Réessaie.");
        setEtape("courses");
        setEnCours(false);
        return;
      }

      // Premier cycle : date LOCALE du navigateur, comme hydraterCycle de /courses.
      // Les jours du cycle par défaut déjà passés ne sont pas écrits.
      try {
        const aujourdhui = new Date();
        const { ancre, longueur } = premierCycle(aujourdhui, jourCourses);
        const reponse = await fetch("/api/planning/generer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ancre, longueur }),
        });
        if (!reponse.ok) throw new Error(await parseApiError(reponse));
        const { semaines } = (await reponse.json()) as { semaines: SemaineGeneree[] };
        await appliquerGenerationCycle(ancre, joursAPartirDe(semaines, versISO(aujourdhui)));
        generationMemo.current = { jour: jourCourses, ancre };
        generationReussie = true;
      } catch (e) {
        // On ne piège pas l'utilisateur dans le tunnel : l'onboarding se termine
        // quand même (il pourra générer depuis /planning), sans toast « liste
        // prête » à l'arrivée.
        console.error("Génération du premier cycle impossible.", e);
      }
    }

    try {
      await marquerOnboardingComplete();
    } catch (e) {
      // Même garde que la branche « rejoindre » (#167) : pas de redirection tant
      // que onboarding_complete n'est pas vrai ; retour à l'écran 3 (le réessai
      // réutilise generationMemo si le jour n'a pas changé).
      toast.error(e instanceof Error ? e.message : "Une erreur est survenue. Réessaie.");
      setEtape("courses");
      setEnCours(false);
      return;
    }
    storeVuePlanning.ecrire("cycle");
    window.location.assign(urlFinOnboarding({ solo: true, generationReussie }));
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

      {(etape === "identite" || etape === "foyer" || etape === "courses") && (
        <BarreProgression etape={etape === "identite" ? 1 : etape === "foyer" ? 2 : 3} />
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
            Quelques questions pour calibrer ton premier planning.
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
          <p className="mb-2 text-xs text-brand-700/85">
            Sert de base aux portions de tes recettes.
          </p>
          <Stepper valeur={personnes} onChange={setPersonnes} />

          <div className="mb-8 mt-6 flex flex-col gap-5">
            <LigneInterrupteur
              titre="Foyer végétarien"
              description="Privilégie les recettes végé en semaine (ajustable ensuite)."
              actif={vege}
              onChange={setVege}
            />
            <LigneInterrupteur
              titre="On mange à la maison le midi en semaine"
              description="Désactivé, pas de déjeuner prévu du lundi au vendredi (ajustable dans les réglages)."
              actif={midiSemaine}
              onChange={setMidiSemaine}
            />
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
            onClick={() => setEtape("courses")}
            disabled={enCours}
            className="w-full rounded-full border border-brand-200 px-6 py-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50"
          >
            Démarrer seul·e
          </button>
        </section>
      )}

      {etape === "courses" && (
        <section aria-labelledby="titre-courses">
          <h1
            id="titre-courses"
            className="mb-2 font-display text-2xl font-semibold text-brand-900"
          >
            Tu fais tes courses quel jour&nbsp;?
          </h1>
          <p className="mb-6 text-sm text-brand-700/85">
            Ta liste couvrira 7 jours à partir de ce jour-là. Tu pourras le changer dans ton profil.
          </p>

          <div className="mb-8">
            <SelecteurJourCourses
              valeur={jourCourses}
              onChange={setJourCourses}
              desactive={enCours}
            />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void demarrerSolo()}
              disabled={enCours}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Générer mon planning
            </button>
            {/* Retour à l'écran 2 (#386) : le jour de courses choisi est conservé. */}
            <button
              type="button"
              onClick={() => setEtape("foyer")}
              disabled={enCours}
              className="w-full rounded-full border border-brand-200 px-6 py-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50"
            >
              Retour
            </button>
          </div>
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

function BarreProgression({ etape }: { etape: 1 | 2 | 3 }) {
  return (
    <div className="mb-8">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-700/85">
        Étape {etape} sur 3
      </p>
      <div className="flex gap-2" aria-hidden="true">
        {([1, 2, 3] as const).map((rang) => (
          <span
            key={rang}
            className={`h-1.5 flex-1 rounded-full ${rang <= etape ? "bg-primary" : "bg-brand-100"}`}
          />
        ))}
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

// Ligne « intitulé + description + interrupteur » de l'écran 1 (végé, midis).
function LigneInterrupteur({
  titre,
  description,
  actif,
  onChange,
}: {
  titre: string;
  description: string;
  actif: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="text-sm font-medium text-brand-900">
        {titre}
        <span className="block text-xs font-normal text-brand-700/85">{description}</span>
      </span>
      <Interrupteur actif={actif} onChange={onChange} label={titre} />
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
