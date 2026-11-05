"use client";

// Page « Ce soir » (#280, refonte #336) — pour qui cuisine sans avoir suivi la
// planification : LE prochain repas actif, en lecture seule (D5 du #280),
// affiché dans le flux de la page (plus de <dialog>) et lisible en cuisine :
// nom du plat en display, ingrédients et étapes en grand, ingrédients
// cochables (aide-mémoire personnel, RG-89), écran maintenu allumé (Wake Lock)
// et aperçu du repas suivant.
//
// Charge les plannings de la semaine courante + suivante (même fenêtre que
// VuePlanningCycle) et délègue le calcul à lib/prochain-repas.ts.
//
// États d'interface (RG-09) : chargement, erreur (lecture du planning
// échouée), rien de prévu (avec une issue : générer ou voir le planning),
// restes, recette.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { chargerPlanningDistant } from "@/lib/persistance";
import {
  libelleContexteRepas,
  libelleMomentActuel,
  prochainRepasActif,
  repasActifSuivant,
  semaineDuRepas,
  type ProchainRepas,
} from "@/lib/prochain-repas";
import { cleRepas, useCochesRepas } from "@/lib/coches-repas";
import { lienPlanningSemaine } from "@/lib/lien-semaine";
import { useEcranAllume } from "@/lib/ecran-allume";
import { semaineISO, semaineDecalee } from "@/lib/semaines";
import { BadgesRecette, ContenuRecette } from "@/components/planning/contenu-recette";
import type { Planning, ReglagesGeneration } from "@/types";

type Donnees = {
  reglages: ReglagesGeneration;
  planningsParSemaine: Map<string, Planning>;
};

const CLASSES_BOUTON_PRINCIPAL =
  "inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100";

// min-h-11 : cible tactile de 44 px (audit #336).
const CLASSES_LIEN_PLANNING =
  "inline-flex min-h-11 items-center rounded-full border border-brand-200 px-5 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export default function PageCeSoir() {
  // `undefined` = chargement, `null` = lecture du planning échouée.
  const [donnees, setDonnees] = useState<Donnees | null | undefined>(undefined);
  const [tentative, setTentative] = useState(0);

  useEffect(() => {
    let actif = true;
    const maintenant = new Date();
    const semaines = [semaineISO(maintenant), semaineDecalee(semaineISO(maintenant), 1)];
    Promise.all([
      chargerReglages().catch((erreur) => {
        console.error("Chargement des réglages échoué (défauts appliqués).", erreur);
        return REGLAGES_DEFAUT;
      }),
      Promise.all(semaines.map((s) => chargerPlanningDistant(s))),
    ])
      .then(([reglages, resultatsPlannings]) => {
        if (!actif) return;
        const planningsParSemaine = new Map<string, Planning>();
        semaines.forEach((s, i) => {
          const resultat = resultatsPlannings[i];
          if (resultat) planningsParSemaine.set(s, resultat.planning);
        });
        setDonnees({ reglages, planningsParSemaine });
      })
      .catch((erreur) => {
        // Distinguer « pas de planning » (null → rien de prévu) de « lecture
        // échouée » : sinon une panne réseau se déguise en « Rien de prévu ».
        console.error("Chargement du planning échoué (/ce-soir).", erreur);
        if (actif) setDonnees(null);
      });
    return () => {
      actif = false;
    };
  }, [tentative]);

  const prochain = useMemo<ProchainRepas | null | undefined>(() => {
    if (!donnees) return undefined;
    return prochainRepasActif(new Date(), donnees.planningsParSemaine, donnees.reglages);
  }, [donnees]);

  const suivant = useMemo<ProchainRepas | null>(() => {
    if (!donnees || !prochain) return null;
    return repasActifSuivant(prochain, donnees.planningsParSemaine, donnees.reglages);
  }, [donnees, prochain]);

  // Hooks appelés inconditionnellement (avant les retours anticipés).
  const recetteAffichee = prochain?.recette !== undefined && !prochain.restes;
  const { coches, basculer } = useCochesRepas(
    prochain ? cleRepas(prochain.dateISO, prochain.typeRepas) : ""
  );
  useEcranAllume(recetteAffichee);

  if (donnees === undefined) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
        <p role="status" className="animate-pulse text-lg text-brand-700/85">
          Chargement…
        </p>
      </main>
    );
  }

  if (donnees === null) {
    return (
      <main
        id="contenu"
        className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <p role="alert" className="text-brand-900">
          Impossible de charger le repas. Vérifie ta connexion.
        </p>
        <button
          type="button"
          onClick={() => {
            setDonnees(undefined);
            setTentative((t) => t + 1);
          }}
          className={CLASSES_BOUTON_PRINCIPAL}
        >
          Réessayer
        </button>
      </main>
    );
  }

  const maintenant = new Date();

  // Rien de prévu : aucun créneau actif (filet théorique), ou créneau sans
  // recette. Issue : générer si la semaine du repas n'a aucun planning, voir le
  // planning sinon (le créneau est simplement vide).
  if (!prochain || !prochain.recette) {
    // Le lien vise la semaine du repas : le week-end, /planning ouvrirait
    // sinon la semaine suivante (semaineParDefaut).
    const semaine = prochain ? semaineDuRepas(prochain) : null;
    const aUnPlanning = semaine !== null && donnees.planningsParSemaine.has(semaine);
    return (
      <main
        id="contenu"
        className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-semibold text-brand-900">
            {prochain
              ? libelleContexteRepas(prochain.dateISO, prochain.typeRepas, maintenant)
              : libelleMomentActuel(maintenant)}
          </h1>
          <p className="text-brand-700/85">Rien de prévu pour ce repas.</p>
        </div>
        <Link
          href={semaine ? lienPlanningSemaine(semaine) : "/planning"}
          className={CLASSES_BOUTON_PRINCIPAL}
        >
          {aUnPlanning ? "Voir le planning" : "Générer mon planning"}
        </Link>
      </main>
    );
  }

  const contexte = libelleContexteRepas(prochain.dateISO, prochain.typeRepas, maintenant);

  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:py-10">
      <header>
        <p className="text-base font-medium text-brand-700">{contexte}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-balance text-brand-900 md:text-4xl">
          {prochain.restes ? `Restes de ${prochain.recette.nom}` : prochain.recette.nom}
        </h1>
        {!prochain.restes && (
          <BadgesRecette
            recette={prochain.recette}
            personnes={prochain.personnes}
            variante="cuisine"
          />
        )}
      </header>

      {!prochain.restes && (
        <div className="mt-8">
          <ContenuRecette
            recette={prochain.recette}
            personnes={prochain.personnes}
            variante="cuisine"
            coches={coches}
            onBasculerCoche={basculer}
          />
        </div>
      )}

      <footer className="mt-10 flex flex-col gap-4 border-t border-brand-100 pt-6">
        {suivant?.recette && (
          <p className="text-base text-brand-700/85">
            {/* Espace insécable avant « : » (typographie française). */}
            <span className="font-semibold text-brand-900">{"Ensuite :"}</span>{" "}
            {`${libelleContexteRepas(suivant.dateISO, suivant.typeRepas, maintenant)}, ${
              suivant.restes ? `restes de ${suivant.recette.nom}` : suivant.recette.nom
            }`}
          </p>
        )}
        <div>
          <Link
            href={lienPlanningSemaine(semaineDuRepas(prochain))}
            className={CLASSES_LIEN_PLANNING}
          >
            Voir dans le planning
          </Link>
        </div>
      </footer>
    </main>
  );
}
