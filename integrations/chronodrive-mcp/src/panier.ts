// Panier de l'exécuteur Chronodrive (#308) : panier courant et ajouts confirmés (RG-83).
// Protocole : docs/etudes/chronodrive.md, « Protocole relevé ». Pièges : .claude/rules/chronodrive.md.
// Aucune commande ici (RG-82) : `POST v1/carts/{id}/items` (ajout) et, hors run seulement,
// `DELETE v1/carts/{id}/items/{productId}` (vidage, #320).
import { produitVu, versProduit, type Appelant, type OptionsHorloge, type Produit } from "./catalogue.ts";
import { ErreurChronodrive, erreurDeConnexion } from "./client.ts";
import { plafonnerQuantite, type QuantiteAjustee } from "./quantites.ts";

// `refus` : refus décidé par l'appelant avant tout envoi (garde par terme de `ajouter_au_panier`,
// src/outils.ts) ; la ligne n'est pas envoyée et ne compte pas comme doublon.
// `quantiteOmq` : texte de la quantité OMQ de l'article (« 800 g », « 2 c.à.s + 160 g »), qui
// plafonne la quantité avec la contenance du produit (src/quantites.ts).
export type LigneAjout = { productId: string; quantite: number; quantiteOmq?: string | null; refus?: string | null };

// `demande` : quantité retenue après le plafond OMQ, avant les plafonds 20 / maxCartQuantity ;
// `quantiteAjustee` n'est renseignée que si ce plafond l'a baissée ET que l'ajout est confirmé
// (null sur une ligne non envoyée ou non confirmée : rien n'a été ajouté).
export type ResultatAjout = {
  productId: string;
  demande: number;
  avant: number;
  apres: number;
  confirme: boolean;
  returnType: string | null;
  erreur: string | null;
  quantiteAjustee: QuantiteAjustee | null;
};

export type PanierCourant = { id: string; lignes: Map<string, number>; produits: Map<string, Produit> };

// `produits` : fiches du panier relu après les ajouts (vide s'il n'a pas pu être relu).
export type BilanAjout = { resultats: ResultatAjout[]; produits: Map<string, Produit> };

const QUANTITE_MAX = 20;
// Budget d'un lot : au-delà, plus aucun POST (la relecture finale a quand même lieu), pour que
// l'appel d'outil réponde avant le délai de Hermes.
export const BUDGET_LOT_MS = 90_000;
export const PRODUIT_INCONNU = "produit inconnu ou vu il y a plus de 30 min : relance chercher_produits";
export const NON_TENTE = "non tenté : délai du lot dépassé";
// POST abandonné faute de réponse et sans écart constaté : Chronodrive a pu l'appliquer après la
// relecture. Jamais un simple « non confirmé » : la skill le traite comme « peut-être ajouté ».
export const PEUT_ETRE_APPLIQUE = "ajout peut-être appliqué (délai dépassé) : à vérifier dans le panier";
// Origine d'ajout envoyée telle quelle par le spike, dont les ajouts ont réussi
// (docs/etudes/chronodrive.md, « Protocole relevé », ligne « Ajouter »).
const CLIENT_ORIGIN = "WEB|SEARCH|TG|/promotions";

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
  if (!id) {
    // Le mode est fixé par la config : pas de repli DRIVE → HOME_DELIVERY comme au spike.
    throw new ErreurChronodrive("panier", "aucun panier courant sur le compte pour ce drive : vérifier CHRONODRIVE_SITE_ID et CHRONODRIVE_MODE dans chronodrive.env");
  }

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

// Relecture finale du panier, retentée une fois : la seconde tentative absorbe un échec isolé.
async function relirePanier(client: Appelant): Promise<{ panier: PanierCourant | null; erreur: unknown }> {
  let erreur: unknown = null;
  for (let essai = 0; essai < 2; essai++) {
    try {
      return { panier: await lirePanierCourant(client), erreur: null };
    } catch (e) {
      erreur = e;
    }
  }
  return { panier: null, erreur };
}

type Envoi = {
  index: number;
  quantite: number;
  plafond: string | null;
  ajustee: QuantiteAjustee | null;
  tente: boolean;
  returnType: string | null;
  erreurPost: string | null;
};

// Ajout par lot. Le panier est relu avant, un POST par ligne (le POST incrémente), puis le panier
// est relu une fois (une seconde tentative si cette relecture échoue). Un ajout n'est confirmé que
// par l'écart de quantité du produit entre les deux lectures (RG-83), jamais au `returnType`
// (`NO_STOCK_AFTER` ajoute quand même) ni à la présence (le produit peut déjà être au panier).
// Écart < demande : confirmé mais signalé dans `erreur`.
// Une ligne refusée par l'appelant (`refus`) n'est pas envoyée. Seul un produit vu en recherche ou
// en favoris depuis moins de 30 min est envoyé, et jamais s'il y est indisponible : un `productId`
// inventé ou périmé est refusé sans POST. La quantité doit être un entier ≥ 1, plafonné d'abord au
// besoin calculé depuis `quantiteOmq` et la contenance de la fiche vue (src/quantites.ts), puis à 20,
// puis à `maxCartQuantity` moins la quantité déjà au panier (lu comme
// un plafond total : prudent si c'est en fait un plafond par ajout, l'écart signale alors le manque).
// Budget du lot : 90 s ; au-delà, les lignes restantes reviennent « non tenté », sans POST.
export async function ajouterLignes(client: Appelant, lignes: LigneAjout[], options: OptionsHorloge = {}): Promise<BilanAjout> {
  const maintenant = options.maintenant ?? Date.now;
  const debut = maintenant();
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
      quantiteAjustee: null,
    };
    resultats.push(resultat);

    if (!productId) {
      resultat.erreur = "productId vide";
      continue;
    }
    if (ligne.refus) {
      resultat.erreur = ligne.refus;
      continue;
    }
    if (vus.has(productId)) {
      resultat.erreur = "produit en double dans le lot : ligne ignorée, l'écart de quantité ne serait plus attribuable";
      continue;
    }
    vus.add(productId);
    if (!Number.isInteger(ligne.quantite) || ligne.quantite < 1) {
      resultat.erreur = "quantité invalide : entier de 1 à 20 attendu";
      continue;
    }
    // Fiche vue en recherche ou en favoris (celle que le LLM a choisie). La fiche du panier ne
    // suffit pas : elle peut omettre des champs (maxCartQuantity) et ne prouve pas que le LLM a vu le produit.
    const fiche = produitVu(client, productId, options);
    if (!fiche) {
      resultat.erreur = PRODUIT_INCONNU;
      continue;
    }
    if (!fiche.disponible) {
      resultat.erreur = `indisponible : ${fiche.raison}`;
      continue;
    }

    // Plafond OMQ (run réel #2 : 800 g de haricots verts ajoutés en 2 paquets de 1 kg) : jamais
    // d'augmentation ; `demande` devient la quantité retenue, l'ajustement n'est rapporté qu'après
    // confirmation.
    const { envoyee, ajustee } = plafonnerQuantite(ligne.quantite, ligne.quantiteOmq, fiche.contenance);
    resultat.demande = envoyee;

    let quantite = Math.min(QUANTITE_MAX, envoyee);
    let plafond = envoyee > QUANTITE_MAX ? `plafonné à ${QUANTITE_MAX} par ajout` : null;
    if (fiche.maxPanier != null) {
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
    envois.push({ index: resultats.length - 1, quantite, plafond, ajustee, tente: false, returnType: null, erreurPost: null });
  }

  if (envois.length === 0) return { resultats, produits: new Map() };

  const chemin = `/v1/carts/${encodeURIComponent(avant.id)}/items`;
  for (const envoi of envois) {
    const { productId } = resultats[envoi.index];
    if (maintenant() - debut > BUDGET_LOT_MS) continue;
    envoi.tente = true;
    try {
      const reponse = await client.appeler<unknown>("POST", chemin, {
        service: "CARTS",
        corps: { content: [{ clientOrigin: CLIENT_ORIGIN, productId, quantity: envoi.quantite }], optimizedMode: true },
      });
      const contenu = objet(reponse).content;
      const returnType = Array.isArray(contenu) ? objet(contenu[0]).returnType : undefined;
      envoi.returnType = typeof returnType === "string" ? returnType : null;
    } catch (e) {
      // On continue : l'ajout a pu passer malgré l'erreur, la relecture tranchera.
      envoi.erreurPost = e instanceof ErreurChronodrive && e.delaiDepasse ? PEUT_ETRE_APPLIQUE : messageErreur(e);
    }
  }

  for (const envoi of envois) if (!envoi.tente) resultats[envoi.index].erreur = NON_TENTE;
  const tentes = envois.filter((envoi) => envoi.tente);

  // Relecture finale retentée une fois : sans elle, rien n'est confirmé ni coché (RG-83).
  const { panier: apres, erreur: erreurRelecture } = await relirePanier(client);
  if (!apres) {
    for (const envoi of tentes) {
      const r = resultats[envoi.index];
      r.returnType = envoi.returnType;
      r.erreur = `ajout envoyé mais panier non relu (${messageErreur(erreurRelecture)}) : vérifier le panier avant de relancer`;
    }
    return { resultats, produits: new Map() };
  }

  for (const envoi of tentes) {
    const r = resultats[envoi.index];
    r.returnType = envoi.returnType;
    r.apres = apres.lignes.get(r.productId) ?? 0;
    const ecart = r.apres - r.avant;
    r.confirme = ecart >= 1;
    if (r.confirme) r.quantiteAjustee = envoi.ajustee;
    if (ecart < 1) {
      r.erreur = envoi.erreurPost ?? `ajout non constaté : quantité inchangée au panier (${r.avant}), returnType ${envoi.returnType ?? "absent"}`;
    } else if (ecart < r.demande) {
      r.erreur = `ajout partiel : ${ecart} sur ${r.demande}${envoi.plafond ? ` (${envoi.plafond})` : ""}`;
    }
  }
  return { resultats, produits: apres.produits };
}

export type StatutRetrait = "simulee" | "retiree" | "toujours_au_panier" | "non_tente" | "non_verifie";

// `quantite` : quantité au panier avant le retrait. `erreur` : message de l'erreur du DELETE
// (messageErreur, pas messagePourLeLlm : outils.ts importe panier.ts).
export type LigneRetrait = {
  productId: string;
  libelle: string;
  marque: string | null;
  quantite: number;
  statut: StatutRetrait;
  erreur: string | null;
};

// `vide` : vrai seulement si la relecture finale a été faite et ne montre aucune ligne.
// `relu` : faux si cette relecture a échoué deux fois, ou si elle montre un autre panier (commande
// validée pendant le script).
// `restantes` : nombre de lignes du panier relu après le vidage (ajout concurrent compris), `null`
// sans relecture ; en simulation, la taille du panier lu.
export type BilanVidage = { panierId: string; simulation: boolean; lignes: LigneRetrait[]; vide: boolean; relu: boolean; restantes: number | null };

// Vidage du panier courant (#320, RG-82), réservé au hors run : un DELETE par ligne, en série
// (ordre déterministe, pas de rafale vers Chronodrive). Un retrait n'est confirmé que par la
// relecture du panier, jamais par la réponse du DELETE (2xx sans effet possible). Une erreur sur
// une ligne n'arrête pas les autres, sauf une erreur de connexion (les lignes suivantes restent
// « non tentées » : sinon chacune retenterait un login). En simulation, aucun DELETE.
export async function viderPanier(client: Appelant, options: { simulation: boolean }): Promise<BilanVidage> {
  const avant = await lirePanierCourant(client);
  const lignes: LigneRetrait[] = [...avant.lignes].map(([productId, quantite]) => ({
    productId,
    libelle: avant.produits.get(productId)?.libelle ?? productId,
    marque: avant.produits.get(productId)?.marque ?? null,
    quantite,
    statut: options.simulation ? "simulee" : "non_tente",
    erreur: null,
  }));
  if (options.simulation || lignes.length === 0) {
    return { panierId: avant.id, simulation: options.simulation, lignes, vide: lignes.length === 0, relu: true, restantes: avant.lignes.size };
  }

  const tentees: LigneRetrait[] = [];
  const base = `/v1/carts/${encodeURIComponent(avant.id)}/items`;
  for (const ligne of lignes) {
    tentees.push(ligne);
    try {
      await client.appeler<unknown>("DELETE", `${base}/${encodeURIComponent(ligne.productId)}`, { service: "CARTS" });
    } catch (e) {
      ligne.erreur = messageErreur(e);
      // Arrêt du lot, pas de la relecture finale : elle garde ses deux essais (le total reste borné)
      // et, si elle aboutit, le bilan reste vrai.
      if (erreurDeConnexion(e)) break;
    }
  }

  const { panier: apres } = await relirePanier(client);
  // Un autre identifiant (commande validée pendant le script) : ce n'est plus le panier vidé, rien
  // ne se confirme.
  if (!apres || apres.id !== avant.id) {
    for (const ligne of tentees) ligne.statut = "non_verifie";
    return { panierId: avant.id, simulation: false, lignes, vide: false, relu: false, restantes: null };
  }
  for (const ligne of tentees) ligne.statut = apres.lignes.has(ligne.productId) ? "toujours_au_panier" : "retiree";
  return { panierId: avant.id, simulation: false, lignes, vide: apres.lignes.size === 0, relu: true, restantes: apres.lignes.size };
}
