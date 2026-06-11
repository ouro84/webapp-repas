"use client";

// Page Recettes — gestion des recettes personnelles (#2, PR2).
//
// Liste les recettes visibles (catalogue global en lecture seule + recettes
// personnelles éditables, cf. RLS), avec recherche. Création et édition via un
// formulaire. À l'édition, le planning courant est mis à jour pour refléter
// immédiatement le changement dans la liste de courses (RG-03).

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  chargerRecettesGerees,
  creerRecette,
  modifierRecette,
  supprimerRecette,
  type RecetteGeree,
  type SaisieRecette,
} from "@/lib/recettes";
import { filtrerRecettes } from "@/lib/recherche";
import {
  analyserVivier,
  recettesUtilisees,
  remplacerRecetteDansPlanning,
} from "@/lib/generateur";
import { storePlanning, sauvegarderRemplacementSlot } from "@/lib/stockage";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { BadgeSaison } from "@/components/ui/badge-saison";
import { estDeSaison, LIBELLE_SAISON, SAISONS } from "@/lib/saisons";
import { FormulaireRecette } from "@/components/recettes/formulaire-recette";
import { ConfirmationSuppression } from "@/components/recettes/confirmation-suppression";
import type { Planning, Recette, Saison } from "@/types";

type Vue =
  | { mode: "liste" }
  | { mode: "creation" }
  | { mode: "edition"; recette: Recette }
  | { mode: "duplication"; source: Recette };

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

// Vrai si la recette figure dans le planning courant (garde-fou suppression).
function estDansPlanningCourant(id: string): boolean {
  const brut = storePlanning.lire();
  if (brut === null) return false;
  try {
    return recettesUtilisees(JSON.parse(brut) as Planning).has(id);
  } catch {
    return false;
  }
}

// useSearchParams impose une frontière <Suspense> en Next.js 16 (sinon erreur
// de build) : le contenu est isolé ici, l'export par défaut l'enveloppe.
function ContenuRecettes() {
  const [vue, setVue] = useState<Vue>({ mode: "liste" });
  const [recettes, setRecettes] = useState<RecetteGeree[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [requete, setRequete] = useState("");
  // Filtre « végétariennes seulement » (#86, objectif : filtrer les repas végés).
  const [vegeSeulement, setVegeSeulement] = useState(false);
  // Filtre saison (#23) : "toutes" = pas de filtre ; sinon recettes de saison
  // pour la saison choisie (les recettes toute-saison restent affichées).
  const [saisonFiltre, setSaisonFiltre] = useState<Saison | "toutes">("toutes");
  // Recette en attente de confirmation de suppression (RG-01), ou null.
  const [aSupprimer, setASupprimer] = useState<RecetteGeree | null>(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);

  function recharger(): void {
    chargerRecettesGerees()
      .then(setRecettes)
      .catch((e) => setErreur(e instanceof Error ? e.message : "Chargement impossible."));
  }

  // Deep-link d'édition (US-10) : `/recettes?edition=<id>` ouvre le formulaire
  // depuis la fiche de recette du planning. useSearchParams impose la frontière
  // <Suspense> de l'export par défaut.
  const searchParams = useSearchParams();
  const idEdition = searchParams.get("edition");

  useEffect(() => {
    let actif = true;
    chargerRecettesGerees()
      .then((liste) => {
        if (!actif) return;
        setRecettes(liste);
        // On n'ouvre l'édition que pour une recette éditable (perso) — les
        // globales restent en lecture seule (RLS). setState dans la promesse
        // (pas synchrone au montage) → conforme à react-hooks/set-state-in-effect.
        if (idEdition !== null) {
          const cible = liste.find(
            (r) => r.recette.id === idEdition && r.editable
          );
          if (cible) setVue({ mode: "edition", recette: cible.recette });
        }
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."));
    return () => {
      actif = false;
    };
  }, [idEdition]);

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
      .filter((r) => !vegeSeulement || r.recette.vegetarien === true)
      .filter(
        (r) => saisonFiltre === "toutes" || estDeSaison(r.recette, saisonFiltre)
      )
      .sort((a, b) => a.recette.nom.localeCompare(b.recette.nom, "fr"));
  }, [recettes, requete, vegeSeulement, saisonFiltre]);

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

  async function confirmerSuppression(): Promise<void> {
    if (aSupprimer === null) return;
    setSuppressionEnCours(true);
    try {
      await supprimerRecette(aSupprimer.recette.id);
      toast.success("Recette supprimée");
      setASupprimer(null);
      recharger();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suppression impossible.");
    } finally {
      setSuppressionEnCours(false);
    }
  }

  // Pré-remplissage pour la duplication : copie du nom + ingrédients (#2 PR3).
  // Permet aussi de personnaliser une recette du catalogue (globale, en lecture
  // seule) en créant une copie personnelle.
  function valeurDuplication(source: Recette) {
    return {
      nom: `${source.nom} (copie)`,
      tempsPreparation: source.tempsPreparation,
      vegetarien: source.vegetarien ?? false,
      accompagnement: source.accompagnement,
      saisons: source.saisons,
      ingredients: source.ingredients,
    };
  }

  // --- Formulaire (création / édition / duplication) ---
  if (vue.mode === "creation" || vue.mode === "duplication") {
    return (
      <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
        <FormulaireRecette
          titre={vue.mode === "duplication" ? "Dupliquer la recette" : "Nouvelle recette"}
          valeurInitiale={
            vue.mode === "duplication" ? valeurDuplication(vue.source) : undefined
          }
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
        <h1 className="flex-1 font-display text-2xl font-semibold text-brand-900">Mes recettes</h1>
        <button
          type="button"
          onClick={() => setVue({ mode: "creation" })}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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

      {/* Alerte vivier insuffisant (#2 PR3) : anticipe l'échec de génération */}
      {recettes !== null &&
        (() => {
          const vivier = analyserVivier(recettes.map((r) => r.recette));
          return vivier.suffisant ? null : (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {vivier.message}
            </p>
          );
        })()}

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
            className="mb-3 w-full rounded-full border border-brand-200 bg-surface px-4 py-2.5 text-sm text-brand-900 placeholder:text-brand-700/50 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
          />

          {/* Filtres (#86 végé, #23 saison) */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex w-fit items-center gap-2 text-sm text-brand-700">
              <input
                type="checkbox"
                checked={vegeSeulement}
                onChange={(e) => setVegeSeulement(e.target.checked)}
                className="size-4 cursor-pointer accent-brand-600"
              />
              Végétariennes seulement
            </label>
            <label className="flex w-fit items-center gap-2 text-sm text-brand-700">
              De saison&nbsp;:
              <select
                value={saisonFiltre}
                onChange={(e) =>
                  setSaisonFiltre(e.target.value as Saison | "toutes")
                }
                className="cursor-pointer rounded-full border border-brand-200 bg-surface px-3 py-1.5 text-sm text-brand-900 focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
              >
                <option value="toutes">Toutes saisons</option>
                {SAISONS.map((s) => (
                  <option key={s} value={s}>
                    {LIBELLE_SAISON[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {visibles.length === 0 ? (
            <p className="py-8 text-center text-sm text-brand-700/85">
              {requete.trim() === ""
                ? "Aucune recette pour l'instant."
                : `Aucune recette ne correspond à « ${requete.trim()} »`}
            </p>
          ) : (
            <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-surface">
              {visibles.map(({ recette, editable }) => (
                <li
                  key={recette.id}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                >
                  <span className="flex-1 text-sm font-medium text-brand-900">
                    {recette.nom}
                  </span>
                  <BadgeTemps temps={recette.tempsPreparation} />
                  {recette.vegetarien && <BadgeVegetarien />}
                  {recette.accompagnement && (
                    <BadgeAccompagnement accompagnement={recette.accompagnement} />
                  )}
                  {recette.saisons && recette.saisons.length > 0 && (
                    <BadgeSaison saisons={recette.saisons} />
                  )}
                  {!editable && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700/85">
                      Catalogue
                    </span>
                  )}
                  {/* Duplication possible sur toutes les recettes (catalogue compris :
                      c'est le moyen de personnaliser une recette globale) */}
                  <button
                    type="button"
                    onClick={() => setVue({ mode: "duplication", source: recette })}
                    className="rounded-full px-3 py-2 text-sm font-medium text-brand-700 underline-offset-2 transition-colors hover:bg-brand-50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    Dupliquer
                  </button>
                  {editable && (
                    <>
                      <button
                        type="button"
                        onClick={() => setVue({ mode: "edition", recette })}
                        className="rounded-full px-3 py-2 text-sm font-medium text-brand-700 underline-offset-2 transition-colors hover:bg-brand-50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => setASupprimer({ recette, editable })}
                        className="rounded-full px-3 py-2 text-sm font-medium text-red-700 underline-offset-2 transition-colors hover:bg-red-50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                      >
                        Supprimer
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Confirmation de suppression (RG-01) + garde-fou planning (#2 PR3) */}
      {aSupprimer !== null && (
        <ConfirmationSuppression
          nom={aSupprimer.recette.nom}
          dansPlanning={estDansPlanningCourant(aSupprimer.recette.id)}
          enCours={suppressionEnCours}
          onConfirmer={confirmerSuppression}
          onAnnuler={() => setASupprimer(null)}
        />
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

export default function PageRecettes() {
  // Frontière Suspense exigée par useSearchParams (ContenuRecettes). Le repli
  // reprend l'état de chargement de la liste (RG-09).
  return (
    <Suspense
      fallback={
        <main id="contenu" className="mx-auto w-full max-w-2xl flex-1 p-4 md:p-8">
          <p role="status" className="animate-pulse text-brand-700/85">
            Chargement…
          </p>
        </main>
      }
    >
      <ContenuRecettes />
    </Suspense>
  );
}
