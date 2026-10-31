"use client";

// Carte « Panier Chronodrive » de /courses (#308, US-53).
//
// - RG-81 : la carte n'existe que si le foyer a un exécuteur. Le BOUTON n'existe
//   que sur le cycle COURANT (la demande vise toujours le cycle courant : la
//   route POST /api/panier/demande ne lit aucun corps). Sur un autre cycle, la
//   carte est en lecture seule si une demande le concerne, absente sinon.
// - RG-83 : une demande active (`en_attente` / `en_cours`) désactive le
//   bouton, quelle que soit son ancre (une seule demande active par foyer).
//   Après un compte-rendu, le bouton devient secondaire : « Relancer pour les
//   articles restants » (les articles ajoutés ont été cochés).
// - RG-84 : le compte-rendu affiché est celui de la dernière demande,
//   seulement si elle porte sur le cycle affiché. RG-82 : rien n'est commandé,
//   d'où le rappel sous le résumé.
//
// L'état vit en mémoire du composant (aucun localStorage, aucun store
// partagé). Il est relu toutes les 10 s SEULEMENT pendant une demande active
// et tant que l'onglet est visible, plus au retour sur l'onglet (une demande
// peut venir d'un autre membre ou de l'assistant). Une lecture qui échoue
// garde le dernier état connu et logge une seule fois par série d'échecs ; le
// toast est réservé au clic.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, ShoppingBasket, TriangleAlert } from "lucide-react";
import { ancreParDefaut } from "@/lib/cycles";
import { aujourdhuiParis } from "@/lib/semaines";
import { affichagePanier, resumeRapport, type EtatPanier } from "@/lib/panier-affichage";
import {
  chargerEtatPanier,
  chargerJourCoursesPanier,
  lancerDemandePanier,
} from "@/lib/panier-client";
import type { RapportPanier } from "@/lib/panier";

/** Période d'interrogation pendant une demande active. */
const INTERVALLE_INTERROGATION_MS = 10_000;

// Pilule plus étroite et texte à 13 px sous `sm:` : à 320 px, le libellé le
// plus long (208 px) tient sur une ligne, spinner compris (+20 px), avec
// 4 px de marge ; vérifié par le test de captures (`panier-demande.spec`).
const BOUTON_BASE =
  "relative mt-3 inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-2.5 text-center text-[13px] font-semibold transition after:absolute after:-inset-1 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:w-auto sm:gap-2 sm:px-5 sm:text-sm";
const BOUTON_PRINCIPAL =
  "border-transparent bg-primary text-white hover:bg-primary-hover active:scale-[0.97] motion-reduce:active:scale-100";
// Ghost du DESIGN : après un compte-rendu, relancer n'est plus l'action principale.
const BOUTON_SECONDAIRE =
  "border-brand-200 bg-surface text-brand-700 hover:bg-brand-50 active:scale-[0.97] motion-reduce:active:scale-100";
// Désactivé : teinte claire plutôt qu'une opacité, car « Panier en cours… »
// reste affiché plusieurs minutes et doit garder un contraste ≥ 4.5:1
// (brand-700 sur brand-50, clair et sombre).
const BOUTON_DESACTIVE = "cursor-not-allowed border-brand-200 bg-brand-50 text-brand-700";

export function PanierChronodrive({ ancreAffichee }: { ancreAffichee: string }) {
  const idTitre = useId();
  const [etat, setEtat] = useState<EtatPanier | null>(null);
  const [ancreCourante, setAncreCourante] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Incrémenté à chaque changement de visibilité de l'onglet : relance (ou
  // coupe) la chaîne d'interrogation.
  const [reprise, setReprise] = useState(0);
  // Garde synchrone du double tap : l'état React n'est relu qu'au rendu suivant.
  const envoiEnVol = useRef(false);
  // Une série d'échecs de lecture ne logge qu'une fois (réseau coupé en magasin).
  const enEchec = useRef(false);
  // Numéro de la dernière lecture lancée : un résultat plus ancien est ignoré
  // (une lecture lente ne doit pas écraser une plus récente).
  const numeroLecture = useRef(0);
  const jourCourses = useRef<number | null>(null);

  // Chaîne de promesses plutôt qu'async/await : le setState reste dans un
  // callback, ce que la règle `react-hooks/set-state-in-effect` reconnaît.
  // Résout `false` si la lecture a échoué.
  const relire = useCallback((): Promise<boolean> => {
    const numero = ++numeroLecture.current;
    return chargerEtatPanier().then(
      (nouvelEtat) => {
        if (numero !== numeroLecture.current) return true;
        enEchec.current = false;
        setEtat(nouvelEtat);
        return true;
      },
      (err: unknown) => {
        if (numero !== numeroLecture.current) return true;
        if (!enEchec.current) {
          enEchec.current = true;
          console.error("Lecture de l’état du panier Chronodrive échouée.", err);
        }
        return false;
      }
    );
  }, []);

  // Jour de courses lu SANS repli (jumeau de la route) ; ancre calculée à
  // l'heure de Paris, comme la route. Une erreur : log, carte non rendue.
  const chargerJour = useCallback(
    (): Promise<void> =>
      chargerJourCoursesPanier().then(
        (jour) => {
          jourCourses.current = jour;
          setAncreCourante(ancreParDefaut(aujourdhuiParis(), jour));
        },
        (err: unknown) => {
          console.error("Lecture du jour de courses échouée.", err);
        }
      ),
    []
  );

  // Chargement initial, en parallèle : état du panier et jour de courses du
  // foyer (pour savoir si le cycle affiché est le cycle courant).
  useEffect(() => {
    void relire();
    void chargerJour();
  }, [relire, chargerJour]);

  const affichage =
    etat !== null && ancreCourante !== null
      ? affichagePanier(etat, ancreAffichee, ancreCourante)
      : null;
  const interroger = affichage?.visible === true && affichage.actif;

  // Interrogation seulement pendant une demande active, carte et onglet
  // visibles (RG-83). Chaîne de `setTimeout` réarmée après chaque lecture
  // terminée : deux lectures ne se chevauchent pas sur un réseau lent.
  useEffect(() => {
    if (!interroger || document.visibilityState !== "visible") return;
    let annule = false;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const planifier = () => {
      minuteur = setTimeout(() => {
        void relire().then(() => {
          if (!annule) planifier();
        });
      }, INTERVALLE_INTERROGATION_MS);
    };
    planifier();
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [interroger, reprise, relire]);

  // Retour sur l'onglet : relecture de l'état (aussi après un premier
  // chargement raté) et recalcul du cycle courant (l'onglet a pu dormir
  // au-delà du jour de courses). Rien à écouter pour un foyer sans exécuteur.
  const ecouter = etat === null || etat.executeur;
  useEffect(() => {
    if (!ecouter) return;
    const surChangement = () => {
      setReprise((n) => n + 1);
      if (document.visibilityState !== "visible") return;
      void relire();
      if (jourCourses.current === null) void chargerJour();
      else setAncreCourante(ancreParDefaut(aujourdhuiParis(), jourCourses.current));
    };
    document.addEventListener("visibilitychange", surChangement);
    return () => document.removeEventListener("visibilitychange", surChangement);
  }, [ecouter, relire, chargerJour]);

  async function lancer() {
    if (envoiEnVol.current) return;
    envoiEnVol.current = true;
    setEnvoi(true);
    try {
      const resultat = await lancerDemandePanier();
      // 502 : l'exécuteur n'a pas répondu, la demande est passée en échec et
      // c'est la carte qui porte le message, pas un toast.
      const injoignable = !resultat.ok && resultat.statut === 502;
      if (resultat.ok) toast.success("C’est parti : ton panier se remplit.");
      else if (!injoignable) toast.error(resultat.message);
      // Relire AVANT de réactiver : le bouton passe directement à « Panier en
      // cours… » sans repasser par l'état disponible.
      const relu = await relire();
      // Sans relecture, la carte ne montrerait pas l'échec : le toast prend le relais.
      if (injoignable && !relu) toast.error(resultat.message);
    } finally {
      envoiEnVol.current = false;
      setEnvoi(false);
    }
  }

  if (affichage === null || !affichage.visible) return null;

  const occupe = envoi || affichage.actif;
  const rapport = affichage.rapport;
  const termineA = affichage.termineA ? `Terminé à ${affichage.termineA}` : null;
  const styleBouton = occupe
    ? BOUTON_DESACTIVE
    : affichage.relance
      ? BOUTON_SECONDAIRE
      : BOUTON_PRINCIPAL;
  const libelleBouton = affichage.actif
    ? "Panier en cours…"
    : affichage.relance
      ? "Relancer pour les articles restants"
      : "Constituer mon panier Chronodrive";

  return (
    <section
      aria-labelledby={idTitre}
      className="mt-6 rounded-lg border border-brand-100 bg-surface p-4 shadow-sm"
    >
      <h2 id={idTitre} className="flex items-center gap-2 text-lg font-bold text-brand-900">
        <ShoppingBasket aria-hidden="true" className="size-5 shrink-0 text-brand-600" />
        Panier Chronodrive
      </h2>

      {/* Pleine largeur sous `sm:`. `aria-disabled` plutôt que `disabled` :
          le bouton garde le focus clavier pendant l'envoi ; le clic est gardé
          dans le gestionnaire. */}
      {affichage.boutonDisponible && (
        <button
          type="button"
          onClick={() => {
            if (!occupe) void lancer();
          }}
          aria-disabled={occupe}
          className={`${BOUTON_BASE} ${styleBouton}`}
        >
          {occupe && (
            <Loader2
              aria-hidden="true"
              className="size-3.5 shrink-0 motion-safe:animate-spin sm:size-4"
            />
          )}
          {libelleBouton}
        </button>
      )}

      {/* Toujours monté : une région aria-live insérée avec son contenu n'est
          pas annoncée par la plupart des lecteurs d'écran. */}
      <div aria-live="polite" className="text-sm">
        {envoi && !affichage.actif && <p className="sr-only">Envoi en cours…</p>}
        {affichage.actif &&
          (affichage.boutonDisponible ? (
            <p className="sr-only">Panier en cours…</p>
          ) : (
            // Lecture seule (autre cycle) : pas de bouton, l'état s'affiche en texte.
            <p className="mt-3 flex items-center gap-2 font-semibold text-brand-900">
              <Loader2 aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
              Panier en cours…
            </p>
          ))}
        {affichage.actif && affichage.lanceA && (
          <p className="mt-2 text-brand-700/85">{`Lancé à ${affichage.lanceA}`}</p>
        )}
        {affichage.echec && (
          <>
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {affichage.echec}
            </p>
            {termineA && <p className="mt-1 text-xs text-brand-700/85">{termineA}</p>}
          </>
        )}
        {rapport && (
          <div className="mt-3">
            <p className="font-semibold text-brand-900">{resumeRapport(rapport)}</p>
            {/* Une seule ligne d'heure : sous l'échec s'il y en a un. */}
            {termineA && !affichage.echec && (
              <p className="text-xs text-brand-700/85">{termineA}</p>
            )}
            {affichage.tardif && (
              <p className="text-xs text-brand-700/85">Compte-rendu arrivé après le délai.</p>
            )}
            <p className="mt-1 text-brand-700/85">
              Rappel : rien n’est commandé. Relis et valide ton panier dans l’appli Chronodrive.
            </p>
          </div>
        )}
      </div>

      {rapport && <DetailRapport rapport={rapport} />}
    </section>
  );
}

/**
 * Détail du compte-rendu (RG-84) : ce qui demande une action d'abord (à
 * choisir, introuvables), dépliés ; les articles ajoutés, repliés. Une
 * section vide n'est pas rendue.
 */
function DetailRapport({ rapport }: { rapport: RapportPanier }) {
  return (
    <div className="mt-4 space-y-4 text-sm">
      {rapport.a_choisir.length > 0 && (
        <div>
          <h3 className="font-semibold text-brand-900">À choisir toi-même</h3>
          {/* `last:pb-0` : l'écart avant la section suivante reste celui de
              `space-y-4`, comme entre les autres sections. */}
          <ul className="mt-1 divide-y divide-brand-100">
            {rapport.a_choisir.map((element, i) => (
              <li key={`${element.article}-${i}`} className="py-2 last:pb-0">
                <p className="font-medium text-brand-900">{element.article}</p>
                <p className="text-brand-700/85">{element.raison}</p>
                {element.candidats.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-brand-700/85">
                    {element.candidats.map((candidat, j) => (
                      <li key={`${candidat}-${j}`}>{candidat}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rapport.introuvables.length > 0 && (
        <div>
          <h3 className="font-semibold text-brand-900">Introuvables</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-brand-900">
            {rapport.introuvables.map((element, i) => (
              <li key={`${element.article}-${i}`}>{element.article}</li>
            ))}
          </ul>
        </div>
      )}

      {rapport.ajoutes.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold text-brand-900 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
            Ajoutés au panier
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-brand-700/85 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul className="list-disc space-y-0.5 pl-5 text-brand-900">
            {rapport.ajoutes.map((element, i) => (
              <li key={`${element.article}-${i}`}>
                {`${element.produit} · ${element.marque} × ${element.quantite}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
