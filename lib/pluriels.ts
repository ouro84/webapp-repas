// Accord en nombre des libellés de la liste de courses — logique pure (#33).
//
// Deux accords distincts, selon ce qui est compté :
//   - unité `piece` : c'est le NOM qui est compté → on l'accorde
//     (« 1 carotte » / « 3 carottes »). cf. accorderNom.
//   - unités conteneur (`sachet`, `boite`…) : c'est le mot d'unité qui est
//     compté, le nom est le contenu → on accorde le LIBELLÉ d'unité
//     (« 2 sachets de taboulé »). cf. accorderLibelleUnite.
//   - mesures (g, ml, cl, kg, l, c.à.s, c.à.c) : noms de masse, jamais
//     accordés (« 200 g de beurre », pas « beurres »).
//
// Le pluriel français n'est pas mécanisable à 100 % : un algorithme régulier
// (conscient des connecteurs « de / à / en… » pour n'accorder que la tête)
// couvre la majorité des cas, une table d'exceptions traite les formes déjà
// au pluriel dans les données, les composés irréguliers et les invariants
// (marques, noms de masse vendus à la pièce). Hors table et hors règle sûre,
// on laisse la forme inchangée plutôt que de risquer une faute.

import type { Ingredient, Unite } from "@/types"

// Clé de lookup normalisée : minuscules, ligatures dépliées (œ→oe), accents
// retirés, espaces réduits. Permet d'écrire les clés de la table en ASCII
// sans se soucier de l'encodage exact des noms du dataset.
function cle(nom: string): string {
  return nom
    .toLocaleLowerCase("fr")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques décomposés par NFD
    .replace(/\s+/g, " ")
    .trim()
}

type Formes = { s: string; p: string }

// Exceptions : clé normalisée → { singulier, pluriel } exacts (accents inclus).
// Catégories : formes stockées au pluriel dans le dataset, composés irréguliers,
// annotations entre parenthèses, et invariants (marques, masses à la pièce).
const EXCEPTIONS: Record<string, Formes> = {
  // -- formes stockées au pluriel : on fournit le singulier --
  betteraves: { s: "betterave", p: "betteraves" },
  carottes: { s: "carotte", p: "carottes" },
  champignons: { s: "champignon", p: "champignons" },
  croissants: { s: "croissant", p: "croissants" },
  navets: { s: "navet", p: "navets" },
  tomates: { s: "tomate", p: "tomates" },
  wraps: { s: "wrap", p: "wraps" },
  oeufs: { s: "œuf", p: "œufs" },
  poireaux: { s: "poireau", p: "poireaux" }, // -eau → -eaux
  "patates douces": { s: "patate douce", p: "patates douces" },
  "olives vertes": { s: "olive verte", p: "olives vertes" },
  "cordons bleus": { s: "cordon bleu", p: "cordons bleus" },
  "steaks haches": { s: "steak haché", p: "steaks hachés" },
  // -- composés : la tête s'accorde, le complément reste --
  "champignons de paris": { s: "champignon de Paris", p: "champignons de Paris" },
  "escalopes de dinde": { s: "escalope de dinde", p: "escalopes de dinde" },
  "cuisses de canard confites": {
    s: "cuisse de canard confite",
    p: "cuisses de canard confites",
  },
  "cotes de porc": { s: "côte de porc", p: "côtes de porc" },
  "paves de saumon": { s: "pavé de saumon", p: "pavés de saumon" },
  "bouquet garnis": { s: "bouquet garni", p: "bouquets garnis" },
  // -- pluriel irrégulier / mots composés à trait d'union --
  "chou-fleur": { s: "chou-fleur", p: "choux-fleurs" },
  // -- annotations entre parenthèses --
  "jambon blanc (tranche)": {
    s: "jambon blanc (tranche)",
    p: "jambon blanc (tranches)",
  },
  "jambon cru (tranches)": {
    s: "jambon cru (tranche)",
    p: "jambon cru (tranches)",
  },
  "roti de porc (tranches)": {
    s: "rôti de porc (tranche)",
    p: "rôtis de porc (tranches)",
  },
  // -- invariants : marques, variétés, noms de masse vendus « à la pièce » --
  croustibat: { s: "croustibat", p: "croustibat" },
  kubor: { s: "kubor", p: "kubor" },
  "bun's ketchup": { s: "bun's ketchup", p: "bun's ketchup" },
  "osso bucco de veau": { s: "osso bucco de veau", p: "osso bucco de veau" },
  "navets boule d'or": { s: "navet boule d'or", p: "navets boule d'or" },
  "laitue iceberg": { s: "laitue iceberg", p: "laitues iceberg" },
  "pain burger": { s: "pain burger", p: "pains burger" },
  "sauce curry": { s: "sauce curry", p: "sauce curry" },
  "sauce cesar": { s: "sauce césar", p: "sauce césar" },
  "thon en boite": { s: "thon en boîte", p: "thon en boîte" },
  "pulpe de tomates": { s: "pulpe de tomates", p: "pulpe de tomates" },
  "lentilles (boite)": { s: "lentilles (boîte)", p: "lentilles (boîte)" },
  "ratatouille boite": { s: "ratatouille boîte", p: "ratatouille boîte" },
  mais: { s: "maïs", p: "maïs" },
  feta: { s: "feta", p: "feta" },
}

// Connecteurs (normalisés) : tout mot situé à partir du premier connecteur
// reste invariable — seule la tête de l'expression s'accorde.
const CONNECTEURS: ReadonlySet<string> = new Set([
  "de", "d'", "des", "du", "a", "au", "aux", "en", "la", "le", "les", "l'",
])

// Pluriel régulier d'un mot isolé.
function pluraliserMot(mot: string): string {
  if (/[sxz]$/i.test(mot)) return mot // déjà invariable en nombre
  if (/(au|eu)$/i.test(mot)) return mot + "x" // tuyau → tuyaux
  if (/al$/i.test(mot)) return mot.slice(0, -2) + "aux" // -al → -aux
  return mot + "s"
}

// Accord régulier d'une expression : on accorde les mots jusqu'au premier
// connecteur (« poivron jaune » → « poivrons jaunes » ; « blanc de poulet »
// → « blancs de poulet »). Les parenthèses sont laissées telles quelles.
function pluraliserExpression(nom: string): string {
  let connecteurAtteint = false
  return nom
    .split(" ")
    .map((mot) => {
      const normalise = cle(mot)
      if (connecteurAtteint || mot.startsWith("(")) return mot
      if (CONNECTEURS.has(normalise)) {
        connecteurAtteint = true
        return mot
      }
      return pluraliserMot(mot)
    })
    .join(" ")
}

/**
 * Accorde le NOM d'un ingrédient selon sa quantité (#33) — uniquement pour
 * l'unité `piece` (le nom est alors le comptable). quantité < 2 → singulier,
 * ≥ 2 → pluriel. Toute autre unité renvoie le nom inchangé.
 */
export function accorderNom(ingredient: Ingredient): string {
  if (ingredient.unite !== "piece") return ingredient.nom

  const exception = EXCEPTIONS[cle(ingredient.nom)]
  if (exception) {
    return ingredient.quantite >= 2 ? exception.p : exception.s
  }
  return ingredient.quantite >= 2
    ? pluraliserExpression(ingredient.nom)
    : ingredient.nom
}

// Unités conteneur dont le LIBELLÉ s'accorde (« 2 sachets »).
const UNITES_CONTENEUR: ReadonlySet<Unite> = new Set([
  "sachet", "boite", "bouteille", "briquette",
])

/**
 * Accorde le libellé d'une unité conteneur selon la quantité (#33) :
 * « sachet » → « sachets » à partir de 2. Les autres libellés (g, c.à.s…)
 * sont déjà invariables et renvoyés tels quels.
 */
export function accorderLibelleUnite(
  libelle: string,
  unite: Unite,
  quantite: number
): string {
  if (!UNITES_CONTENEUR.has(unite) || quantite < 2) return libelle
  return pluraliserMot(libelle)
}
