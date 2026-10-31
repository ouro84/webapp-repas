// Panier de l'exécuteur Chronodrive (#308) : panier courant et ajouts confirmés (RG-83).
// Protocole : docs/etudes/chronodrive.md, « Protocole relevé ». Pièges : .claude/rules/chronodrive.md.
// Aucun outil de retrait ni de commande ici (RG-82) : `POST v1/carts/{id}/items` seulement.
import { produitVu, versProduit, type Appelant, type Produit } from "./catalogue.ts";
import { ErreurChronodrive } from "./client.ts";

export type LigneAjout = { productId: string; quantite: number };

export type ResultatAjout = {
  productId: string;
  demande: number;
  avant: number;
  apres: number;
  confirme: boolean;
  returnType: string | null;
  erreur: string | null;
};

export type PanierCourant = { id: string; lignes: Map<string, number>; produits: Map<string, Produit> };

const QUANTITE_MAX = 20;

type Brut = Record<string, unknown>;

function objet(valeur: unknown): Brut {
  return typeof valeur === "object" && valeur !== null ? (valeur as Brut) : {};
}

// Panier courant, relu à chaque appel via `customers/me/carts` (clé CUSTOMERS) : après une
// commande validée, son identifiant change, donc jamais de cache de l'id.
export async function lirePanierCourant(client: Appelant): Promise<PanierCourant> {
  const paniers = await client.appeler<unknown>("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" });
  const contenu = objet(paniers).content;
  const brutId = Array.isArray(contenu) ? objet(contenu[0]).id : undefined;
  const id = typeof brutId === "string" || typeof brutId === "number" ? String(brutId) : "";
  if (!id) throw new ErreurChronodrive("panier", "aucun panier courant sur le compte");

  const panier = await client.appeler<unknown>("GET", `/v1/carts/${encodeURIComponent(id)}`, { service: "CARTS" });
  const items = objet(panier).items;
  const lignes = new Map<string, number>();
  const produits = new Map<string, Produit>();
  for (const item of Array.isArray(items) ? items : []) {
    const produit = versProduit(objet(item).product);
    if (!produit.id) continue;
    const quantite = objet(item).quantity;
    // Quantité absente : le produit est présent, donc au moins 1 (comme le spike).
    const n = typeof quantite === "number" && Number.isFinite(quantite) ? quantite : 1;
    lignes.set(produit.id, (lignes.get(produit.id) ?? 0) + n);
    produits.set(produit.id, produit);
  }
  return { id, lignes, produits };
}

function messageErreur(e: unknown): string {
  // Les erreurs du client sont déjà caviardées (RG-80) ; une erreur étrangère ne livre que son nom.
  return e instanceof ErreurChronodrive ? e.message : `erreur inattendue (${e instanceof Error ? e.name : "inconnue"})`;
}

type Envoi = { index: number; quantite: number; plafond: string | null; returnType: string | null; erreurPost: string | null };

// Ajout par lot. Le panier est relu avant, un POST par ligne (le POST incrémente), puis le panier
// est relu une fois. Un ajout n'est confirmé que par l'écart de quantité du produit entre les deux
// lectures (RG-83), jamais au `returnType` (`NO_STOCK_AFTER` ajoute quand même) ni à la présence
// (le produit peut déjà être au panier). Écart < demande : confirmé mais signalé dans `erreur`.
// Un produit dont la fiche connue est indisponible n'est jamais envoyé. La quantité est
// bornée à 1..20, puis à `maxCartQuantity` moins la quantité déjà au panier (lu comme un plafond
// total : prudent si c'est en fait un plafond par ajout, l'écart signale alors le manque).
export async function ajouterLignes(client: Appelant, lignes: LigneAjout[]): Promise<ResultatAjout[]> {
  const avant = await lirePanierCourant(client);
  const resultats: ResultatAjout[] = [];
  const envois: Envoi[] = [];
  const vus = new Set<string>();

  for (const ligne of lignes) {
    const productId = String(ligne.productId);
    const quantiteAvant = avant.lignes.get(productId) ?? 0;
    const resultat: ResultatAjout = {
      productId,
      demande: ligne.quantite,
      avant: quantiteAvant,
      apres: quantiteAvant,
      confirme: false,
      returnType: null,
      erreur: null,
    };
    resultats.push(resultat);

    if (vus.has(productId)) {
      resultat.erreur = "produit en double dans le lot : ligne ignorée, l'écart de quantité ne serait plus attribuable";
      continue;
    }
    vus.add(productId);
    if (!productId) {
      resultat.erreur = "productId vide";
      continue;
    }
    if (!Number.isFinite(ligne.quantite)) {
      resultat.erreur = "quantité invalide";
      continue;
    }
    // Fiche vue en recherche ou en favoris (celle que le LLM a choisie), sinon celle du panier :
    // la fiche du panier peut omettre des champs (maxCartQuantity) qu'elle effacerait.
    const fiche = produitVu(client, productId) ?? avant.produits.get(productId);
    if (fiche && !fiche.disponible) {
      resultat.erreur = `indisponible : ${fiche.raison}`;
      continue;
    }

    let quantite = Math.min(QUANTITE_MAX, Math.max(1, Math.floor(ligne.quantite)));
    let plafond = ligne.quantite > QUANTITE_MAX ? `plafonné à ${QUANTITE_MAX} par ajout` : null;
    if (fiche?.maxPanier != null) {
      const reste = fiche.maxPanier - quantiteAvant;
      if (reste < 1) {
        resultat.erreur = `indisponible : maxCartQuantity (${fiche.maxPanier}) déjà atteint au panier (${quantiteAvant})`;
        continue;
      }
      if (reste < quantite) {
        quantite = reste;
        plafond = `plafonné par maxCartQuantity (${fiche.maxPanier}, déjà ${quantiteAvant} au panier)`;
      }
    }
    envois.push({ index: resultats.length - 1, quantite, plafond, returnType: null, erreurPost: null });
  }

  if (envois.length === 0) return resultats;

  const chemin = `/v1/carts/${encodeURIComponent(avant.id)}/items`;
  for (const envoi of envois) {
    const { productId } = resultats[envoi.index];
    try {
      const reponse = await client.appeler<unknown>("POST", chemin, {
        service: "CARTS",
        corps: { content: [{ clientOrigin: "WEB", productId, quantity: envoi.quantite }], optimizedMode: true },
      });
      const contenu = objet(reponse).content;
      const returnType = Array.isArray(contenu) ? objet(contenu[0]).returnType : undefined;
      envoi.returnType = typeof returnType === "string" ? returnType : null;
    } catch (e) {
      // On continue : l'ajout a pu passer malgré l'erreur, la relecture tranchera.
      envoi.erreurPost = messageErreur(e);
    }
  }

  let apres: PanierCourant;
  try {
    apres = await lirePanierCourant(client);
  } catch (e) {
    for (const envoi of envois) {
      const r = resultats[envoi.index];
      r.returnType = envoi.returnType;
      r.erreur = `ajout envoyé mais panier non relu (${messageErreur(e)}) : vérifier le panier avant de relancer`;
    }
    return resultats;
  }

  for (const envoi of envois) {
    const r = resultats[envoi.index];
    r.returnType = envoi.returnType;
    r.apres = apres.lignes.get(r.productId) ?? 0;
    const ecart = r.apres - r.avant;
    r.confirme = ecart >= 1;
    if (ecart < 1) {
      r.erreur = envoi.erreurPost ?? `ajout non constaté : quantité inchangée au panier (${r.avant}), returnType ${envoi.returnType ?? "absent"}`;
    } else if (ecart < r.demande) {
      r.erreur = `ajout partiel : ${ecart} sur ${r.demande}${envoi.plafond ? ` (${envoi.plafond})` : ""}`;
    }
  }
  return resultats;
}
