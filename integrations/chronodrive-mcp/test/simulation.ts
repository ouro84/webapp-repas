// Client Chronodrive simulé pour les tests du catalogue et du panier (#308, Task 2).
// Aucun réseau : chaque appel `appeler` doit trouver sa route `MÉTHODE /chemin`, sinon le test
// échoue bruyamment. Le panier simulé incrémente sa quantité au POST, comme l'API réelle.

export type AppelSimule = {
  methode: string;
  chemin: string;
  service: string;
  params?: Record<string, string>;
  corps?: unknown;
  entetes?: Record<string, string>;
};

export type Route = (appel: AppelSimule, n: number) => unknown;

export function clientSimule(routes: Record<string, Route>, idClient = "987654") {
  const appels: AppelSimule[] = [];
  const compteurs = new Map<string, number>();
  const client = {
    async appeler<T>(
      methode: "GET" | "POST",
      chemin: string,
      options: { service: string; params?: Record<string, string>; corps?: unknown; entetes?: Record<string, string> },
    ): Promise<T> {
      const appel: AppelSimule = { methode, chemin, ...options };
      appels.push(appel);
      const cle = `${methode} ${chemin}`;
      const route = routes[cle];
      if (!route) throw new Error(`route non simulée : ${cle}`);
      const n = (compteurs.get(cle) ?? 0) + 1;
      compteurs.set(cle, n);
      return (await route(appel, n)) as T;
    },
    async idClient(): Promise<string> {
      return idClient;
    },
  };
  const compter = (cle: string) => appels.filter((a) => `${a.methode} ${a.chemin}` === cle).length;
  return { client, appels, compter };
}

// Fiche produit au format du protocole (recherche, favoris et panier partagent la même forme).
export function fiche(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: Number(id),
    labels: { productLabel: ` Produit ${id} `, brandLabel: "Marque", unitQuantityLabel: "1 kg" },
    prices: { defaultPrice: 2.5, pricePerUnitMeasure: "2,50 €/kg" },
    flags: { isOrganic: false },
    isEligible: true,
    stock: 12,
    ...extra,
  };
}

// Panier simulé : `quantites` est l'état serveur, chaque ligne lue porte la fiche `fiche(id)`.
// `ajout` décide, par produit, du returnType renvoyé et de l'incrément réellement appliqué.
export function panierSimule(
  id: string,
  quantites: Record<string, number>,
  ajout: (productId: string, quantite: number) => { returnType: string; increment: number } = (_p, q) => ({ returnType: "SUCCESS", increment: q }),
) {
  const etat = new Map(Object.entries(quantites));
  const routes: Record<string, Route> = {
    "GET /v1/customers/me/carts": () => ({ content: [{ id }] }),
    [`GET /v1/carts/${id}`]: () => ({
      id,
      items: [...etat].map(([productId, quantity]) => ({ product: fiche(productId), quantity })),
    }),
    [`POST /v1/carts/${id}/items`]: (appel: AppelSimule) => {
      const ligne = (appel.corps as { content: { productId: string; quantity: number }[] }).content[0];
      const { returnType, increment } = ajout(ligne.productId, ligne.quantity);
      etat.set(ligne.productId, (etat.get(ligne.productId) ?? 0) + increment);
      return { content: [{ returnType, productId: ligne.productId }] };
    },
  };
  return { etat, routes };
}
