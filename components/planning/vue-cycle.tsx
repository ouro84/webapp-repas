"use client";

// Vue planning calée sur le CYCLE de courses (#260, PR3 de l'épopée #257).
//
// Bonus « lecture d'abord » (design §8) : visualiser « ce que j'ai prévu jusqu'à
// quand », aligné sur la fenêtre de la liste de courses (même ancre + longueur).
// La vue est en LECTURE SEULE — l'ÉDITION reste dans la vue Semaine, qui est le
// driver quotidien (« on mange quoi ce soir ? », décision produit D5). Raisons :
//  (1) un cycle non calendaire chevauche 1-2 semaines ISO → éditer un slot d'une
//      semaine qui n'est pas l'« affichée » sortirait du modèle mono-semaine de
//      storePlanning/useSync (persistance + undo + temps réel), pour un bonus ;
//  (2) une éditabilité PARTIELLE (seuls les jours de la semaine affichée) serait
//      un modèle mental incohérent. On garde donc : Semaine = piloter, Cycle =
//      visualiser + aller aux courses. La fiche recette (consultation) reste
//      accessible, et « Générer mon cycle » vit sur /courses (#259).
//
// Projection : on lit les plannings des 1-2 semaines ISO que le cycle touche
// (chargerPlanningDistant, base = source de vérité) et on rend chaque JOUR du
// cycle (date concrète) via lib/cycles (fonctions pures). Aucun store planning
// n'est touché (pas de push) : cette vue ne fait que lire.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ancreParDefaut,
  cycleDecale,
  dateVersSemaineJour,
  joursDuCycle,
  libelleCycle,
  LONGUEUR_DEFAUT,
} from "@/lib/cycles";
import { personnesDuSlot } from "@/lib/personnes";
import { estRestes } from "@/lib/restes";
import { chargerJourCoursesFoyer } from "@/lib/foyer";
import { chargerLongueurCycle, chargerPlanningDistant } from "@/lib/persistance";
import { creneauActif } from "@/lib/generateur";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { BadgeSaison } from "@/components/ui/badge-saison";
import { FicheRecette } from "@/components/planning/fiche-recette";
import type { JourPlanning, Planning, Recette, ReglagesGeneration } from "@/types";

type TypeRepas = "dejeuner" | "diner";

// « jeudi 9 juil. » avec majuscule initiale (les jours du cycle sont des dates
// concrètes, pas des jours de semaine abstraits comme dans la vue semaine).
function libelleJourDate(dateISO: string): string {
  const [a, m, j] = dateISO.split("-").map(Number);
  const d = new Date(a, m - 1, j);
  const s = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Slots d'un jour dans l'ordre d'affichage : déjeuner puis dîner. `recette`
// est absente si le slot n'a jamais été généré (planning antérieur/créneau
// jamais rempli) OU si son créneau est désactivé (« Aucun », #217, RG-44/46)
// — même filtre live que la vue Semaine, appliqué ici par slot (cette vue
// projette des dates de plusieurs semaines, pas un `Planning` unique, donc pas
// de `retirerCreneauxDesactives` direct).
function slotsDuJour(
  jp: JourPlanning,
  reglages: ReglagesGeneration
): { typeRepas: TypeRepas; libelle: string; recette: Recette | undefined }[] {
  return [
    {
      typeRepas: "dejeuner" as const,
      libelle: "Déjeuner",
      recette: creneauActif(jp.jour, "dejeuner", reglages) ? jp.dejeuner : undefined,
    },
    {
      typeRepas: "diner" as const,
      libelle: "Dîner",
      recette: creneauActif(jp.jour, "diner", reglages) ? jp.diner : undefined,
    },
  ];
}

export function VuePlanningCycle({
  idsModifiables,
}: {
  // Ids des recettes du catalogue chargé (#137) : pour ceux-là, la fiche propose
  // « Modifier » (deep-link /recettes?edition). Fourni par la page (déjà chargé).
  idsModifiables: ReadonlySet<string>;
}) {
  const [ancre, setAncre] = useState<string | null>(null);
  const [longueur, setLongueur] = useState<number>(LONGUEUR_DEFAUT);
  // Plannings des semaines ISO touchées, indexés par semaine.
  const [parSemaine, setParSemaine] = useState<Map<string, Planning>>(new Map());
  const [chargement, setChargement] = useState(true);
  const [ficheOuverte, setFicheOuverte] = useState<{
    recette: Recette;
    personnes: number;
  } | null>(null);
  // Réglages (#217) : pilotent le filtre live des créneaux désactivés. Défaut
  // tant que non chargés = comportement antérieur (tout actif).
  const [reglages, setReglages] = useState<ReglagesGeneration>(REGLAGES_DEFAUT);

  useEffect(() => {
    let actif = true;
    chargerReglages()
      .then((r) => {
        if (actif) setReglages(r);
      })
      .catch((erreur) => {
        console.error("Chargement des réglages échoué (défauts appliqués).", erreur);
      });
    return () => {
      actif = false;
    };
  }, []);

  // Charge (ou recharge) le cycle d'ancre donnée : lit les 1-2 semaines touchées.
  const chargerCycle = useCallback(async (ancreCible: string) => {
    setChargement(true);
    try {
      const long = await chargerLongueurCycle(ancreCible).catch(() => LONGUEUR_DEFAUT);
      const semaines = Array.from(
        new Set(
          joursDuCycle(ancreCible, long).map((d) => dateVersSemaineJour(d).semaine)
        )
      );
      const resultats = await Promise.all(
        semaines.map((s) => chargerPlanningDistant(s).catch(() => null))
      );
      const map = new Map<string, Planning>();
      semaines.forEach((s, i) => {
        const r = resultats[i];
        if (r) map.set(s, r.planning);
      });
      setLongueur(long);
      setParSemaine(map);
      setAncre(ancreCible);
    } finally {
      setChargement(false);
    }
  }, []);

  // Montage : ancre par défaut dérivée du jour de courses du foyer (même règle
  // que /courses, ancreParDefaut → décalage week-end inclus).
  useEffect(() => {
    let actif = true;
    chargerJourCoursesFoyer()
      .catch(() => 1)
      .then((jour) => {
        if (actif) void chargerCycle(ancreParDefaut(new Date(), jour));
      });
    return () => {
      actif = false;
    };
  }, [chargerCycle]);

  if (chargement || ancre === null) {
    return (
      <p role="status" className="animate-pulse py-12 text-center text-brand-700/85">
        Chargement…
      </p>
    );
  }

  const jours = joursDuCycle(ancre, longueur);
  // Chaque date → le JourPlanning correspondant (ou null si non planifié).
  const cellules = jours.map((dateISO) => {
    const { semaine, jour } = dateVersSemaineJour(dateISO);
    const jp = parSemaine.get(semaine)?.jours.find((j) => j.jour === jour) ?? null;
    return { dateISO, jp };
  });
  const aDesRepas = cellules.some((c) => c.jp !== null);

  return (
    <div>
      {/* Navigateur de cycle (miroir de /courses) + libellé de la fenêtre. */}
      <div className="mb-6 flex items-center gap-2">
        <button
          type="button"
          aria-label="Cycle précédent"
          onClick={() => void chargerCycle(cycleDecale(ancre, -1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span
          aria-live="polite"
          className="min-w-[12rem] text-center text-sm font-medium text-brand-900"
        >
          {libelleCycle(ancre, longueur)}
        </span>
        <button
          type="button"
          aria-label="Cycle suivant"
          onClick={() => void chargerCycle(cycleDecale(ancre, 1))}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>

      {!aDesRepas ? (
        <p className="py-12 text-center text-brand-700/85">
          Aucun repas planifié sur ce cycle.
        </p>
      ) : (
        <ul className="space-y-4">
          {cellules.map(({ dateISO, jp }) => (
            <li
              key={dateISO}
              className="rounded-lg border border-brand-100 bg-surface p-4"
            >
              <h2 className="mb-3 font-semibold text-brand-900">
                {libelleJourDate(dateISO)}
              </h2>
              {jp === null ? (
                <p className="text-sm text-brand-700/70">Rien de prévu.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {slotsDuJour(jp, reglages).map((slot) => (
                    <CarteLecture
                      key={slot.typeRepas}
                      libelle={slot.libelle}
                      recette={slot.recette}
                      personnes={personnesDuSlot(jp, slot.typeRepas)}
                      restes={estRestes(jp, slot.typeRepas)}
                      onVoir={() =>
                        slot.recette &&
                        setFicheOuverte({
                          recette: slot.recette,
                          personnes: personnesDuSlot(jp, slot.typeRepas),
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Fiche recette (US-10) — consultation depuis la vue cycle aussi. */}
      {ficheOuverte && (
        <FicheRecette
          recette={ficheOuverte.recette}
          personnes={ficheOuverte.personnes}
          modifiable={idsModifiables.has(ficheOuverte.recette.id)}
          onFermer={() => setFicheOuverte(null)}
        />
      )}
    </div>
  );
}

// Carte de repas en LECTURE SEULE : nom (→ fiche), badges, personnes et « restes »
// affichés sans contrôle d'édition (cf. entête du fichier : édition = vue semaine).
function CarteLecture({
  libelle,
  recette,
  personnes,
  restes,
  onVoir,
}: {
  libelle: string;
  recette: Recette | undefined;
  personnes: number;
  restes: boolean;
  onVoir: () => void;
}) {
  // Créneau désactivé (« Aucun », #217, RG-44/46) : emplacement conservé, état
  // vide sobre — même traitement que la vue Semaine (SlotRepas).
  if (!recette) {
    return (
      <div className="rounded-lg border border-dashed border-brand-100 bg-brand-50/30 p-3 text-center shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
          {libelle}
        </p>
        <p className="mt-2 text-sm text-brand-700/70">Pas de repas prévu</p>
      </div>
    );
  }
  if (restes) {
    return (
      <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/50 p-3 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
          {libelle}
        </p>
        <p className="mt-1 text-sm font-medium text-brand-700/80">Restes</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-brand-100 bg-surface p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
        {libelle}
      </p>
      <button
        type="button"
        onClick={onVoir}
        aria-label={`Voir la recette : ${recette.nom}`}
        className="mt-1 block w-full text-left text-sm font-medium text-brand-900 underline-offset-2 transition-colors hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {recette.nom}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <BadgeTemps temps={recette.tempsPreparation} />
        {recette.vegetarien && <BadgeVegetarien compact />}
        {recette.accompagnement && (
          <BadgeAccompagnement accompagnement={recette.accompagnement} compact />
        )}
        {recette.saisons && recette.saisons.length > 0 && (
          <BadgeSaison saisons={recette.saisons} compact />
        )}
      </div>
      <p className="mt-2 text-xs font-medium text-brand-700/85">{personnes} pers.</p>
    </div>
  );
}
