// Squelette de /recettes (#400, RG-09). Il reprend les classes de boîte ET
// l'imbrication de la liste chargée (`app/recettes/page.tsx`) pour ne rien
// décaler au remplacement (CLS, cf. ui.md) : recherche, bascule de portée,
// filtres, puis `ul > li` de recettes.
//
// Textes fixes en vrai texte (« Végétariennes seulement », « De saison : »),
// données en `TexteSquelette` (nom de recette), contrôles en `Squelette`
// (recherche, bascule, case, select, badge, préférences, boutons de ligne).
// Hauteurs calculées sur le chargé : champ `py-2.5` + `text-sm` + bordure = 42 px,
// bascule `p-0.5` + `py-1.5` + bordure = 38 px, select `py-1.5` = 34 px,
// bouton de ligne `py-2` + `text-sm` = 36 px.
import { Squelette, TexteSquelette, ZoneChargement } from "@/components/ui/squelette";

// Noms factices de longueur plausible (une recette chargée tient sur 1 à 2 lignes),
// absents du catalogue, des fixtures et des e2e : `getByText` lit le texte
// transparent d’un `TexteSquelette`.
const NOMS = [
  "Gratin du marché aux herbes",
  "Poulet rôti et pommes de terre",
  "Galettes de légumes au four",
  "Pâtes à la crème de poireaux",
  "Bol du jardin aux herbes",
  "Salade de riz niçoise",
  "Soupe de potiron",
  "Tarte fine du potager",
  "Tian provençal",
  "Cocotte de légumes mijotés",
];

const BOUTONS_LIGNE = ["w-[5.5rem]", "w-20", "w-[5.5rem]"];

/**
 * En-tête de la page pas encore hydratée (repli Suspense) : mêmes classes que le
 * `header` chargé ; le titre est du vrai texte, le bouton « Nouvelle recette »
 * un bloc (`h-10` = `py-2.5` + `text-sm`) qui s'étire en colonne mobile.
 */
export function SqueletteEnteteRecettes() {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <h1 className="flex-1 font-display text-2xl font-semibold text-brand-900">Mes recettes</h1>
      <div aria-hidden="true" className="contents">
        <Squelette className="h-10 rounded-full sm:w-40" />
      </div>
    </header>
  );
}

/** Corps de la liste en chargement ; porte son propre `role="status"` (pas sous `EcranChargement`). */
export function SqueletteListeRecettes() {
  return (
    <ZoneChargement className="min-h-dvh">
      {/* Recherche : `py-2.5` + `text-sm` + bordure. */}
      <Squelette className="mb-3 h-[42px] w-full rounded-full" />

      {/* Bascule de portée (`inline-flex` chargé, hauteur 38 px). */}
      <Squelette className="mb-3 h-[38px] w-64 rounded-full" />

      {/* Filtres : mêmes classes que la rangée chargée. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex w-fit items-center gap-2 text-sm text-brand-700">
          <Squelette className="size-4 shrink-0 rounded" />
          Végétariennes seulement
        </div>
        <div className="flex w-fit items-center gap-2 text-sm text-brand-700">
          De saison&nbsp;:
          <Squelette className="h-[34px] w-36 rounded-full" />
        </div>
      </div>

      <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-surface">
        {NOMS.map((nom) => (
          <li
            key={nom}
            className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <span className="flex-1 text-sm font-medium text-brand-900">
              <TexteSquelette sur="carte">{nom}</TexteSquelette>
            </span>
            {/* Badge de temps (`px-2 py-0.5 text-xs` = 20 px). */}
            <Squelette sur="carte" className="h-5 w-16 shrink-0 rounded-full" />
            {/* Favori / évité : `TogglePreferenceRecette` (deux `size-8`, `gap-1`). */}
            <div className="inline-flex items-center gap-1">
              <Squelette sur="carte" className="size-8 shrink-0 rounded-full" />
              <Squelette sur="carte" className="size-8 shrink-0 rounded-full" />
            </div>
            {/* Dupliquer / Modifier / Supprimer. */}
            {BOUTONS_LIGNE.map((largeur, i) => (
              <Squelette key={i} sur="carte" className={`h-9 shrink-0 rounded-full ${largeur}`} />
            ))}
          </li>
        ))}
      </ul>
    </ZoneChargement>
  );
}
