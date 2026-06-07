"use client";

// Page Planning — génération et affichage du planning hebdomadaire (US-01, US-04)
//
// États d'interface (RG-09) : vide (avant toute génération), chargement,
// erreur, chargé. Le planning est persisté en localStorage sous la clé
// "planning_courant" (section 5.6) et relu au montage.
//
// localStorage est un système externe à React : il est branché via
// useSyncExternalStore (pattern recommandé par React — la règle ESLint
// react-hooks/set-state-in-effect interdit le setState synchrone dans un
// useEffect au montage). Le mini-store vit dans lib/stockage.ts (partagé
// avec la page Courses). Côté serveur, le snapshot vaut null : la page est
// prérendue en état vide, puis hydratée avec le planning sauvegardé.
//
// Responsive (RG-06 à RG-08) : liste verticale par jour en mobile,
// grille 7 colonnes à partir de md (≥ 768px).

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  genererPlanning,
  recettesUtilisees,
  remplacerSlot,
  remplacerSlotManuel,
} from "@/lib/generateur";
import {
  storePlanning,
  sauvegarderPlanningComplet,
  sauvegarderRemplacementSlot,
} from "@/lib/stockage";
import {
  modifierPersonnes,
  personnesDuSlot,
  PERSONNES_MAX,
  PERSONNES_MIN,
} from "@/lib/personnes";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { SelecteurRecette } from "@/components/planning/selecteur-recette";
import recettesJson from "@/data/recettes.json";
import type { Jour, JourPlanning, Planning, Recette } from "@/types";

const RECETTES = recettesJson as Recette[];

type TypeRepas = "dejeuner" | "diner";

// ============================================================================
// Libellés & styles
// ============================================================================

// Libellés des jours : complet pour la liste mobile (RG-08), abrégé pour les
// en-têtes de la grille desktop (RG-07).
const LIBELLES_JOURS: Record<Jour, { complet: string; abrege: string }> = {
  lundi: { complet: "Lundi", abrege: "Lun" },
  mardi: { complet: "Mardi", abrege: "Mar" },
  mercredi: { complet: "Mercredi", abrege: "Mer" },
  jeudi: { complet: "Jeudi", abrege: "Jeu" },
  vendredi: { complet: "Vendredi", abrege: "Ven" },
  samedi: { complet: "Samedi", abrege: "Sam" },
  dimanche: { complet: "Dimanche", abrege: "Dim" },
};

function cleSlot(jour: Jour, typeRepas: TypeRepas): string {
  return `${jour}-${typeRepas}`;
}

// "2026-W23" → "Semaine du 1 juin 2026" — bien plus lisible que l'identifiant
// ISO brut. Norme ISO 8601 : le 4 janvier appartient toujours à la semaine 1 ;
// on en déduit le lundi de la semaine 1, puis on avance de N-1 semaines.
// Tout est calculé en UTC pour être insensible au fuseau horaire.
function formaterSemaine(semaine: string): string {
  const correspondance = /^(\d{4})-W(\d{2})$/.exec(semaine);
  if (!correspondance) return `Semaine ${semaine}`; // format inattendu : affichage brut
  const annee = Number(correspondance[1]);
  const numero = Number(correspondance[2]);

  const quatreJanvier = new Date(Date.UTC(annee, 0, 4));
  const jourSemaine = quatreJanvier.getUTCDay() || 7; // ISO : lundi = 1 … dimanche = 7
  const lundi = new Date(quatreJanvier);
  lundi.setUTCDate(
    quatreJanvier.getUTCDate() - (jourSemaine - 1) + (numero - 1) * 7
  );

  const date = lundi.toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `Semaine du ${date}`;
}

// Slots d'un jour dans l'ordre d'affichage : déjeuner (week-end) puis dîner.
function slotsDuJour(
  jp: JourPlanning
): { typeRepas: TypeRepas; libelle: string; recette: Recette }[] {
  const slots: { typeRepas: TypeRepas; libelle: string; recette: Recette }[] =
    [];
  if (jp.dejeuner) {
    slots.push({ typeRepas: "dejeuner", libelle: "Déjeuner", recette: jp.dejeuner });
  }
  slots.push({ typeRepas: "diner", libelle: "Dîner", recette: jp.diner });
  return slots;
}

// ============================================================================
// Composant page
// ============================================================================

// Transition en cours, par-dessus le planning persisté : repos (rien),
// chargement (génération en cours) ou erreur (génération échouée).
type Transition =
  | { statut: "repos" }
  | { statut: "chargement" }
  | { statut: "erreur"; message: string };

export default function PagePlanning() {
  // Planning persisté (système externe) : null = état vide (RG-09).
  const brut = useSyncExternalStore(
    storePlanning.sAbonner,
    storePlanning.lire,
    storePlanning.lireServeur
  );
  const [transition, setTransition] = useState<Transition>({ statut: "repos" });
  // Slot dont le dernier remplacement a échoué (RG-04) : "jour-typeRepas".
  const [slotIndisponible, setSlotIndisponible] = useState<string | null>(null);
  // Slot en cours de sélection manuelle (US-06) : le sélecteur est monté
  // tant que cette valeur est non nulle.
  const [slotEnSelection, setSlotEnSelection] = useState<{
    jour: Jour;
    typeRepas: TypeRepas;
  } | null>(null);

  const planning = useMemo<Planning | null>(() => {
    if (brut === null) return null;
    try {
      return JSON.parse(brut) as Planning;
    } catch (erreur) {
      // Donnée corrompue : on la signale et on retombe en état vide.
      // La prochaine génération écrasera la valeur illisible.
      console.error(`localStorage["planning_courant"] illisible.`, erreur);
      return null;
    }
  }, [brut]);

  // Génération (US-01) : un court délai laisse React peindre l'état
  // "chargement" avant le calcul, puis le résultat écrase la sauvegarde.
  function genererNouveauPlanning(): void {
    setTransition({ statut: "chargement" });
    setTimeout(() => {
      try {
        const nouveau = genererPlanning(RECETTES);
        // Génération complète : réinitialise aussi les coches de la liste
        // de courses (RG-13) — règle centralisée dans lib/stockage.ts.
        sauvegarderPlanningComplet(nouveau);
        setSlotIndisponible(null);
        setTransition({ statut: "repos" });
        toast.success("Planning généré");
      } catch (erreur) {
        setTransition({
          statut: "erreur",
          message:
            erreur instanceof Error
              ? erreur.message
              : "Erreur inattendue pendant la génération.",
        });
      }
    }, 300);
  }

  // Remplacement d'un slot (US-04, RG-04) : si aucune recette éligible
  // n'est disponible, le slot concerné affiche "Pas de recette disponible".
  function changerSlot(jour: Jour, typeRepas: TypeRepas): void {
    if (planning === null) return;
    const nouveau = remplacerSlot(planning, jour, typeRepas, RECETTES);
    if (nouveau === null) {
      // Toast en complément du message inline du slot (RG-04)
      setSlotIndisponible(cleSlot(jour, typeRepas));
      toast.error("Pas de recette disponible");
      return;
    }
    // Remplacement individuel : les coches sont conservées, l'invalidation
    // par quantité (RG-12) protège les articles dont l'agrégat change.
    sauvegarderRemplacementSlot(nouveau);
    setSlotIndisponible(null);
    toast.success("Recette remplacée");
  }

  // Sélection manuelle (US-06, RG-15) : remplace le slot par la recette
  // choisie — by-pass RG-01/RG-02, ne peut pas échouer depuis l'UI.
  function selectionnerRecette(recette: Recette): void {
    if (planning === null || slotEnSelection === null) return;
    const nouveau = remplacerSlotManuel(
      planning,
      slotEnSelection.jour,
      slotEnSelection.typeRepas,
      recette
    );
    if (nouveau === null) return; // slot inexistant : impossible depuis l'UI
    sauvegarderRemplacementSlot(nouveau);
    // Un éventuel « Pas de recette disponible » sur ce slot est obsolète (RG-15).
    setSlotIndisponible(null);
    toast.success("Recette remplacée");
  }

  // Nombre de personnes d'un slot (US-07, RG-16/17) : la liste de courses
  // se met à l'échelle, les coches des articles touchés sont invalidées par
  // la variation de quantité (RG-12). Écriture sans reset des coches.
  function changerPersonnes(
    jour: Jour,
    typeRepas: TypeRepas,
    personnes: number
  ): void {
    if (planning === null) return;
    const nouveau = modifierPersonnes(planning, jour, typeRepas, personnes);
    if (nouveau === null) return; // slot inexistant : impossible depuis l'UI
    sauvegarderRemplacementSlot(nouveau);
  }

  // --- État chargement (RG-09) ---
  if (transition.statut === "chargement") {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        {/* role="status" : annonce le chargement aux lecteurs d'écran */}
        <p role="status" className="animate-pulse text-lg text-brand-700/85">
          Génération du planning…
        </p>
      </main>
    );
  }

  // --- État erreur (RG-09) ---
  if (transition.statut === "erreur") {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <p className="font-medium text-red-800">La génération a échoué</p>
          <p className="mt-1 text-sm text-red-700">{transition.message}</p>
        </div>
        <button
          type="button"
          onClick={genererNouveauPlanning}
          className="rounded-full bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Réessayer
        </button>
      </main>
    );
  }

  // --- État vide (RG-09) : bouton de génération centré (écran 1) ---
  if (planning === null) {
    return (
      <main id="contenu" className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-brand-900">
            Mon planning de la semaine
          </h1>
          <p className="mt-2 text-brand-700/85">
            Aucun planning pour l&apos;instant — lance la génération !
          </p>
        </div>
        <button
          type="button"
          onClick={genererNouveauPlanning}
          className="rounded-full bg-brand-600 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Générer mon planning
        </button>
      </main>
    );
  }

  // --- État chargé : planning affiché ---
  return (
    <main id="contenu" className="flex-1 p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-brand-900">
            Mon planning de la semaine
          </h1>
          <p className="text-sm text-brand-700/85">
            {formaterSemaine(planning.semaine)}
          </p>
        </div>
        {/* after:-inset-1 : étend la zone tactile à ≥ 44px sans changer le visuel */}
        <button
          type="button"
          onClick={genererNouveauPlanning}
          className="relative rounded-full border border-brand-200 px-4 py-2 text-sm font-medium text-brand-700 transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Regénérer
        </button>
        <Link
          href="/courses"
          className="relative rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Liste de courses →
        </Link>
      </header>

      {/* Vue mobile (RG-08) : liste verticale, un bloc par jour */}
      <ul className="space-y-4 md:hidden">
        {planning.jours.map((jp) => (
          <li
            key={jp.jour}
            className="rounded-lg border border-brand-100 bg-white p-4"
          >
            <h2 className="mb-3 font-semibold text-brand-900">
              {LIBELLES_JOURS[jp.jour].complet}
            </h2>
            <div className="space-y-3">
              {slotsDuJour(jp).map((slot) => (
                <SlotRepas
                  key={slot.typeRepas}
                  libelle={slot.libelle}
                  jourLabel={LIBELLES_JOURS[jp.jour].complet}
                  recette={slot.recette}
                  indisponible={
                    slotIndisponible === cleSlot(jp.jour, slot.typeRepas)
                  }
                  personnes={personnesDuSlot(jp, slot.typeRepas)}
                  onChanger={() => changerSlot(jp.jour, slot.typeRepas)}
                  onSelectionner={() =>
                    setSlotEnSelection({ jour: jp.jour, typeRepas: slot.typeRepas })
                  }
                  onChangerPersonnes={(n) =>
                    changerPersonnes(jp.jour, slot.typeRepas, n)
                  }
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* Vue desktop (RG-07) : grille 7 colonnes, une par jour */}
      <div className="hidden md:grid md:grid-cols-7 md:gap-3">
        {planning.jours.map((jp) => (
          <section key={jp.jour} className="flex flex-col gap-3">
            <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-brand-700/85">
              {LIBELLES_JOURS[jp.jour].abrege}
            </h2>
            {slotsDuJour(jp).map((slot) => (
              <SlotRepas
                key={slot.typeRepas}
                libelle={slot.libelle}
                jourLabel={LIBELLES_JOURS[jp.jour].complet}
                recette={slot.recette}
                indisponible={
                  slotIndisponible === cleSlot(jp.jour, slot.typeRepas)
                }
                personnes={personnesDuSlot(jp, slot.typeRepas)}
                onChanger={() => changerSlot(jp.jour, slot.typeRepas)}
                onSelectionner={() =>
                  setSlotEnSelection({ jour: jp.jour, typeRepas: slot.typeRepas })
                }
                onChangerPersonnes={(n) =>
                  changerPersonnes(jp.jour, slot.typeRepas, n)
                }
              />
            ))}
          </section>
        ))}
      </div>

      {/* Sélecteur de recette (US-06) — monté seulement pendant la sélection */}
      {slotEnSelection && (
        <SelecteurRecette
          titre={`${slotEnSelection.typeRepas === "diner" ? "Dîner" : "Déjeuner"} de ${LIBELLES_JOURS[slotEnSelection.jour].complet.toLowerCase()}`}
          recettes={RECETTES}
          idsAuPlanning={recettesUtilisees(planning)}
          onSelectionner={selectionnerRecette}
          onFermer={() => setSlotEnSelection(null)}
        />
      )}
    </main>
  );
}

// Carte d'un repas : label du slot, nom de la recette, badge de temps de
// préparation, remplacement aléatoire (US-04) et sélection manuelle (US-06).
// Partagée entre les vues mobile et desktop.
function SlotRepas({
  libelle,
  jourLabel,
  recette,
  indisponible,
  personnes,
  onChanger,
  onSelectionner,
  onChangerPersonnes,
}: {
  libelle: string;
  jourLabel: string;
  recette: Recette;
  indisponible: boolean;
  personnes: number;
  onChanger: () => void;
  onSelectionner: () => void;
  onChangerPersonnes: (personnes: number) => void;
}) {
  return (
    <div className="rounded-lg border border-brand-100 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
        {libelle}
      </p>
      <p className="mt-1 text-sm font-medium text-brand-900">{recette.nom}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <BadgeTemps temps={recette.tempsPreparation} />
        {/*
          a11y : aria-labels contextualisés — 9 paires de boutons identiques
          sont indiscernables au lecteur d'écran ; le glyphe ↺ (vocalisé
          bizarrement) est masqué ; after:-inset-* étend la zone tactile à ≥ 44px.
        */}
        <button
          type="button"
          onClick={onChanger}
          aria-label={`Changer le ${libelle.toLowerCase()} de ${jourLabel.toLowerCase()}`}
          className="relative px-2 py-2 text-sm text-brand-700/85 underline-offset-2 transition-colors after:absolute after:-inset-1 after:content-[''] hover:text-brand-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <span aria-hidden="true">↺</span> changer
        </button>
        {/* Sélection manuelle (US-06) : ouvre le sélecteur de recettes */}
        <button
          type="button"
          onClick={onSelectionner}
          aria-label={`Sélectionner le ${libelle.toLowerCase()} de ${jourLabel.toLowerCase()}`}
          className="relative px-2 py-2 text-sm text-brand-700/85 underline-offset-2 transition-colors after:absolute after:-inset-1 after:content-[''] hover:text-brand-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Sélectionner
        </button>
      </div>
      {/* Nombre de personnes (US-07) : la liste de courses se met à l'échelle */}
      <StepperPersonnes
        personnes={personnes}
        slotLabel={`${libelle.toLowerCase()} de ${jourLabel.toLowerCase()}`}
        onChanger={onChangerPersonnes}
      />
      {/* role="alert" : le message dynamique est annoncé aux lecteurs d'écran */}
      {indisponible && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          Pas de recette disponible
        </p>
      )}
    </div>
  );
}

// Stepper du nombre de personnes (US-07, RG-16) : − N pers. +, borné [1;12].
// Les boutons portent un aria-label contextualisé (9 paires identiques) et
// une zone tactile ≥ 44px ; la valeur est annoncée via aria-live.
function StepperPersonnes({
  personnes,
  slotLabel,
  onChanger,
}: {
  personnes: number;
  slotLabel: string;
  onChanger: (personnes: number) => void;
}) {
  const styleBouton =
    "relative flex size-7 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChanger(personnes - 1)}
        disabled={personnes <= PERSONNES_MIN}
        aria-label={`Moins de personnes pour le ${slotLabel}`}
        className={styleBouton}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span
        aria-live="polite"
        className="min-w-[4.5rem] text-center text-xs font-medium text-brand-700/85"
      >
        {personnes} pers.
      </span>
      <button
        type="button"
        onClick={() => onChanger(personnes + 1)}
        disabled={personnes >= PERSONNES_MAX}
        aria-label={`Plus de personnes pour le ${slotLabel}`}
        className={styleBouton}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
