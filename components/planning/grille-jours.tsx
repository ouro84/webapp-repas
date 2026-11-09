"use client";

// Grille des jours du planning, commune aux vues Semaine et Cycle (#352).
//
// - Mobile et tablette (< lg) : liste verticale de cartes, un jour par carte
//   (libellé complet « Lundi 2 nov. »), déjeuner et dîner côte à côte dès sm.
// - Desktop (≥ lg) : rangées de 7 colonnes (une rangée = 7 jours, `enRangees`) ;
//   un cycle de plus de 7 jours passe sur plusieurs rangées, un cycle plus court
//   laisse des colonnes vides (même largeur de colonne que la semaine). Chaque
//   jour est une `section` qui hérite des 3 lignes de sa rangée (CSS subgrid) :
//   en-tête, déjeuner, dîner. Les lignes prennent la hauteur du plus haut de la
//   rangée, donc les cartes Déjeuner (puis Dîner) s'alignent d'une colonne à
//   l'autre, et leurs actions ancrées en bas (`SlotRepas`, `mt-auto`) aussi.
// - Jour courant : pastille « Aujourd’hui » + bordure épaisse de la carte
//   (mobile). Les cartes de repas du jour sont accentuées par la vue
//   (`SlotRepas accentue`, effet à `lg` seulement : en mobile, seule la carte du
//   jour est bordée), qui construit les slots. `aujourdhuiISO` vaut `null`
//   tant que la date du client n'est pas connue (pas de date au rendu serveur).
//
// Présentatif : la vue construit les deux `SlotRepas` de chaque jour (callbacks,
// `jourLabel`), la grille ne fait que les placer. Le libellé du jour est dans le
// DOM AVANT la pastille (nom accessible et texte commencent par le jour : les
// e2e filtrent les cartes par `/^Vendredi/`) ; en desktop, la pastille est
// affichée au-dessus par `flex-col-reverse`.
//
// Chorégraphie de génération (#337, vue Semaine seulement) : `cleAnimation` sert
// de `key` aux deux paliers (le changer remonte la grille et rejoue l'entrée en
// cascade), `animerEntree` pose `animate-entree-jour` à `delaiJour(i)`,
// `enAttente` estompe la grille (toujours cliquable) et `decor` accueille la
// pulsation d'atterrissage, en premier enfant. Mobile : le `h2` et la grille
// des cartes (`relative`) restent au-dessus du lavis. Desktop : les cartes ne
// sont pas positionnées, le halo se peint AU-DESSUS d'elles (seul le `h2`,
// `relative`, reste dessus) : un lavis translucide, pas un fond (cf. ui.md).

import type { CSSProperties, ReactNode } from "react";
import { TexteSquelette } from "@/components/ui/squelette";
import { delaiJour } from "@/lib/choregraphie-generation";
import {
  enRangees,
  libelleJourAbrege,
  libelleJourComplet,
} from "@/lib/planning-affichage";

export type JourGrille = {
  /** Clé React stable du jour (nom du jour en semaine, date en cycle). */
  cle: string;
  /** Date ISO locale « AAAA-MM-JJ » du jour affiché. */
  dateISO: string;
  /** Les deux `SlotRepas` déjà construits par la vue : déjeuner puis dîner. */
  slots: ReactNode[];
};

type Palier = "mobile" | "desktop";

// Squelette (#400) : libellés de jour factices, de longueur plausible, rendus
// en barre (`TexteSquelette`) ; `dateISO` est alors ignoré.
const JOUR_FACTICE: Record<Palier, string> = {
  mobile: "Mercredi 11 novembre",
  desktop: "Mer. 11",
};

// `bg-primary` (et non brand-600, éclairci en sombre) : texte blanc lisible dans
// les deux thèmes, comme les boutons d'action.
function Pastille() {
  return (
    <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-white">
      Aujourd’hui
    </span>
  );
}

export function GrilleJours({
  jours,
  aujourdhuiISO,
  cleAnimation,
  enAttente = false,
  animerEntree = false,
  decor,
  squelette = false,
}: {
  jours: JourGrille[];
  aujourdhuiISO: string | null;
  cleAnimation?: string | number;
  enAttente?: boolean;
  animerEntree?: boolean;
  decor?: (jour: JourGrille, index: number, palier: Palier) => ReactNode;
  /** Squelette de chargement (#400) : libellés de jour en barre, sans pastille. */
  squelette?: boolean;
}) {
  const estAujourdhui = (jour: JourGrille) =>
    !squelette && aujourdhuiISO !== null && jour.dateISO === aujourdhuiISO;
  const libelleJour = (jour: JourGrille, palier: Palier): ReactNode => {
    // Mobile : le libellé est dans la carte du jour (`bg-surface`) ; desktop :
    // sur le fond de page.
    if (squelette) {
      return (
        <TexteSquelette sur={palier === "mobile" ? "carte" : "fond"}>
          {JOUR_FACTICE[palier]}
        </TexteSquelette>
      );
    }
    return palier === "mobile"
      ? libelleJourComplet(jour.dateISO)
      : libelleJourAbrege(jour.dateISO);
  };
  // Entrée en cascade (#69, #337) : 60 ms/jour, `backwards` (cf. token) garde
  // la carte invisible pendant son délai ; motion-safe : rien si l'utilisateur
  // a réduit les animations. Index GLOBAL (pas par rangée) : la cascade suit
  // l'ordre des jours.
  const classeEntree = animerEntree ? "motion-safe:animate-entree-jour" : "";
  const styleEntree = (i: number): CSSProperties | undefined =>
    animerEntree ? { animationDelay: `${delaiJour(i)}ms` } : undefined;
  const classeAttente = enAttente ? "opacity-50" : "";
  const rangees = enRangees(jours.map((jour, index) => ({ jour, index })));

  return (
    <>
      {/* Mobile + tablette (RG-08, #64) : liste verticale jusqu'à lg. La grille
          7 colonnes ne s'active qu'à ≥ 1024px, où chaque cellule reste lisible
          (à md=768 elle tombait à ~120px, badges compressés). */}
      <ul
        key={`grille-mobile-${cleAnimation ?? ""}`}
        className={`space-y-4 transition-opacity duration-200 lg:hidden ${classeAttente}`}
      >
        {jours.map((jour, i) => {
          const aujourdhui = estAujourdhui(jour);
          return (
            <li
              key={jour.cle}
              style={styleEntree(i)}
              // Jour courant : bordure 2px, padding rendu (15 + 2 = 16 + 1).
              className={`relative rounded-lg bg-surface ${
                aujourdhui ? "border-2 border-brand-600 p-[15px]" : "border border-brand-100 p-4"
              } ${classeEntree}`}
            >
              {decor?.(jour, i, "mobile")}
              <h2 className="relative mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-brand-900">
                <span>{libelleJour(jour, "mobile")}</span>
                {aujourdhui && <Pastille />}
              </h2>
              {/* Déjeuner + dîner côte à côte dès sm (#3 : chaque jour tient sur
                  une rangée), empilés sous sm (petits écrans). */}
              <div className="relative grid gap-3 sm:grid-cols-2">{jour.slots}</div>
            </li>
          );
        })}
      </ul>

      {/* Desktop (RG-07, #64) : rangées de 7 colonnes à partir de lg (≥ 1024px). */}
      <div
        key={`grille-desktop-${cleAnimation ?? ""}`}
        className={`hidden flex-col gap-8 transition-opacity duration-200 lg:flex ${classeAttente}`}
      >
        {rangees.map((rangee) => (
          <div
            key={rangee[0].jour.cle}
            data-testid="rangee-jours"
            className="grid grid-cols-7 grid-rows-[auto_auto_auto] gap-3"
          >
            {rangee.map(({ jour, index }) => (
              <section
                key={jour.cle}
                style={styleEntree(index)}
                className={`relative row-span-3 grid grid-cols-1 grid-rows-subgrid ${classeEntree}`}
              >
                {/* `grid-cols-1` = minmax(0, 1fr) : sans lui, la colonne implicite
                    (auto) de la section prend la largeur min-content des cartes
                    et déborde sur la colonne voisine. */}
                {decor?.(jour, index, "desktop")}
                {/* Libellé en bas de sa cellule : il reste aligné avec celui de
                    la colonne du jour courant, plus haute (pastille au-dessus). */}
                <h2 className="relative flex flex-col-reverse items-center justify-start gap-1 text-center text-sm font-semibold uppercase tracking-wide text-brand-700/85">
                  <span>{libelleJour(jour, "desktop")}</span>
                  {estAujourdhui(jour) && <Pastille />}
                </h2>
                {jour.slots}
              </section>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
