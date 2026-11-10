// Squelette de la page /ce-soir (#400, RG-09, RG-89) : affiché tant que le
// planning de la semaine n'est pas lu. Il reprend les classes de boîte de la
// page chargée (en-tête, `BadgesRecette` et `ContenuRecette` variante
// "cuisine", pied « Ensuite ») pour ne rien décaler au remplacement (CLS, cf.
// ui.md).
//
// Textes fixes en vrai texte (intitulés « Ingrédients » / « Préparation »),
// données en `TexteSquelette` (moment, nom du plat, ingrédients, étapes),
// contrôles en `Squelette` de leur taille (badges, cases, pastilles, lien).
// Contenu SANS `<main>` ni `ZoneChargement` : l'appelant le place dans
// `<EcranChargement espacement="px-4 py-6 md:py-10">`, qui porte le `role`.
import { CLASSES_TITRE_SECTION_CUISINE } from "@/components/planning/contenu-recette";
import { Squelette, TexteSquelette } from "@/components/ui/squelette";

const INGREDIENTS: readonly [string, string][] = [
  ["Lentilles corail", "250 g"],
  ["Lait de coco", "40 cl"],
  ["Oignon jaune", "1"],
  ["Gousses d’ail", "2"],
  ["Tomates concassées", "400 g"],
  ["Riz basmati", "300 g"],
];

// Environ deux lignes à 592 px de large (`text-lg`).
const ETAPES: readonly string[] = [
  "Émincer l’oignon et l’ail, puis les faire revenir quelques minutes dans un filet d’huile avant d’ajouter les épices.",
  "Verser les lentilles rincées, les tomates et le lait de coco, puis laisser mijoter vingt minutes à feu doux.",
  "Servir bien chaud avec le riz, parsemer de coriandre ciselée et rectifier l’assaisonnement selon les goûts.",
];

export function SqueletteCeSoir() {
  return (
    <>
      <header>
        <p className="text-base font-medium text-brand-700">
          <TexteSquelette>Ce soir</TexteSquelette>
        </p>
        {/* `h1` conservé : même gabarit que le titre chargé (RG-89). */}
        <h1 className="mt-1 font-display text-3xl font-semibold text-balance text-brand-900 md:text-4xl">
          <TexteSquelette>Curry de lentilles corail</TexteSquelette>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* h-5 : hauteur réelle d'un badge (`text-xs` 16 px + `py-0.5`). */}
          <Squelette className="h-5 w-16 rounded-full" />
          <Squelette className="h-5 w-16 rounded-full" />
          <span className="text-sm font-medium text-brand-700/85">
            <TexteSquelette>pour 4 personnes</TexteSquelette>
          </span>
        </div>
      </header>

      <div className="mt-8">
        <section>
          <h2 className={CLASSES_TITRE_SECTION_CUISINE}>Ingrédients</h2>
          <ul className="divide-y divide-brand-100">
            {INGREDIENTS.map(([nom, quantite]) => (
              <li key={nom}>
                {/* `li > div` jumeau du `li > label` chargé (même imbrication
                    que le squelette de /courses : pas de décalage de 1 px). */}
                <div className="flex min-h-11 items-center gap-3 py-2.5">
                  <Squelette className="size-4 shrink-0" />
                  <span className="flex-1 text-sm">
                    <TexteSquelette>{nom}</TexteSquelette>
                  </span>
                  <span className="shrink-0 text-sm font-medium">
                    <TexteSquelette>{quantite}</TexteSquelette>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className={CLASSES_TITRE_SECTION_CUISINE}>Préparation</h2>
          <ol className="flex flex-col gap-5">
            {ETAPES.map((etape) => (
              <li key={etape} className="flex gap-4">
                <Squelette className="size-8 shrink-0 rounded-full" />
                <p className="pt-0.5 text-lg leading-relaxed">
                  <TexteSquelette>{etape}</TexteSquelette>
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="mt-10 flex flex-col gap-4 border-t border-brand-100 pt-6">
        <p className="text-base">
          {/* Sans le préfixe « Ensuite : » (getByText le trouverait dans le
              texte transparent) et court : une ligne à 320 px. */}
          <TexteSquelette>demain midi, poêlée du marché</TexteSquelette>
        </p>
        <div>
          {/* Lien « Voir dans le planning » : `min-h-11` + pilule, donc un contrôle. */}
          <Squelette className="h-11 w-48 rounded-full" />
        </div>
      </footer>
    </>
  );
}
