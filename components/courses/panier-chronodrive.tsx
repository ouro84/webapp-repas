"use client";

// Carte « Panier Chronodrive » de /courses (#308, US-53).
//
// - RG-81 : la carte n'existe que si le foyer a un exécuteur, et seulement sur
//   le cycle COURANT (la demande vise toujours le cycle courant : la route
//   POST /api/panier/demande ne lit aucun corps). Sinon, rien n'est rendu.
// - RG-83 : une demande active (`en_attente` / `en_cours`) désactive le
//   bouton, quelle que soit son ancre (une seule demande active par foyer).
// - RG-84 : le compte-rendu affiché est celui de la dernière demande,
//   seulement si elle porte sur le cycle affiché. RG-82 : rien n'est commandé,
//   d'où le rappel sous le résumé.
//
// L'état vit en mémoire du composant (aucun localStorage, aucun store
// partagé). Il est relu toutes les 10 s SEULEMENT pendant une demande active,
// et au retour sur l'onglet (une demande peut venir d'un autre membre ou de
// l'assistant). Une lecture qui échoue garde le dernier état connu et logge
// une seule fois par série d'échecs ; le toast est réservé au clic.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, ShoppingBasket, TriangleAlert } from "lucide-react";
import { ancreParDefaut } from "@/lib/cycles";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import {
  affichagePanier,
  estActive,
  resumeRapport,
  type EtatPanier,
} from "@/lib/panier-affichage";
import { chargerEtatPanier, lancerDemandePanier } from "@/lib/panier-client";
import type { RapportPanier } from "@/lib/panier";

/** Période d'interrogation pendant une demande active. */
const INTERVALLE_INTERROGATION_MS = 10_000;

export function PanierChronodrive({ ancreAffichee }: { ancreAffichee: string }) {
  const idTitre = useId();
  const [etat, setEtat] = useState<EtatPanier | null>(null);
  const [ancreCourante, setAncreCourante] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Garde synchrone du double tap : l'état React n'est relu qu'au rendu suivant.
  const envoiEnVol = useRef(false);
  // Une série d'échecs de lecture ne logge qu'une fois (réseau coupé en magasin).
  const enEchec = useRef(false);

  // Chaîne de promesses plutôt qu'async/await : le setState reste dans un
  // callback, ce que la règle `react-hooks/set-state-in-effect` reconnaît.
  const relire = useCallback(
    (): Promise<void> =>
      chargerEtatPanier().then(
        (nouvelEtat) => {
          enEchec.current = false;
          setEtat(nouvelEtat);
        },
        (err: unknown) => {
          if (!enEchec.current) {
            enEchec.current = true;
            console.error("Lecture de l’état du panier Chronodrive échouée.", err);
          }
        }
      ),
    []
  );

  // Chargement initial, en parallèle : état du panier et jour de courses du
  // foyer (pour savoir si le cycle affiché est le cycle courant).
  useEffect(() => {
    void relire();
    chargerJourCoursesFoyer()
      .catch((err: unknown) => {
        console.error("Lecture du jour de courses échouée.", err);
        return 1;
      })
      .then((jour) => setAncreCourante(ancreParDefaut(new Date(), jour)));
  }, [relire]);

  const avecExecuteur = etat?.executeur === true;
  const actif = estActive(etat?.derniere ?? null);

  // Interrogation seulement pendant une demande active (RG-83).
  useEffect(() => {
    if (!actif) return;
    const id = setInterval(() => void relire(), INTERVALLE_INTERROGATION_MS);
    return () => clearInterval(id);
  }, [actif, relire]);

  // Relecture au retour sur l'onglet, seulement pour un foyer avec exécuteur.
  useEffect(() => {
    if (!avecExecuteur) return;
    const surRetour = () => {
      if (document.visibilityState === "visible") void relire();
    };
    document.addEventListener("visibilitychange", surRetour);
    return () => document.removeEventListener("visibilitychange", surRetour);
  }, [avecExecuteur, relire]);

  async function lancer() {
    if (envoiEnVol.current) return;
    envoiEnVol.current = true;
    setEnvoi(true);
    const resultat = await lancerDemandePanier();
    if (resultat.ok) toast.success("C’est parti : ton panier se remplit.");
    else toast.error(resultat.message);
    // Relire AVANT de réactiver : le bouton passe directement à « Panier en
    // cours… » sans repasser par l'état disponible.
    await relire();
    envoiEnVol.current = false;
    setEnvoi(false);
  }

  if (etat === null || ancreCourante === null) return null;
  const affichage = affichagePanier(etat, ancreAffichee, ancreCourante);
  if (!affichage.visible) return null;

  const occupe = envoi || affichage.actif;
  const rapport = affichage.rapport;

  return (
    <section
      aria-labelledby={idTitre}
      className="mb-6 rounded-lg border border-brand-100 bg-surface p-4 shadow-sm"
    >
      <h2 id={idTitre} className="flex items-center gap-2 text-lg font-bold text-brand-900">
        <ShoppingBasket aria-hidden="true" className="size-5 shrink-0 text-brand-600" />
        Panier Chronodrive
      </h2>

      {/* Pleine largeur sous `sm:` : le libellé ne tient pas sur une ligne à
          320 px. Désactivé : teinte claire plutôt qu'une opacité, car
          « Panier en cours… » reste affiché plusieurs minutes et doit garder
          un contraste ≥ 4.5:1 (brand-700 sur brand-50, clair et sombre). */}
      <button
        type="button"
        onClick={() => void lancer()}
        disabled={occupe}
        className="relative mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-transparent bg-primary px-5 py-2.5 text-center text-sm font-semibold text-white transition after:absolute after:-inset-1 after:content-[''] hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:border-brand-200 disabled:bg-brand-50 disabled:text-brand-700 disabled:hover:bg-brand-50 disabled:active:scale-100 sm:w-auto"
      >
        {occupe && (
          <Loader2 aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
        )}
        {affichage.actif ? "Panier en cours…" : "Constituer mon panier Chronodrive"}
      </button>

      {/* Toujours monté : une région aria-live insérée avec son contenu n'est
          pas annoncée par la plupart des lecteurs d'écran. */}
      <div aria-live="polite" className="text-sm">
        {affichage.actif && affichage.lanceA && (
          <>
            <p className="sr-only">Panier en cours…</p>
            <p className="mt-2 text-brand-700/85">{`Lancé à ${affichage.lanceA}`}</p>
          </>
        )}
        {affichage.echec && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {affichage.echec}
          </p>
        )}
        {rapport && (
          <div className="mt-3">
            <p className="font-semibold text-brand-900">{resumeRapport(rapport)}</p>
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
          <ul className="mt-1 divide-y divide-brand-100">
            {rapport.a_choisir.map((element, i) => (
              <li key={`${element.article}-${i}`} className="py-2">
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
