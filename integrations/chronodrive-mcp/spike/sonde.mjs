// Spike #307 — CLI de sonde : node sonde.mjs <commande> [args], sortie JSON sur stdout.
// Aucune commande de commande, créneau ni paiement (RG-82).
import {
  chargerEnv,
  ouvrirSession,
  lirePanier,
  ajouterAuPanier,
  retirerDuPanier,
  listerFavoris,
  rechercherProduits,
} from "./client.mjs";

const [commande, ...args] = process.argv.slice(2);

const commandes = {
  async login() {
    const s = await ouvrirSession({ forcerLogin: true });
    return { ok: true, expireDans: Math.round((s.expireA - Date.now()) / 1000), offlineAccess: Boolean(s.jetonRafraichissement), mode: s.mode, champsJeton: s.champsJeton, scopeAccorde: s.scopeAccorde };
  },
  async refresh() {
    const s = await ouvrirSession({ forcerRefresh: true });
    return { ok: true, rafraichi: true, expireDans: Math.round((s.expireA - Date.now()) / 1000) };
  },
  async panier() {
    return lirePanier(await ouvrirSession());
  },
  async ajouter(productId, quantite = "1") {
    await ajouterAuPanier(await ouvrirSession(), productId, Number(quantite));
    return { ok: true };
  },
  async retirer(productId) {
    await retirerDuPanier(await ouvrirSession(), productId);
    return { ok: true };
  },
  async favoris() {
    const produits = await listerFavoris(await ouvrirSession());
    return { total: produits.length, produits };
  },
  async recherche(terme) {
    return rechercherProduits(await ouvrirSession(), terme);
  },
};

try {
  if (!commandes[commande]) throw new Error(`commande inconnue. Disponibles : ${Object.keys(commandes).join(", ")}`);
  chargerEnv();
  console.log(JSON.stringify(await commandes[commande](...args), null, 2));
} catch (e) {
  console.log(JSON.stringify({ ok: false, etape: e.etape ?? null, statut: e.statut ?? null, message: e.message }));
  process.exitCode = 1;
}
