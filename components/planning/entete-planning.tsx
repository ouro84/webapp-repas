// En-tête partagé des vues Semaine et Cycle de /planning (#352) : titre, bascule
// Semaine | Cycle, actions (réglages, régénérer, liste de courses), légende des
// badges, puis le navigateur de période. Présentatif : l'appelant fournit les
// libellés et les callbacks, et décide du navigateur (rendu après hydratation).

import Link from "next/link";
import type { ReactNode } from "react";
import { Carrot, Leaf, SlidersHorizontal, Sun, Wheat } from "lucide-react";

// Vue affichée sur /planning (#260, PR3) ; persistée dans `storeVuePlanning` (#279, D5).
export type VuePlanning = "semaine" | "cycle";

// Bascule de vue « Semaine | Cycle » (#260, PR3) : segmented control. La vue
// semaine (défaut) est le driver quotidien ; la vue cycle cale l'affichage sur
// la fenêtre de la liste de courses.
export function BasculeVue({
  vue,
  onChange,
}: {
  vue: VuePlanning;
  onChange: (v: VuePlanning) => void;
}) {
  const base =
    "relative rounded-full px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
  return (
    <div
      role="group"
      aria-label="Vue du planning"
      className="inline-flex rounded-full border border-brand-200 p-0.5"
    >
      <button
        type="button"
        aria-pressed={vue === "semaine"}
        onClick={() => onChange("semaine")}
        className={`${base} ${vue === "semaine" ? "bg-primary text-white" : "text-brand-700 hover:bg-brand-50"}`}
      >
        Semaine
      </button>
      <button
        type="button"
        aria-pressed={vue === "cycle"}
        onClick={() => onChange("cycle")}
        className={`${base} ${vue === "cycle" ? "bg-primary text-white" : "text-brand-700 hover:bg-brand-50"}`}
      >
        Cycle
      </button>
    </div>
  );
}

// Légende des pictogrammes (#210, audit critique — reconnaissance plutôt que
// rappel) : les badges compacts des cartes (Leaf/Wheat/Carrot) n'avaient de sens
// explicité que dans /aide, jamais ici où ils apparaissent réellement. Une
// ligne, une fois pour toute la page — pas répétée par carte.
export function LegendeBadges() {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-700/85">
      <span className="inline-flex items-center gap-1">
        <Leaf aria-hidden="true" className="size-3.5 text-brand-600" />
        Végétarien
      </span>
      <span className="inline-flex items-center gap-1">
        <Wheat aria-hidden="true" className="size-3.5 text-accent-600" />
        Féculents
      </span>
      <span className="inline-flex items-center gap-1">
        <Carrot aria-hidden="true" className="size-3.5 text-brand-600" />
        Légumes
      </span>
      <span className="inline-flex items-center gap-1">
        <Sun aria-hidden="true" className="size-3.5 text-brand-600" />
        De saison
      </span>
    </p>
  );
}

export function EntetePlanning({
  titre,
  vue,
  onChangerVue,
  libelleRegenerer,
  onRegenerer,
  regenerationEnCours,
  hrefCourses,
  statut,
  navigateur,
}: {
  titre: string;
  vue: VuePlanning;
  onChangerVue: (v: VuePlanning) => void;
  libelleRegenerer: string;
  onRegenerer: () => void;
  regenerationEnCours: boolean;
  hrefCourses: string;
  // Indicateur discret sous le titre (synchro de la vue Semaine, US-13).
  statut?: ReactNode;
  // Navigateur de période (#352), sous la légende ; absent tant que la date
  // client n'est pas connue (hydratation).
  navigateur?: ReactNode;
}) {
  return (
    <>
      {/*
        #65 — Sur mobile le header s'empile : le titre prend toute la largeur
        (≤ 2 lignes au lieu de 4, le premier repas remonte au-dessus de la
        ligne de flottaison), les actions sur une rangée en dessous. À partir
        de sm, retour à la disposition titre + actions sur une ligne.
      */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-brand-900">{titre}</h1>
          {statut}
        </div>
        {/* Actions : pleine largeur partagée sur mobile, compactes dès sm.
            after:-inset-1 étend la zone tactile à ≥ 44px sans changer le visuel. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Bascule Semaine | Cycle (#260, PR3). */}
          <BasculeVue vue={vue} onChange={onChangerVue} />
          {/* Accès contextuel aux réglages de génération (#206, audit #51) :
              l'intention « ce planning ne me ressemble pas » naît ici → on
              rapproche le levier de l'action, au lieu de l'enfouir dans /profil.
              Icône seule (place limitée sur mobile à côté des deux CTA). */}
          <Link
            href="/reglages"
            aria-label="Réglages de génération"
            title="Réglages de génération"
            className="relative flex size-10 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.95] motion-reduce:active:scale-100"
          >
            <SlidersHorizontal className="size-5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onRegenerer}
            disabled={regenerationEnCours}
            aria-busy={regenerationEnCours}
            className="relative flex-1 rounded-full border border-brand-200 px-4 py-2 text-center text-sm font-medium text-brand-700 transition after:absolute after:-inset-1 after:content-[''] hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-60 sm:flex-none"
          >
            {libelleRegenerer}
          </button>
          <Link
            href={hrefCourses}
            className="relative flex-1 rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-white transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:flex-none"
          >
            Liste de courses →
          </Link>
        </div>
      </header>

      <LegendeBadges />

      {navigateur && <div className="mb-6">{navigateur}</div>}
    </>
  );
}
