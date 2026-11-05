"use client";

// Corps d'une recette (#336) — partagé par la fiche modale de /planning et de
// la vue Cycle (`FicheRecette`, variante "fiche") et par la page /ce-soir
// (variante "cuisine" : texte plus grand, lisible à distance, ingrédients
// cochables). Une seule source pour la mise à l'échelle et le découpage des
// ingrédients, la liste des étapes et les badges.
//
// Les quantités sont mises à l'échelle du slot (RG-20, via RG-17) avec le même
// calcul que la liste de courses (lib/personnes), donc cohérentes. Les
// ingrédients sont scindés « à acheter » / « fond de placard » (RG-14) pour
// répondre au besoin « puis-je la faire sans rien acheter ».

import { useMemo } from "react";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { BadgeSaison } from "@/components/ui/badge-saison";
import { ingredientsAEchelle } from "@/lib/personnes";
import { accorderNom } from "@/lib/pluriels";
import { formaterQuantite } from "@/lib/unites";
import { idIngredient } from "@/lib/coches-repas";
import type { Ingredient, Recette } from "@/types";

export type VarianteRecette = "fiche" | "cuisine";

/** Badges (temps, végé, accompagnement, saison) + nombre de personnes. */
export function BadgesRecette({
  recette,
  personnes,
  variante = "fiche",
}: {
  recette: Recette;
  personnes: number;
  variante?: VarianteRecette;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <BadgeTemps temps={recette.tempsPreparation} />
      {recette.vegetarien && <BadgeVegetarien />}
      {recette.accompagnement && (
        <BadgeAccompagnement accompagnement={recette.accompagnement} />
      )}
      {recette.saisons && recette.saisons.length > 0 && (
        <BadgeSaison saisons={recette.saisons} />
      )}
      <span
        className={
          variante === "cuisine"
            ? "text-sm font-medium text-brand-700/85"
            : "text-xs text-brand-700/85"
        }
      >
        pour {personnes} personne{personnes > 1 ? "s" : ""}
      </span>
    </div>
  );
}

/**
 * Ingrédients (à acheter / fond de placard) puis étapes de préparation.
 * `coches` + `onBasculerCoche` (variante "cuisine" seulement) rendent chaque
 * ingrédient cochable (« sorti du placard », RG-89).
 */
export function ContenuRecette({
  recette,
  personnes,
  variante = "fiche",
  coches,
  onBasculerCoche,
}: {
  recette: Recette;
  personnes: number;
  variante?: VarianteRecette;
  coches?: ReadonlySet<string>;
  onBasculerCoche?: (id: string) => void;
}) {
  const cuisine = variante === "cuisine";

  // Ingrédients mis à l'échelle du slot puis scindés (RG-20). Même calcul que
  // la liste de courses : ×N/2 puis arrondi par type d'unité (ingredientsAEchelle).
  const { aAcheter, fondDePlacard } = useMemo(() => {
    const misAEchelle = ingredientsAEchelle(recette.ingredients, personnes);
    return {
      aAcheter: misAEchelle.filter((i) => !i.fondDePlacard),
      fondDePlacard: misAEchelle.filter((i) => i.fondDePlacard),
    };
  }, [recette, personnes]);

  const cochable = cuisine && coches !== undefined && onBasculerCoche !== undefined;
  const groupe = (titre: string, ingredients: Ingredient[]) => (
    <GroupeIngredients
      titre={titre}
      ingredients={ingredients}
      variante={variante}
      coches={cochable ? coches : undefined}
      onBasculerCoche={cochable ? onBasculerCoche : undefined}
    />
  );

  return (
    <>
      {recette.ingredients.length === 0 ? (
        // RG-09 : tout écran gère son état vide.
        <p
          className={
            cuisine
              ? "py-6 text-base text-brand-700/85"
              : "py-6 text-center text-sm text-brand-700/85"
          }
        >
          Aucun ingrédient renseigné pour cette recette.
        </p>
      ) : (
        <div className={cuisine ? "space-y-8" : "space-y-5"}>
          {aAcheter.length > 0 ? (
            groupe("À acheter", aAcheter)
          ) : (
            <p className={cuisine ? "text-base text-brand-700/85" : "text-sm text-brand-700/85"}>
              Rien à acheter — tous les ingrédients sont au fond de placard.
            </p>
          )}
          {fondDePlacard.length > 0 && groupe("Fond de placard (à vérifier)", fondDePlacard)}
        </div>
      )}

      {/* Préparation (RG-43, #233) : liste numérotée des étapes, APRÈS les
          ingrédients. Masquée si la recette n'a pas d'étapes (catalogue global
          non renseigné) — pas de section vide ni de placeholder bruyant. */}
      {recette.etapes && recette.etapes.length > 0 && (
        <section className={cuisine ? "mt-10" : "mt-6"}>
          <TitreSection variante={variante}>Préparation</TitreSection>
          {cuisine ? (
            // Numéro en pastille, lisible à un mètre du plan de travail ; le
            // <ol> garde la position annoncée par les lecteurs d'écran.
            <ol className="flex flex-col gap-5">
              {recette.etapes.map((etape, index) => (
                <li key={index} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 font-display text-base font-semibold text-brand-700"
                  >
                    {index + 1}
                  </span>
                  <p className="pt-0.5 text-lg leading-relaxed text-brand-900">{etape}</p>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-brand-900 marker:font-semibold marker:text-brand-700/85">
              {recette.etapes.map((etape, index) => (
                <li key={index} className="pl-1">
                  {etape}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}

// Titre de section : h3 sous le h2 de la fiche modale, h2 sous le h1 de la page.
function TitreSection({
  variante,
  children,
}: {
  variante: VarianteRecette;
  children: React.ReactNode;
}) {
  if (variante === "cuisine") {
    return (
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-700/85">
        {children}
      </h2>
    );
  }
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700/85">
      {children}
    </h3>
  );
}

// Une section d'ingrédients (nom accordé + quantité formatée), même rendu que
// la liste de courses (lib/unites, lib/pluriels).
function GroupeIngredients({
  titre,
  ingredients,
  variante,
  coches,
  onBasculerCoche,
}: {
  titre: string;
  ingredients: Ingredient[];
  variante: VarianteRecette;
  coches?: ReadonlySet<string>;
  onBasculerCoche?: (id: string) => void;
}) {
  const cuisine = variante === "cuisine";
  return (
    <section>
      <TitreSection variante={variante}>{titre}</TitreSection>
      <ul className="divide-y divide-brand-100">
        {ingredients.map((ingredient) => {
          const cle = `${ingredient.nom}-${ingredient.unite}`;
          if (coches && onBasculerCoche) {
            const id = idIngredient(ingredient);
            const coche = coches.has(id);
            return (
              <li key={cle}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={coche}
                    onChange={() => onBasculerCoche(id)}
                    className="size-5 shrink-0 cursor-pointer accent-brand-600"
                  />
                  {/* Coché : rayé + passage au vert secondaire, sans opacité
                      (contraste AA conservé, cf. audit #336). */}
                  <span
                    className={`flex-1 text-lg transition-colors ${
                      coche ? "text-brand-700/85 line-through" : "text-brand-900"
                    }`}
                  >
                    {accorderNom(ingredient)}
                  </span>
                  <span
                    className={`shrink-0 text-lg font-medium text-brand-700/85 transition-colors ${
                      coche ? "line-through" : ""
                    }`}
                  >
                    {formaterQuantite(ingredient)}
                  </span>
                </label>
              </li>
            );
          }
          return (
            <li
              key={cle}
              className={`flex items-center justify-between gap-3 ${cuisine ? "py-3" : "py-2"}`}
            >
              <span className={`${cuisine ? "text-lg" : "text-sm"} text-brand-900`}>
                {accorderNom(ingredient)}
              </span>
              <span
                className={`shrink-0 ${cuisine ? "text-lg" : "text-sm"} font-medium text-brand-700/85`}
              >
                {formaterQuantite(ingredient)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
