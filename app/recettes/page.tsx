"use client";

// Page Recettes — gestion des recettes personnelles (#2, PR2).
//
// Liste les recettes visibles (catalogue global en lecture seule + recettes
// personnelles éditables, cf. RLS), avec recherche. Création et édition via un
// formulaire. À l'édition, le planning courant est mis à jour pour refléter
// immédiatement le changement dans la liste de courses (RG-03).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  chargerRecettesGerees,
  creerRecette,
  modifierRecette,
  type RecetteGeree,
  type SaisieRecette,
} from "@/lib/recettes";
import { filtrerRecettes } from "@/lib/recherche";
import { remplacerRecetteDansPlanning } from "@/lib/generateur";
import { storePlanning, sauvegarderRemplacementSlot } from "@/lib/stockage";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { FormulaireRecette } from "@/components/recettes/formulaire-recette";
import type { Planning, Recette } from "@/types";

type Vue =
  | { mode: "liste" }
  | { mode: "creation" }
  | { mode: "edition"; recette: Recette };

// Réinjecte une recette éditée dans le planning persisté (RG-03) : la liste
// de courses reflète aussitôt le changement. Sans effet si la recette n'y est pas.
function repercuterSurPlanning(recette: Recette): void {
  const brut = storePlanning.lire();
  if (brut === null) return;
  try {
    const planning = JSON.parse(brut) as Planning;
    const maj = remplacerRecetteDansPlanning(planning, recette);
    if (maj !== null) sauvegarderRemplacementSlot(maj);
  } catch {
    // Planning illisible : rien à répercuter, la prochaine génération l'écrasera.
  }
}

export default function PageRecettes() {
  const [vue, setVue] = useState<Vue>({ mode: "liste" });
  const [recettes, setRecettes] = useState<RecetteGeree[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [requete, setRequete] = useState("");

  function recharger(): void {
    chargerRecettesGerees()
      .then(setRecettes)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Chargement impossible."));
  }

  useEffect(() => {
    let actif = true;
    chargerRecettesGerees()
      .then((liste) => actif && setRecettes(liste))
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."));
    return () => {
      actif = false;
    };
  }, []);

  // Recherche par nom (réutilise le filtrage du sélecteur, #14).
  const visibles = useMemo(() => {
    if (recettes === null) return [];
    const trouves = filtrerRecettes(
      recettes.map((r) => r.recette),
      requete
    );
    const ids = new Set(trouves.map((r) => r.id));
    return recettes
      .filter((r) => ids.has(r.recette.id))
      .sort((a, b) => a.recette.nom.localeCompare(b.recette.nom, "fr"));
  }, [recettes, requete]);

  async function enregistrerCreation(saisie: SaisieRecette): Promise<void> {
    await creerRecette(saisie);
    toast.success("Recette créée");
    setVue({ mode: "liste" });
    recharger();
  }

  async function enregistrerEdition(id: string, saisie: SaisieRecette): Promise<void> {
    const recette = await modifierRecette(id, saisie);
    repercuterSurPlanning(recette); // RG-03
    toast.success("Recette modifiée");
    setVue({ mode: "liste" });
    recharger();
  }

  // --- Formulaire (création / édition) ---
  if (vue.mode === "creation") {
    return (
      <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
        <FormulaireRecette
          titre="Nouvelle recette"
          onEnregistrer={enregistrerCreation}
          onAnnuler={() => setVue({ mode: "liste" })}
        />
      </main>
    );
  }
  if (vue.mode === "edition") {
    return (
      <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
        <FormulaireRecette
          titre="Modifier la recette"
          valeurInitiale={vue.recette}
          onEnregistrer={(saisie) => enregistrerEdition(vue.recette.id, saisie)}
          onAnnuler={() => setVue({ mode: "liste" })}
        />
      </main>
    );
  }

  // --- Liste ---
  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="flex-1 text-2xl font-bold text-brand-900">Mes recettes</h1>
        <button
          type="button"
          onClick={() => setVue({ mode: "creation" })}
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Nouvelle recette
        </button>
      </header>

      {/* État erreur de chargement (RG-09) */}
      {erreur !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {erreur}
        </p>
      )}

      {/* État chargement (RG-09) */}
      {recettes === null && erreur === null && (
        <p role="status" className="animate-pulse text-brand-700/85">
          Chargement…
        </p>
      )}

      {recettes !== null && (
        <>
          <label htmlFor="recherche-recettes" className="sr-only">
            Rechercher une recette
          </label>
          <input
            id="recherche-recettes"
            type="search"
            value={requete}
            onChange={(e) => setRequete(e.target.value)}
            placeholder="Rechercher une recette…"
            className="mb-4 w-full rounded-full border border-brand-200 bg-white px-4 py-2.5 text-sm text-brand-900 placeholder:text-brand-700/50 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          />

          {visibles.length === 0 ? (
            <p className="py-8 text-center text-sm text-brand-700/85">
              {requete.trim() === ""
                ? "Aucune recette pour l'instant."
                : `Aucune recette ne correspond à « ${requete.trim()} »`}
            </p>
          ) : (
            <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-white">
              {visibles.map(({ recette, editable }) => (
                <li
                  key={recette.id}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                >
                  <span className="flex-1 text-sm font-medium text-brand-900">
                    {recette.nom}
                  </span>
                  <BadgeTemps temps={recette.tempsPreparation} />
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => setVue({ mode: "edition", recette })}
                      className="rounded-full px-3 py-2 text-sm font-medium text-brand-700 underline-offset-2 transition-colors hover:bg-brand-50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      Modifier
                    </button>
                  ) : (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700/85">
                      Catalogue
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="mt-6 text-sm text-brand-700/85">
        <Link
          href="/planning"
          className="underline underline-offset-2 transition-colors hover:text-brand-900"
        >
          ← Retour au planning
        </Link>
      </p>
    </main>
  );
}
