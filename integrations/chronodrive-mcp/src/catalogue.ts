// Catalogue de l'exécuteur Chronodrive (#308) : fiche produit, disponibilité, favoris, recherche.
// Protocole : docs/etudes/chronodrive.md, « Protocole relevé » (même fiche en recherche, favoris
// et panier). Aucun log : stdout est le canal stdio du MCP.
import type { ClientChronodrive } from "./client.ts";

export type Produit = {
  id: string;
  libelle: string;
  marque: string | null;
  contenance: string | null;
  prix: number | null;
  prixUnite: string | null;
  bio: boolean;
  disponible: boolean;
  raison: string | null;
  maxPanier: number | null;
};

// Ce que le catalogue attend du client : `appeler`, plus `idClient` pour la recherche.
export type Appelant = Pick<ClientChronodrive, "appeler">;
export type AppelantRecherche = Pick<ClientChronodrive, "appeler" | "idClient">;

const TAILLE_PAGE_FAVORIS = 50;
// Garde-fou : un `page.hasNext` toujours vrai ne doit pas faire boucler le run (5 000 favoris).
const PAGES_FAVORIS_MAX = 100;

type Brut = Record<string, unknown>;

function objet(valeur: unknown): Brut {
  return typeof valeur === "object" && valeur !== null ? (valeur as Brut) : {};
}

function nombre(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

function texte(valeur: unknown): string | null {
  if (typeof valeur === "number" && Number.isFinite(valeur)) return String(valeur);
  if (typeof valeur !== "string") return null;
  return valeur.trim() || null;
}

// Disponibilité (réserve du spike, docs/etudes/chronodrive.md : l'heuristique du PoC ignorait
// `stock` et `maxCartQuantity`, et aucun produit hors stock n'a été observé). Un champ absent ou
// non numérique est une inconnue qui ne bloque pas : l'ajout reste confirmé par écart de quantité
// (RG-83). Bloquent seulement : `isEligible === false` ; le stock ≤ 0, lu dans `remainingStock`
// s'il est numérique, sinon dans `stock` ; un `maxCartQuantity` < 1 (même une unité le dépasse).
// Au-delà, `maxCartQuantity` plafonne la quantité ajoutée (src/panier.ts).
function disponibilite(p: Brut): string | null {
  if (p.isEligible === false) return "produit non éligible à la vente sur ce drive (isEligible false)";
  const stock = nombre(p.remainingStock) ?? nombre(p.stock);
  if (stock !== null && stock <= 0) return "rupture de stock";
  const max = nombre(p.maxCartQuantity);
  if (max !== null && max < 1) return `quantité demandée 1 > maxCartQuantity (${max})`;
  return null;
}

export function versProduit(brut: unknown): Produit {
  const p = objet(brut);
  const labels = objet(p.labels);
  const prix = objet(p.prices);
  const raison = disponibilite(p);
  return {
    id: texte(p.id) ?? "",
    libelle: texte(labels.productLabel) ?? "",
    marque: texte(labels.brandLabel),
    contenance: texte(labels.unitQuantityLabel),
    prix: nombre(prix.defaultPrice),
    prixUnite: texte(prix.pricePerUnitMeasure),
    bio: objet(p.flags).isOrganic === true,
    disponible: raison === null,
    raison,
    maxPanier: nombre(p.maxCartQuantity),
  };
}

// Le processus MCP vit aussi longtemps que la gateway Hermes (des jours) : favoris et fiches vues
// expirent après 30 min, pour qu'une rupture levée depuis ne bloque pas un produit revenu en stock.
export const DUREE_FAVORIS_MS = 30 * 60_000;

// Horloge injectable (tests) ; `Date.now` par défaut.
export type OptionsHorloge = { maintenant?: () => number };

// Dernière fiche vue par client (favoris, recherche) : `ajouterLignes` y lit la
// disponibilité et le plafond d'un produit avant de l'envoyer. La fiche la plus récente l'emporte ;
// une fiche de plus de 30 min est ignorée.
const fichesVues = new WeakMap<object, Map<string, { produit: Produit; vueA: number }>>();

export function noterProduits(client: object, produits: Iterable<Produit>, { maintenant = Date.now }: OptionsHorloge = {}): void {
  let vus = fichesVues.get(client);
  if (!vus) fichesVues.set(client, (vus = new Map()));
  const vueA = maintenant();
  for (const produit of produits) if (produit.id) vus.set(produit.id, { produit, vueA });
}

export function produitVu(client: object, productId: string, { maintenant = Date.now }: OptionsHorloge = {}): Produit | undefined {
  const vue = fichesVues.get(client)?.get(productId);
  return vue && maintenant() - vue.vueA <= DUREE_FAVORIS_MS ? vue.produit : undefined;
}

function produitsDe(corps: unknown): Produit[] {
  const contenu = objet(corps).content;
  return (Array.isArray(contenu) ? contenu : []).map(versProduit).filter((p) => p.id !== "");
}

// Favoris gardés en mémoire par client pendant 30 min (DUREE_FAVORIS_MS), puis rechargés.
// Un échec n'est pas mémorisé : l'appel suivant recharge.
const favorisCharges = new WeakMap<object, { promesse: Promise<Produit[]>; chargeA: number }>();

export function chargerFavoris(client: Appelant, options: OptionsHorloge = {}): Promise<Produit[]> {
  const maintenant = options.maintenant ?? Date.now;
  const memoire = favorisCharges.get(client);
  if (memoire && maintenant() - memoire.chargeA <= DUREE_FAVORIS_MS) return memoire.promesse;
  const entree = { promesse: toutesLesPagesDeFavoris(client, options), chargeA: maintenant() };
  favorisCharges.set(client, entree);
  entree.promesse.catch(() => {
    if (favorisCharges.get(client) === entree) favorisCharges.delete(client);
  });
  return entree.promesse;
}

async function toutesLesPagesDeFavoris(client: Appelant, options: OptionsHorloge): Promise<Produit[]> {
  const produits: Produit[] = [];
  for (let page = 1; page <= PAGES_FAVORIS_MAX; page++) {
    const corps = await client.appeler<unknown>("GET", "/v1/favourite-products", {
      service: "FAVOURITE_PRODUCTS",
      params: { page: String(page), size: String(TAILLE_PAGE_FAVORIS) },
    });
    produits.push(...produitsDe(corps));
    if (objet(objet(corps).page).hasNext !== true) break;
  }
  noterProduits(client, produits, options);
  return produits;
}

// Recherche Kamino : l'identifiant client part en en-tête `X-Kamino-User-Id`.
export async function rechercher(client: AppelantRecherche, terme: string, taille = 20, options: OptionsHorloge = {}): Promise<Produit[]> {
  const corps = await client.appeler<unknown>("GET", "/v1/products", {
    service: "PRODUCTS",
    params: { searchTerm: terme, page: "1", size: String(taille), withKamino: "true", kaminoMode: "ADVANCED" },
    entetes: { "X-Kamino-User-Consent": "true", "X-Kamino-User-Id": await client.idClient() },
  });
  const produits = produitsDe(corps);
  noterProduits(client, produits, options);
  return produits;
}
