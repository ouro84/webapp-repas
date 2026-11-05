"use client";

import { useState } from "react";
import { CookingPot, RefreshCw, Search } from "lucide-react";
import { BadgeTemps } from "@/components/planning/badge-temps";
import { BadgeVegetarien } from "@/components/ui/badge-vegetarien";
import { BadgeAccompagnement } from "@/components/ui/badge-accompagnement";
import { BadgeSaison } from "@/components/ui/badge-saison";
import { PERSONNES_MIN, PERSONNES_MAX } from "@/lib/personnes";
import type { Recette } from "@/types";

// Carte d'un repas : label du slot, nom de la recette, badge de temps de
// préparation, remplacement aléatoire (US-04) et sélection manuelle (US-06).
// Partagée entre les vues mobile et desktop (app/planning/page.tsx), et depuis
// la vue Cycle (components/planning/vue-cycle.tsx) — extraite ici pour éviter
// de dupliquer ~200 lignes d'UI d'édition entre les deux vues.
// Gabarit unique (#352) : la carte occupe toute la hauteur de sa cellule de
// grille (`h-full`) et ancre badges + actions + stepper en bas (`mt-auto`), pour
// que les rangées s'alignent d'une colonne à l'autre en desktop.
export function SlotRepas({
  libelle,
  jourLabel,
  recette,
  indisponible,
  personnes,
  onChanger,
  onSelectionner,
  onChangerPersonnes,
  onVoir,
  restes,
  onChangerRestes,
  delaiNomMs,
  accentue = false,
}: {
  libelle: string;
  jourLabel: string;
  recette: Recette | undefined;
  indisponible: boolean;
  personnes: number;
  onChanger: () => void;
  onSelectionner: () => void;
  onChangerPersonnes: (personnes: number) => void;
  onVoir: () => void;
  restes: boolean;
  onChangerRestes: (valeur: boolean) => void;
  /**
   * Chorégraphie de génération (#337) : retard du fondu du nom de plat, posé
   * seulement pendant la chorégraphie (jamais sur un remplacement de slot).
   */
  delaiNomMs?: number;
  /**
   * Jour courant (#352) : bordure `border-2 border-brand-600`. Le padding est
   * compensé (11px + 2px = 12px + 1px) pour ne pas décaler le contenu.
   */
  accentue?: boolean;
}) {
  const slotNom = `${libelle.toLowerCase()} de ${jourLabel.toLowerCase()}`;
  // Spin one-shot de l'icône « changer » (#69, P17) : incrémenté au clic →
  // re-monte l'icône (key) pour rejouer la rotation. 0 au montage = pas de spin.
  const [spin, setSpin] = useState(0);
  // Style unifié des actions de slot (#210, audit #51) : chip discret (icône +
  // libellé) au lieu de liens-texte hétérogènes — toutes les actions ont le même
  // traitement et un fond au survol qui les fait lire comme des contrôles. Zone
  // tactile ≥ 44px via after:-inset-1. `transition` (et non transition-colors)
  // anime couleur ET transform → le feedback `active:scale` est lissé ; neutralisé
  // en reduced-motion.
  // Bordure + padding de la carte : l'accent épaissit la bordure et rend 1px de
  // padding, la hauteur et la position du contenu restent identiques.
  const bordure = accentue
    ? "border-2 border-brand-600 p-[11px]"
    : "border p-3";
  const styleAction =
    "relative inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100";

  // Créneau désactivé (« Aucun », #217, RG-44/46) : emplacement CONSERVÉ (pas de
  // grille qui se resserre), état vide sobre — 3ᵉ état UI minimum. Aucune action :
  // le seul levier est /reglages. Prioritaire sur le rendu « restes » (un slot
  // sans recette n'a rien à cuisiner/sélectionner).
  if (!recette) {
    return (
      <div
        className={`h-full rounded-lg border-dashed bg-brand-50/30 text-center shadow-sm ${bordure} ${accentue ? "" : "border-brand-100"}`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
          {libelle}
        </p>
        <p className="mt-2 text-sm text-brand-700/70">Pas de repas prévu</p>
      </div>
    );
  }

  // Slot marqué « restes » (US-12, RG-22) : pas de cuisine → ni badge de temps,
  // ni stepper, ni fiche. On revient au repas planifié (« Cuisiner ») ou on en
  // choisit un autre (« Sélectionner »). Style atténué + bordure pointillée.
  if (restes) {
    return (
      <div
        className={`flex h-full flex-col rounded-lg border-dashed bg-brand-50/50 shadow-sm ${bordure} ${accentue ? "" : "border-brand-200"}`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
          {libelle}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-brand-700/80">
          <IconeRestes /> Restes
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-2 lg:flex-col lg:items-start">
          <button
            type="button"
            onClick={() => onChangerRestes(false)}
            aria-label={`Cuisiner le ${slotNom}`}
            className={styleAction}
          >
            <CookingPot aria-hidden="true" className="size-3.5" />
            Cuisiner
          </button>
          <button
            type="button"
            onClick={onSelectionner}
            aria-label={`Sélectionner le ${slotNom}`}
            className={styleAction}
          >
            <Search aria-hidden="true" className="size-3.5" />
            Sélectionner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col rounded-lg bg-surface shadow-sm ${bordure} ${accentue ? "" : "border-brand-100"}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700/85">
        {libelle}
      </p>
      {/* Nom = déclencheur de la fiche (US-10, RG-20). Bouton plutôt que card
          entière cliquable : la card porte déjà changer/sélectionner/stepper
          (pas d'imbrication d'interactifs). text-left + zone tactile étendue. */}
      {/* key={recette.nom} : sur remplacement (US-04/US-06), le nom re-monte
          et joue un fade (#69, P17) — la bascule sèche devient un crossfade
          doux. motion-safe : statique si l'utilisateur réduit les animations. */}
      <button
        key={recette.nom}
        type="button"
        onClick={onVoir}
        aria-label={`Voir la recette : ${recette.nom}`}
        title={recette.nom}
        // `backwards` : le nom reste invisible pendant son retard (le token
        // crossfade n'a pas de remplissage).
        // `line-clamp-3` + `title` : en colonne étroite (desktop) le nom est
        // tronqué à 3 lignes, le nom complet reste en infobulle.
        style={
          delaiNomMs !== undefined
            ? { animationDelay: `${delaiNomMs}ms`, animationFillMode: "backwards" }
            : undefined
        }
        className="mt-1 line-clamp-3 w-full text-left text-sm font-medium text-brand-900 underline-offset-2 transition-colors hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 motion-safe:animate-crossfade"
      >
        {recette.nom}
      </button>
      {/* Bloc bas ancré (`mt-auto`, #352) : badges, actions, stepper et alerte
          restent alignés en bas de la carte quelle que soit la longueur du nom. */}
      <div className="mt-auto">
        {/* Badges (information) — ligne dédiée, séparée des actions (#210). */}
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
        {/* Actions (contrôles) — ligne dédiée + style unifié (#210, audit #51) :
            séparées des badges par un filet. Toujours visibles (#334) : le
            disclosure « Actions » de #210 coûtait un tap de plus sur des actions
            utilisées à chaque visite. La densité est tenue autrement : Changer en
            icône seule (l'action « magique », reconnaissable au ↻), Sélectionner
            et Restes libellés — une ligne à 320 px. À `lg` (colonnes de ~125 px),
            les actions s'empilent (`lg:flex-col`) et gardent leurs libellés ;
            Changer gagne alors le sien (`hidden lg:inline`), son `title` ne servant
            qu'en mobile où il est icône seule.
            a11y : aria-labels contextualisés (des paires de boutons identiques sont
            indiscernables au lecteur d'écran) ; icônes décoratives ; le libellé
            visible est contenu dans le nom accessible (WCAG 2.5.3). */}
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-brand-100/70 pt-2 lg:flex-col lg:items-start">
          <button
            type="button"
            onClick={() => {
              setSpin((s) => s + 1);
              onChanger();
            }}
            aria-label={`Changer le ${slotNom}`}
            title="Changer"
            className={styleAction}
          >
            {/* key={spin} : chaque clic re-monte l'icône → rejoue la rotation
                360°. spin>0 garde le tout premier rendu sans rotation. (#69) */}
            <RefreshCw
              key={spin}
              aria-hidden="true"
              className={`size-4 ${spin > 0 ? "motion-safe:animate-spin-once" : ""}`}
            />
            <span className="hidden lg:inline">Changer</span>
          </button>
          {/* Sélection manuelle (US-06) : ouvre le sélecteur de recettes */}
          <button
            type="button"
            onClick={onSelectionner}
            aria-label={`Sélectionner le ${slotNom}`}
            className={styleAction}
          >
            <Search aria-hidden="true" className="size-3.5" />
            Sélectionner
          </button>
          {/* Marquer en « restes » (US-12) : pas de cuisine ce repas-là */}
          <button
            type="button"
            onClick={() => onChangerRestes(true)}
            aria-label={`Marquer le ${slotNom} en restes`}
            className={styleAction}
          >
            <IconeRestes />
            Restes
          </button>
        </div>
        {/* Nombre de personnes (US-07) : la liste de courses se met à l'échelle */}
        <StepperPersonnes
          personnes={personnes}
          slotLabel={slotNom}
          onChanger={onChangerPersonnes}
        />
        {/* role="alert" : le message dynamique est annoncé aux lecteurs d'écran */}
        {indisponible && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            Pas de recette disponible
          </p>
        )}
      </div>
    </div>
  );
}

// Icône « restes » — bol fumant, SVG inline (pas d'emoji, audit #51).
export function IconeRestes() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h16M6 12a6 6 0 0 0 12 0M9 3c-.6 1-.6 2 0 3M13 3c-.6 1-.6 2 0 3" />
    </svg>
  );
}

// Stepper du nombre de personnes (US-07, RG-16) : − N pers. +, borné [1;12].
// Les boutons portent un aria-label contextualisé (9 paires identiques) et
// une zone tactile ≥ 44px ; la valeur est annoncée via aria-live.
export function StepperPersonnes({
  personnes,
  slotLabel,
  onChanger,
}: {
  personnes: number;
  slotLabel: string;
  onChanger: (personnes: number) => void;
}) {
  const styleBouton =
    "relative flex size-7 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-2 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.92] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
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
