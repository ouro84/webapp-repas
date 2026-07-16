"use client";

// Vue « Prochain repas » (#280) — pour qui cuisine sans avoir suivi la
// planification : LE prochain repas actif, en lecture seule. Charge les
// plannings de la semaine courante + suivante (même fenêtre que
// VuePlanningCycle) et délègue le calcul à lib/prochain-repas.ts.
//
// États d'interface (RG-09) : chargement, rien de prévu, restes, recette
// (via FicheRecette, montée directement — pas besoin de cliquer sur un nom de
// plat comme sur /planning, la page EST la fiche).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { chargerPlanningDistant } from "@/lib/persistance";
import { chargerRecettesGerees, type RecetteGeree } from "@/lib/recettes";
import { prochainRepasActif, libelleContexteRepas, type ProchainRepas } from "@/lib/prochain-repas";
import { semaineISO, semaineDecalee } from "@/lib/semaines";
import { FicheRecette } from "@/components/planning/fiche-recette";
import type { Planning, ReglagesGeneration } from "@/types";

export default function PageCeSoir() {
  const router = useRouter();
  const [chargement, setChargement] = useState(true);
  const [reglages, setReglages] = useState<ReglagesGeneration>(REGLAGES_DEFAUT);
  const [planningsParSemaine, setPlanningsParSemaine] = useState<Map<string, Planning>>(
    new Map()
  );
  const [recettesGerees, setRecettesGerees] = useState<RecetteGeree[]>([]);
  const [ficheFermee, setFicheFermee] = useState(false);

  useEffect(() => {
    let actif = true;
    const maintenant = new Date();
    const semaines = [semaineISO(maintenant), semaineDecalee(semaineISO(maintenant), 1)];
    Promise.all([
      chargerReglages().catch((erreur) => {
        console.error("Chargement des réglages échoué (défauts appliqués).", erreur);
        return REGLAGES_DEFAUT;
      }),
      Promise.all(semaines.map((s) => chargerPlanningDistant(s).catch(() => null))),
      chargerRecettesGerees().catch((erreur) => {
        console.error("Chargement des recettes échoué.", erreur);
        return [] as RecetteGeree[];
      }),
    ]).then(([reglagesCharges, resultatsPlannings, recettes]) => {
      if (!actif) return;
      const map = new Map<string, Planning>();
      semaines.forEach((s, i) => {
        const resultat = resultatsPlannings[i];
        if (resultat) map.set(s, resultat.planning);
      });
      setReglages(reglagesCharges);
      setPlanningsParSemaine(map);
      setRecettesGerees(recettes);
      setChargement(false);
    });
    return () => {
      actif = false;
    };
  }, []);

  const idsModifiables = useMemo(
    () => new Set(recettesGerees.map((r) => r.recette.id)),
    [recettesGerees]
  );

  const prochain = useMemo<ProchainRepas | null | undefined>(() => {
    if (chargement) return undefined; // pas encore calculable
    return prochainRepasActif(new Date(), planningsParSemaine, reglages);
  }, [chargement, planningsParSemaine, reglages]);

  if (chargement || prochain === undefined) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
        <p role="status" className="animate-pulse text-lg text-brand-700/85">
          Chargement…
        </p>
      </main>
    );
  }

  if (prochain === null || !prochain.recette) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-brand-900">Ce soir</h1>
        <p className="text-brand-700/85">Rien de prévu pour ce repas.</p>
      </main>
    );
  }

  if (prochain.restes) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-brand-900">
          {libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())}
        </h1>
        <p className="text-brand-700/85">Restes de {prochain.recette.nom}</p>
      </main>
    );
  }

  if (ficheFermee) {
    // Lecture seule (D5) : rien à éditer une fois la fiche fermée. On propose
    // simplement de rejoindre le planning complet plutôt que de laisser un
    // écran vide sans issue.
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-brand-700/85">
          {libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())} —{" "}
          {prochain.recette.nom}
        </p>
        <button
          type="button"
          onClick={() => router.push("/planning")}
          className="rounded-full bg-primary px-6 py-3 font-medium text-white transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          Voir tout le planning
        </button>
      </main>
    );
  }

  return (
    <>
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center p-8">
        <p className="mb-2 text-sm font-medium text-brand-700/85">
          {libelleContexteRepas(prochain.dateISO, prochain.typeRepas, new Date())}
        </p>
      </main>
      <FicheRecette
        recette={prochain.recette}
        personnes={prochain.personnes}
        modifiable={idsModifiables.has(prochain.recette.id)}
        onFermer={() => setFicheFermee(true)}
      />
    </>
  );
}
