// Garde d'ajout au panier par terme (#361, RG-82) : mémoire des produits proposés par
// `chercher_produits` et verdict produit d'une ligne de `ajouter_au_panier` dont les jetons sont déjà
// valides (`jetonsValides`, src/jetons.ts). Sortie de la fermeture `creerServeur` (src/outils.ts) pour
// être testée sans transport MCP.
// Pièges : .claude/rules/chronodrive.md.
import { DUREE_FAVORIS_MS, produitVu, type OptionsHorloge, type Produit } from "./catalogue.ts";
import { normaliserTerme } from "./correspondances.ts";
import { PRODUIT_INCONNU } from "./panier.ts";

export const PRODUIT_NON_PROPOSE = "produit non proposé pour cet article : relance chercher_produits pour ce terme";

export type GardeAjout = {
  // Un appel de chercher_produits = un numéro ; note les produits montrés par terme.
  noterRecherche(client: object, lot: [string, Produit[]][]): void;
  // Verdict produit d'une ligne dont les jetons sont déjà valides.
  verdictProduit(
    client: object,
    ligne: { terme: string; terme_recherche?: string; productId: string },
  ): "ok" | typeof PRODUIT_NON_PROPOSE | typeof PRODUIT_INCONNU;
};

// Produits proposés par `chercher_produits`, par client puis par terme normalisé : numéro de
// l'appel où le terme a été cherché pour la première fois, instant de sa dernière recherche, et
// id → instant de la dernière proposition pour CE terme (cache, favoris, recherche renvoyés).
// Tout expire après 30 min et est élagué à chaque appel. `ajouter_au_panier` refuse sans POST une
// ligne dont le produit n'a pas été proposé pour son terme. Pourquoi : au run réel, l'id des
// lasagnes proposé pour « œufs » a été recopié sur la ligne « lait » ; « vu par ailleurs »
// (`produitVu`) ne suffit pas.
type TermeCherche = { premierAppel: number; chercheA: number; ids: Map<string, number> };

// Une garde par serveur (`creerServeur`) ; la mémoire est tenue par client (WeakMap) : un client
// remplacé (config relue) repart sans proposition.
export function creerGardeAjout(horloge: OptionsHorloge = {}): GardeAjout {
  const propositions = new WeakMap<object, { appels: number; termes: Map<string, TermeCherche> }>();
  const instant = horloge.maintenant ?? Date.now;
  const frais = (a: number) => instant() - a <= DUREE_FAVORIS_MS;

  // Un appel de `chercher_produits` = un numéro ; `premierAppel` d'un terme n'est jamais rajeuni
  // tant que son entrée vit (chaque recherche la prolonge de 30 min).
  function noterRecherche(client: object, lot: [string, Produit[]][]): void {
    let etat = propositions.get(client);
    if (!etat) propositions.set(client, (etat = { appels: 0, termes: new Map() }));
    for (const [cle, t] of etat.termes) {
      if (!frais(t.chercheA)) etat.termes.delete(cle);
      else for (const [id, a] of t.ids) if (!frais(a)) t.ids.delete(id);
    }
    const appel = ++etat.appels;
    const a = instant();
    for (const [terme, produits] of lot) {
      const cle = normaliserTerme(terme);
      let t = etat.termes.get(cle);
      if (!t) etat.termes.set(cle, (t = { premierAppel: appel, chercheA: a, ids: new Map() }));
      t.chercheA = a;
      for (const p of produits) if (p.id) t.ids.set(p.id, a);
    }
  }

  function termeCherche(client: object, terme: string): TermeCherche | undefined {
    const t = propositions.get(client)?.termes.get(normaliserTerme(terme));
    return t && frais(t.chercheA) ? t : undefined;
  }

  // Produit proposé pour le terme de la ligne. Avec une reformulation (`terme_recherche` distinct
  // de `terme` une fois normalisé), elle seule valide le produit, et seulement si l'article lui-même
  // a été cherché et si la reformulation a été cherchée pour la première fois dans un appel
  // STRICTEMENT postérieur. Pourquoi : `{terme: "lait", terme_recherche: "œufs"}` passerait sinon
  // avec n'importe quel produit proposé pour « œufs » ; la skill cherche ses reformulations après coup.
  function propose(client: object, terme: string, termeRecherche: string | undefined, productId: string): boolean {
    const article = termeCherche(client, terme);
    let valide = article;
    if (termeRecherche && normaliserTerme(termeRecherche) !== normaliserTerme(terme)) {
      const reformulation = termeCherche(client, termeRecherche);
      if (!article || !reformulation || reformulation.premierAppel <= article.premierAppel) return false;
      valide = reformulation;
    }
    const a = valide?.ids.get(productId);
    return a !== undefined && frais(a);
  }

  // Un produit jamais vu en recherche ou en favoris (même s'il est dans le panier) garde le refus
  // « produit inconnu » ; un produit vu pour un autre terme, ou avec une reformulation non valable,
  // est « non proposé ».
  function verdictProduit(
    client: object,
    { terme, terme_recherche, productId }: { terme: string; terme_recherche?: string; productId: string },
  ): "ok" | typeof PRODUIT_NON_PROPOSE | typeof PRODUIT_INCONNU {
    if (propose(client, terme, terme_recherche, productId)) return "ok";
    return produitVu(client, productId, horloge) ? PRODUIT_NON_PROPOSE : PRODUIT_INCONNU;
  }

  return { noterRecherche, verdictProduit };
}
