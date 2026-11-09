"use client";

// Squelette de la vue Semaine de /planning (#400, RG-09) : affiché tant que la
// première lecture de la semaine n'est pas terminée (`useSemaineLue`), et en
// repli Suspense de la page. Il reprend les classes de boîte de l'état chargé
// (`EntetePlanning`, `NavigateurPeriode`, `GrilleJours`, `SlotRepas`) pour ne
// rien décaler au remplacement (CLS, cf. ui.md).
//
// Textes fixes en vrai texte (titre s'il est connu, légende, « Déjeuner » /
// « Dîner »), données en `TexteSquelette` (jours, noms de plats, personnes),
// contrôles en `Squelette` de leur taille. Contenu SANS `<main>` ni padding :
// l'appelant rend le `<main>` de l'état chargé.

import { LegendeBadges } from "@/components/planning/entete-planning";
import { GrilleJours, type JourGrille } from "@/components/planning/grille-jours";
import { Squelette, TexteSquelette, ZoneChargement } from "@/components/ui/squelette";

/**
 * Navigateur de période en squelette (classes de `NavigateurPeriode`) : deux
 * flèches `size-8` et le centre (libellé + dates, `h-11`). Sans `ZoneChargement`
 * propre : il vit dans la zone de l'appelant (vue Semaine, /courses).
 */
export function SqueletteNavigateurPeriode() {
  return (
    <div className="inline-flex items-center gap-2">
      <Squelette className="size-8 rounded-full" />
      <Squelette className="h-11 min-w-[11rem] rounded-lg" />
      <Squelette className="size-8 rounded-full" />
    </div>
  );
}

// Carte de repas en squelette : mêmes classes de carte, d'actions et de stepper
// que `SlotRepas` (variante recette). Seul le libellé du créneau est réel.
function SlotSquelette({ libelle }: { libelle: string }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-brand-100 bg-surface p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">{libelle}</p>
      <p className="mt-1 line-clamp-3 w-full text-left text-sm font-medium">
        <TexteSquelette sur="carte">Gratin de courgettes</TexteSquelette>
      </p>
      <div className="mt-auto">
        {/* Badges : temps de préparation + un badge compact. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Squelette sur="carte" className="h-5 w-[3.25rem] rounded-full" />
          <Squelette sur="carte" className="size-4 rounded-full" />
        </div>
        {/* Actions Changer / Sélectionner / Restes (chips `h-8`, empilées à lg). */}
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-brand-100/70 pt-2 lg:flex-col lg:items-start">
          <Squelette sur="carte" className="h-8 w-9 max-w-full rounded-full lg:w-[5.25rem]" />
          <Squelette sur="carte" className="h-8 w-[7.25rem] max-w-full rounded-full lg:w-[6.5rem]" />
          <Squelette sur="carte" className="h-8 w-[5.25rem] max-w-full rounded-full lg:w-[4.75rem]" />
        </div>
        {/* Stepper personnes : « − 2 pers. + » (unité masquée à lg). */}
        <div className="mt-2 flex items-center gap-2 lg:gap-1">
          <Squelette sur="carte" className="size-7 shrink-0 rounded-full" />
          <span className="inline-flex min-w-[4.5rem] items-center justify-center gap-1 text-center text-xs font-medium lg:min-w-0 lg:flex-1">
            <span className="lg:hidden">
              <TexteSquelette sur="carte">2 pers.</TexteSquelette>
            </span>
            <span className="hidden lg:inline">
              <TexteSquelette sur="carte">2</TexteSquelette>
            </span>
          </span>
          <Squelette sur="carte" className="size-7 shrink-0 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// 7 jours factices : `dateISO` est ignoré par `GrilleJours squelette`.
const JOURS_SQUELETTE: JourGrille[] = Array.from({ length: 7 }, (_, i) => ({
  cle: `jour-${i}`,
  dateISO: "",
  slots: [
    <SlotSquelette key="dejeuner" libelle="Déjeuner" />,
    <SlotSquelette key="diner" libelle="Dîner" />,
  ],
}));

/**
 * Squelette de la vue Semaine. `titre` : `h1` réel s'il est connu, barre sinon
 * (repli Suspense : la vue préférée, en localStorage, n'est pas connue au
 * prérendu).
 */
export function SquelettePlanning({ titre }: { titre: string | null }) {
  return (
    <ZoneChargement>
      {/* En-tête : classes d'`EntetePlanning`. */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          {titre !== null ? (
            <h1 className="font-display text-2xl font-semibold text-brand-900">{titre}</h1>
          ) : (
            <p className="font-display text-2xl font-semibold">
              <TexteSquelette>Mon planning de la semaine</TexteSquelette>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Bascule Semaine | Cycle. */}
          <Squelette className="h-[38px] w-[9.25rem] rounded-full" />
          {/* Réglages de génération (icône `size-10`). */}
          <Squelette className="size-10 shrink-0 rounded-full" />
          {/* « Régénérer » et « Liste de courses → » : pleine largeur partagée
              sur mobile (`flex-1`, largeur minimale ≈ celle du libellé), compacts dès sm. */}
          <Squelette className="h-[38px] min-w-[6.5rem] flex-1 rounded-full sm:w-[6.5rem] sm:flex-none" />
          <Squelette className="h-9 min-w-[5.25rem] flex-1 rounded-full sm:w-[9.5rem] sm:flex-none" />
        </div>
      </header>

      <LegendeBadges />

      <div className="mb-6">
        <SqueletteNavigateurPeriode />
      </div>

      <GrilleJours jours={JOURS_SQUELETTE} aujourdhuiISO={null} squelette />
    </ZoneChargement>
  );
}
