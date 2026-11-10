// Squelette de /courses (#400, RG-09) : affiché tant que la page n'est pas
// hydratée et que le cycle n'est pas résolu (prérendu + repli Suspense). Il
// reprend les classes de boîte ET l'imbrication de l'état chargé (`header`,
// `NavigateurCycle`, sections de catégories, `ArticleCochable`) pour ne rien
// décaler au remplacement (CLS, cf. ui.md).
//
// Textes fixes en vrai texte (titre, « Fond de placard »), données en
// `TexteSquelette` (noms de catégories et d'articles, quantités, compteurs :
// la liste réelle peut ne pas avoir ces catégories), contrôles en `Squelette`.
// Contenu SANS `<main>` ni zone de chargement : l'appelant le place dans
// `<EcranChargement>`, qui fournit le `<main>` de l'état chargé et l'unique
// `role="status"`. La carte Panier Chronodrive (conditionnelle, sous la liste)
// n'est pas réservée.
import { Users } from "lucide-react";

import { SqueletteNavigateurPeriode } from "@/components/planning/squelette-planning";
import { Squelette, TexteSquelette } from "@/components/ui/squelette";

// Classes du bouton de titre de section (`h2 > button` de la page chargée) ; le
// squelette utilise un `span` (un `div` dans un `h2` est invalide).
const TITRE_SECTION =
  "flex min-h-11 w-full items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide";

type LigneSquelette = { nom: string; quantite?: string };

const CATEGORIES: { titre: string; lignes: LigneSquelette[] }[] = [
  {
    titre: "Fruits et légumes",
    lignes: [
      { nom: "Carottes", quantite: "1 kg" },
      { nom: "Oignons jaunes", quantite: "4" },
      { nom: "Courgettes", quantite: "3" },
      { nom: "Citron", quantite: "2" },
      { nom: "Coriandre", quantite: "1 bouquet" },
    ],
  },
  {
    titre: "Crèmerie",
    lignes: [
      { nom: "Crème fraîche épaisse", quantite: "20 cl" },
      { nom: "Gruyère râpé", quantite: "200 g" },
      { nom: "Yaourts nature", quantite: "4" },
    ],
  },
  {
    titre: "Épicerie",
    lignes: [
      { nom: "Lentilles corail", quantite: "250 g" },
      { nom: "Lait de coco", quantite: "40 cl" },
      { nom: "Riz basmati", quantite: "300 g" },
      { nom: "Pâtes penne", quantite: "500 g" },
    ],
  },
];

const FOND_DE_PLACARD: LigneSquelette[] = [
  { nom: "Huile d’olive" },
  { nom: "Sel, poivre" },
  { nom: "Pâte de curry", quantite: "2 c. à soupe" },
];

// Ligne en squelette : `li > div` comme `li > label` chargé (la bordure du
// `divide-y` compte DANS le `li`, donc même nesting, sinon 1 px de dérive par
// ligne). `sur` : teinte de la carte (`bg-surface`), du fond ou du fond de
// placard (`bg-accent-50`). `placard` : la ligne du fond de placard n'a pas de
// `px-4`.
function LigneArticle({
  nom,
  quantite,
  sur,
  placard = false,
}: LigneSquelette & { sur: "fond" | "carte" | "placard"; placard?: boolean }) {
  return (
    <li className="relative flex items-center">
      <div
        className={`relative flex min-h-11 flex-1 items-center gap-3 py-2.5 ${placard ? "" : "px-4"}`}
      >
        <Squelette sur={sur} className="size-4 shrink-0 rounded" />
        <span className="flex-1 text-sm">
          <TexteSquelette sur={sur}>{nom}</TexteSquelette>
        </span>
        {quantite !== undefined && (
          <span className="shrink-0 text-sm font-medium">
            <TexteSquelette sur={sur}>{quantite}</TexteSquelette>
          </span>
        )}
      </div>
    </li>
  );
}

export function SqueletteCourses() {
  return (
    <>
      {/* En-tête : classes de la page chargée. */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-brand-900">Liste de courses</h1>
          {/* Navigateur de cycle (`NavigateurCycle`) : flèches + libellé, puis « Couvre N j » et ± `size-6`. */}
          <div className="mt-2 flex flex-col gap-2">
            <SqueletteNavigateurPeriode />
            <div className="flex items-center gap-2 text-xs text-brand-700/85">
              <span>
                <TexteSquelette>Couvre 7 j</TexteSquelette>
              </span>
              <Squelette className="size-6 shrink-0 rounded-full" />
              <Squelette className="size-6 shrink-0 rounded-full" />
            </div>
          </div>
          {/* Progression (compteur : donnée). Texte factice sans « coché » : les
              e2e lisent le compteur réel par /\d+ cochés? sur \d+/ comme preuve
              d’une liste chargée, et `getByText` lit le texte transparent. */}
          <p className="text-sm text-brand-700/85">
            <TexteSquelette>progression liste</TexteSquelette>
          </p>
          {/* Deux lignes `mt-1 text-xs` toujours montées dans l'état chargé, vides :
              même gabarit (la seconde garde l'icône `size-3.5` qui fixe sa hauteur). */}
          <p className="mt-1 text-xs text-brand-700/85 opacity-0" />
          <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-700/85 opacity-0">
            <Users aria-hidden="true" className="size-3.5 shrink-0" />
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* « Ajouter un article » et « ← Planning » : `h-[38px]` = py-2 + text-sm + bordure. */}
          <Squelette className="h-[38px] w-[10.5rem] rounded-full" />
          <Squelette className="h-[38px] w-[6.5rem] rounded-full" />
        </div>
      </header>

      <div className="space-y-6">
        {CATEGORIES.map(({ titre, lignes }) => (
          <section key={titre}>
            <h2 className="relative mb-2">
              <span className={`relative ${TITRE_SECTION}`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <TexteSquelette>{titre}</TexteSquelette>
                </span>
                <Squelette className="size-4 shrink-0" />
              </span>
            </h2>
            <ul className="divide-y divide-brand-100 rounded-lg border border-brand-100 bg-surface">
              {lignes.map((ligne) => (
                <LigneArticle key={ligne.nom} {...ligne} sur="carte" />
              ))}
            </ul>
          </section>
        ))}

        {/* Fond de placard : le titre et l'intitulé sont du texte fixe. Teinte
            `fond` (pas de token accent) : lisible sur `bg-accent-50`. */}
        <section className="rounded-lg bg-accent-50 p-4">
          <h2>
            <span className={`${TITRE_SECTION} text-accent-700`}>
              Fond de placard
              <Squelette sur="placard" className="size-4 shrink-0" />
            </span>
          </h2>
          <p className="mb-2 text-xs text-accent-700">À vérifier avant d’acheter</p>
          <ul className="divide-y divide-accent-100">
            {FOND_DE_PLACARD.map((ligne) => (
              <LigneArticle key={ligne.nom} {...ligne} sur="placard" placard />
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
