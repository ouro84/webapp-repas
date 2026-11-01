// Plafond de quantité de l'exécuteur Chronodrive (#308, run réel #2 : « haricots verts 800 g »
// ajoutés en 2 paquets de 1 kg). Fonctions pures : la quantité OMQ et la contenance du produit
// sont lues dans une même dimension (masse en g, volume en ml, nombre d'unités), et le besoin en
// unités du produit plafonne la quantité demandée par le LLM. Jamais d'augmentation ; dans le doute
// (cuillères, sachet, botte, texte vide ou inconnu, dimensions différentes), aucun plafond.
// Pièges : .claude/rules/chronodrive.md.
import { normaliserTerme } from "./correspondances.ts";

export type Dimension = "masse" | "volume" | "nombre";

// `valeur` en unité de base : grammes, millilitres ou unités.
export type Mesure = { dimension: Dimension; valeur: number };

export type QuantiteAjustee = { demandee: number; envoyee: number };

const UNITES: Record<string, { dimension: Dimension; facteur: number }> = {
  g: { dimension: "masse", facteur: 1 },
  gr: { dimension: "masse", facteur: 1 },
  gramme: { dimension: "masse", facteur: 1 },
  grammes: { dimension: "masse", facteur: 1 },
  kg: { dimension: "masse", facteur: 1000 },
  ml: { dimension: "volume", facteur: 1 },
  cl: { dimension: "volume", facteur: 10 },
  dl: { dimension: "volume", facteur: 100 },
  l: { dimension: "volume", facteur: 1000 },
  litre: { dimension: "volume", facteur: 1000 },
  litres: { dimension: "volume", facteur: 1000 },
  piece: { dimension: "nombre", facteur: 1 },
  pieces: { dimension: "nombre", facteur: 1 },
  unite: { dimension: "nombre", facteur: 1 },
  unites: { dimension: "nombre", facteur: 1 },
  oeuf: { dimension: "nombre", facteur: 1 },
  oeufs: { dimension: "nombre", facteur: 1 },
};

// « 800 g », « 1,5 kg », « 4x100g », « 6 × 50 cl », « 12 œufs », « 6 » (une fois normalisé).
const FORME = /^(\d+(?:[.,]\d+)?)\s*(?:[x×]\s*(\d+(?:[.,]\d+)?)\s*)?([a-z]*)$/;

function nombre(texte: string): number {
  return Number(texte.replace(",", "."));
}

// `nombreNu` : un nombre sans unité vaut un nombre d'unités (oui pour OMQ, non pour une contenance,
// où il ne dit pas ce qu'il compte).
function lireMesure(texte: string, nombreNu: boolean): Mesure | null {
  const m = FORME.exec(normaliserTerme(texte));
  if (!m) return null;
  const [, premier, second, unite] = m;
  const valeur = second === undefined ? nombre(premier) : nombre(premier) * nombre(second);
  if (unite === "") return nombreNu ? { dimension: "nombre", valeur } : null;
  const u = UNITES[unite];
  return u ? { dimension: u.dimension, valeur: valeur * u.facteur } : null;
}

// Quantité OMQ d'un article, ou de plusieurs articles fusionnés sur un même produit, joints par
// « + » (« 160 g + 1 kg ») : somme si toutes les parts se lisent dans la même dimension, sinon null.
export function lireQuantiteOmq(texte: string | null | undefined): Mesure | null {
  if (!texte?.trim()) return null;
  const parts = texte.split("+").map((part) => lireMesure(part, true));
  const [premiere] = parts;
  if (!premiere || parts.some((m) => m?.dimension !== premiere.dimension)) return null;
  return { dimension: premiere.dimension, valeur: parts.reduce((somme, m) => somme + (m?.valeur ?? 0), 0) };
}

// Contenance d'un produit Chronodrive (`unitQuantityLabel`) : « 1 kg », « 6 x 50 cl », « 12 œufs ».
// Une contenance nulle se lit null (pas de division par zéro).
export function lireContenance(texte: string | null | undefined): Mesure | null {
  if (!texte?.trim()) return null;
  const mesure = lireMesure(texte, false);
  return mesure && mesure.valeur > 0 ? mesure : null;
}

// Écart toléré sur le rapport : 1,1 kg / 550 g vaut 2,0000000000000004 en flottants.
const EPSILON = 1e-9;

// Nombre d'unités du produit qui couvre la quantité OMQ (au moins 1), ou null si les deux ne se
// comparent pas.
export function besoinEnUnites(quantiteOmq: string | null | undefined, contenance: string | null | undefined): number | null {
  const besoin = lireQuantiteOmq(quantiteOmq);
  const unite = lireContenance(contenance);
  if (!besoin || !unite || besoin.dimension !== unite.dimension) return null;
  return Math.max(1, Math.ceil(besoin.valeur / unite.valeur - EPSILON));
}

// Quantité à envoyer : `min(demande, besoin)`. `ajustee` n'est renseignée que si le plafond a
// réellement baissé la demande.
export function plafonnerQuantite(
  demande: number,
  quantiteOmq: string | null | undefined,
  contenance: string | null | undefined,
): { envoyee: number; ajustee: QuantiteAjustee | null } {
  const besoin = besoinEnUnites(quantiteOmq, contenance);
  if (besoin === null || besoin >= demande) return { envoyee: demande, ajustee: null };
  return { envoyee: besoin, ajustee: { demandee: demande, envoyee: besoin } };
}
