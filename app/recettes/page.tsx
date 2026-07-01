"use client";

// Page Recettes — gestion des recettes (#2 PR2, #105).
//
// Liste les recettes visibles (catalogue par défaut + recettes personnelles),
// avec recherche. Création et édition via un formulaire.
//
// #105 — UX transparente : l'utilisateur ne voit qu'UN carnet. « Supprimer »
// est uniforme sur toutes les recettes (perso → suppression réelle ; par défaut
// → masquage, le catalogue étant partagé en lecture seule). Récupération par un
// undo transitoire (toast « Annuler », même esprit que l'undo planning US-09),
// pas de confirmation ni de corbeille : passé la fenêtre d'undo, c'est définitif.
// « Modifier » reste pour l'instant réservé aux recettes perso (#105 PR2 le
// rendra uniforme via duplication + masquage).

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  chargerRecettesGerees,
  creerRecette,
  modifierRecette,
  supprimerRecette,
  masquerRecette,
  demasquerRecette,
  recetteVersSaisie,
  type RecetteGeree,
  type SaisieRecette,
} from "@/lib/recettes";
import { filtrerRecettes } from "@/lib/recherche";
import { analyserVivier, remplacerRecetteDansPlanning } from "@/lib/generateur";
import { chargerReglages } from "@/lib/reglages-data";
import { REGLAGES_DEFAUT } from "@/lib/reglages";
import { storePlanning, sauvegarderRemplacementSlot } from "@/lib/stockage";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { BadgeSaison } from "@/components/ui/badge-saison";
import { estDeSaison, LIBELLE_SAISON, SAISONS } from "@/lib/saisons";
import { FormulaireRecette } from "@/components/recettes/formulaire-recette";
import type { Planning, Recette, Saison, ReglagesGeneration } from "@/types";

type Vue =
  | { mode: "liste" }
  | { mode: "creation" }
  | { mode: "edition"; geree: RecetteGeree }
  | { mode: "duplication"; source: Recette };

// Un seul cran d'undo à la fois (id de toast partagé, comme l'undo planning) :
// supprimer une 2ᵉ recette remplace le toast précédent.
const ID_TOAST_SUPPR = "suppression-recette";

// Réinjecte une recette éditée dans le planning persisté (RG-03) : la liste
// de courses reflète aussitôt le changement. Sans effet si la recette n'y est pas.
function repercuterSurPlanning(recette: Recette): void {
  const brut = storePlanning.lire();
  if (brut === null) return;
  try {
    const planning = JSON.parse(brut) as Planning;
    const maj = remplacerRecetteDansPlanning(planning, recette);
    if (maj !== null) sauvegarderRemplacementSlot(maj);
  } catch (erreur) {
    // Planning illisible : rien à répercuter, la prochaine génération l'écrasera.
    // On le trace tout de même (jamais de catch muet, cf. CLAUDE.md / #166).
    console.error("Planning local illisible (répercussion recette).", erreur);
  }
}

// useSearchParams impose une frontière <Suspense> en Next.js 16 (sinon erreur
// de build) : le contenu est isolé ici, l'export par défaut l'enveloppe.
function ContenuRecettes() {
  const [vue, setVue] = useState<Vue>({ mode: "liste" });
  const [recettes, setRecettes] = useState<RecetteGeree[] | null>(null);
  // Réglages de génération (#45) — sert la garde de faisabilité de la
  // suppression (RG-D #105) et l'alerte de vivier, au plus juste de la config.
  const [reglages, setReglages] = useState<ReglagesGeneration>(REGLAGES_DEFAUT);
  const [erreur, setErreur] = useState<string | null>(null);
  const [requete, setRequete] = useState("");
  // Filtre « végétariennes seulement » (#86, objectif : filtrer les repas végés).
  const [vegeSeulement, setVegeSeulement] = useState(false);
  // Filtre saison (#23) : "toutes" = pas de filtre ; sinon recettes de saison
  // pour la saison choisie (les recettes toute-saison restent affichées).
  const [saisonFiltre, setSaisonFiltre] = useState<Saison | "toutes">("toutes");

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
        // Deep-link d'édition (US-10) : on ouvre le formulaire pour la recette
        // ciblée, perso OU par défaut (#105 PR2 : « Modifier » est uniforme —
        // une recette par défaut sera dupliquée + masquée à l'enregistrement).
        // setState dans la promesse (pas synchrone au montage) → conforme à
        // react-hooks/set-state-in-effect.
        if (idEdition !== null) {
          const cible = liste.find((r) => r.recette.id === idEdition);
          if (cible) setVue({ mode: "edition", geree: cible });
        }
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."));
    // Réglages : best-effort (défauts en cas d'échec, jamais bloquant).
    chargerReglages()
      .then((r) => actif && setReglages(r))
      .catch(() => {
        /* défauts conservés */
      });
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

  async function enregistrerEdition(
    geree: RecetteGeree,
    saisie: SaisieRecette
  ): Promise<void> {
    if (geree.editable) {
      const recette = await modifierRecette(geree.recette.id, saisie);
      repercuterSurPlanning(recette); // RG-03
    } else {
      // Recette par défaut (#105 PR2) : impossible à éditer en place (catalogue
      // partagé en lecture seule, RLS). « Modifier » = créer une copie perso
      // éditable PUIS masquer l'originale, de façon transparente (RG-F/RG-G).
      // Copie d'abord : si le masquage échoue, on a au pire un doublon visible
      // (récupérable), jamais une recette perdue.
      await creerRecette(saisie);
      await masquerRecette(geree.recette.id);
    }
    toast.success("Recette modifiée");
    setVue({ mode: "liste" });
    recharger();
  }

  // « Supprimer » (#105) : uniforme sur toutes les recettes. Perso → suppression
  // réelle ; par défaut → masquage. Appliqué IMMÉDIATEMENT (pas différé) pour
  // qu'une régénération lancée pendant la fenêtre d'undo n'y ré-inclue jamais la
  // recette supprimée ; réversible via le bouton « Annuler » du toast.
  function supprimer(geree: RecetteGeree): void {
    if (recettes === null) return;
    // Garde de faisabilité (RG-D) : refuser une suppression qui rendrait la
    // génération impossible (vivier < seuil de Hall pour 14 repas).
    const restantes = recettes
      .filter((r) => r.recette.id !== geree.recette.id)
      .map((r) => r.recette);
    if (!analyserVivier(restantes, reglages).suffisant) {
      toast.error(
        "Impossible de supprimer : il ne resterait pas assez de recettes pour générer un planning. Assouplis tes réglages ou restaure des recettes."
      );
      return;
    }

    const { recette, editable } = geree;
    // Retrait optimiste de la liste.
    setRecettes((liste) => liste?.filter((r) => r.recette.id !== recette.id) ?? null);

    const action = editable
      ? supprimerRecette(recette.id)
      : masquerRecette(recette.id);
    action
      .then(() => {
        toast("Recette supprimée", {
          id: ID_TOAST_SUPPR,
          action: { label: "Annuler", onClick: () => annuler(geree) },
          duration: 5000,
        });
      })
      .catch((e) => {
        recharger(); // l'action a échoué : on remet la liste à jour
        toast.error(e instanceof Error ? e.message : "Suppression impossible.");
      });
  }

  // « Annuler » (undo) : recrée la recette perso supprimée, ou démasque la
  // recette par défaut. La recette perso recréée a un NOUVEL id (la précédente a
  // été détruite) — sans incidence : les plannings persistés gardent leur copie.
  function annuler(geree: RecetteGeree): void {
    const { recette, editable } = geree;
    const undo = editable
      ? creerRecette(recetteVersSaisie(recette)).then(() => undefined)
      : demasquerRecette(recette.id);
    undo
      .then(() => {
        toast.dismiss(ID_TOAST_SUPPR);
        toast.success("Annulé");
        recharger();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Annulation impossible."));
  }

  // Pré-remplissage pour la duplication : copie du nom + ingrédients (#2 PR3).
  // Permet aussi de personnaliser une recette du catalogue (en lecture seule)
  // en créant une copie personnelle.
  function valeurDuplication(source: Recette) {
    return {
      nom: `${source.nom} (copie)`,
      tempsPreparation: source.tempsPreparation,
      vegetarien: source.vegetarien ?? false,
      accompagnement: source.accompagnement,
      saisons: source.saisons,
      etapes: source.etapes,
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
          valeurInitiale={vue.geree.recette}
          onEnregistrer={(saisie) => enregistrerEdition(vue.geree, saisie)}
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
          const vivier = analyserVivier(recettes.map((r) => r.recette), reglages);
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
              {visibles.map((geree) => {
                const { recette } = geree;
                return (
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
                    {/* Duplication possible sur toutes les recettes (catalogue
                        compris : moyen de personnaliser une recette par défaut) */}
                    <button
                      type="button"
                      onClick={() => setVue({ mode: "duplication", source: recette })}
                      className="rounded-full px-3 py-2 text-sm font-medium text-brand-700 underline-offset-2 transition-colors hover:bg-brand-50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      Dupliquer
                    </button>
                    {/* « Modifier » uniforme (#105 PR2) : perso = édition en
                        place ; par défaut = duplication + masquage au save. */}
                    <button
                      type="button"
                      onClick={() => setVue({ mode: "edition", geree })}
                      className="rounded-full px-3 py-2 text-sm font-medium text-brand-700 underline-offset-2 transition-colors hover:bg-brand-50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      Modifier
                    </button>
                    {/* « Supprimer » uniforme (#105) : perso = vraie suppression,
                        par défaut = masquage. Undo via le toast. */}
                    <button
                      type="button"
                      onClick={() => supprimer(geree)}
                      className="rounded-full px-3 py-2 text-sm font-medium text-red-700 underline-offset-2 transition-colors hover:bg-red-50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                    >
                      Supprimer
                    </button>
                  </li>
                );
              })}
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
