// Outils MCP de l'exécuteur Chronodrive (#308) : travail par lot, pour un run Hermes court.
// RG-82 : aucun outil de retrait, de commande, de créneau ni de paiement. RG-83 : un ajout n'est
// mémorisé dans le cache qu'une fois confirmé par l'écart de quantité (src/panier.ts).
// stdout est le canal JSON-RPC du MCP : rien n'y est écrit ici, le journal part sur stderr.
// Pièges : .claude/rules/chronodrive.md.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { chargerFavoris, produitVu, rechercher, type AppelantRecherche, type OptionsHorloge, type Produit } from "./catalogue.ts";
import { ErreurChronodrive } from "./client.ts";
import { normaliserTerme, type Correspondance, type Correspondances, type EntreeCorrespondance } from "./correspondances.ts";
import { ajouterLignes, lirePanierCourant, type ResultatAjout } from "./panier.ts";

export type CacheCorrespondances = Pick<Correspondances, "connues" | "memoriser" | "oublier">;

export type Dependances = {
  // Fabriques appelées une fois par appel d'outil qui en a besoin : `initialize` et `tools/list` ne
  // lisent ni identifiants ni réseau. Le client renvoyé doit rester le même tant que la config ne
  // change pas (favoris et fiches vues sont mémorisés par client, src/client.ts `fabriqueClient`).
  client: () => AppelantRecherche;
  cache: () => CacheCorrespondances;
  lectureSeule: boolean;
  journal?: (message: string) => void;
  maintenant?: () => number;
};

export const NOMS_OUTILS = [
  "chercher_produits",
  "ajouter_au_panier",
  "lire_panier",
  "correspondances_connues",
  "memoriser_correspondances",
] as const;

const FAVORIS_MAX = 5;
const RECHERCHE_MAX = 8;
// Recherche de vérification d'une correspondance du cache, par son libellé.
const TAILLE_VERIFICATION = 20;

// Erreur destinée au LLM, rédigée ici : son message est sûr.
export class ErreurOutil extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurOutil";
  }
}

// Message renvoyé au LLM (puis sur Telegram). Les erreurs du client sont déjà caviardées (RG-80) ;
// d'une erreur étrangère on ne livre que le nom : son message ou sa cause peuvent porter une URL
// avec `tkn`, un en-tête ou un jeton.
export function messagePourLeLlm(e: unknown): string {
  if (e instanceof ErreurOutil || e instanceof ErreurChronodrive) return e.message;
  return `erreur inattendue de l'exécuteur Chronodrive (${e instanceof Error ? e.name : typeof e}) : réessayer plus tard ou vérifier les journaux du NAS`;
}

// --- Correspondance terme ↔ favori -------------------------------------------------------------

const MOTS_VIDES = new Set(["de", "du", "des", "la", "le", "les", "en", "au", "aux", "et", "a"]);

// Pluriel replié (« tomates » ↔ « tomate », « choux » ↔ « chou ») sur les mots de plus de 3 lettres.
function mots(texte: string): string[] {
  return normaliserTerme(texte)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m !== "")
    .map((m) => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m));
}

// Un favori correspond au terme quand chaque mot significatif du terme (3 lettres ou plus, hors mots
// vides) figure parmi les mots de son libellé et de sa marque. Un terme sans mot significatif est
// comparé sur tous ses mots. 5 favoris au plus, les disponibles d'abord. Un favori manqué n'a pas
// de coût grave : la recherche prend le relais.
export function favorisPour(terme: string, favoris: Produit[]): Produit[] {
  const tous = mots(terme);
  const significatifs = tous.filter((m) => m.length >= 3 && !MOTS_VIDES.has(m));
  const requis = significatifs.length > 0 ? significatifs : tous;
  if (requis.length === 0) return [];
  const trouves = favoris.filter((p) => {
    const disponibles = new Set(mots(`${p.libelle} ${p.marque ?? ""}`));
    return requis.every((m) => disponibles.has(m));
  });
  return [...trouves.filter((p) => p.disponible), ...trouves.filter((p) => !p.disponible)].slice(0, FAVORIS_MAX);
}

// --- Serveur ----------------------------------------------------------------------------------

type Contenu = Record<string, unknown>;

// Fiche renvoyée au LLM, allégée : `prix` suffit pour départager, et `maxCartQuantity` est
// appliqué par `ajouterLignes` (src/panier.ts).
export type ProduitLlm = Omit<Produit, "prixUnite" | "maxPanier">;

function pourLeLlm({ prixUnite: _prixUnite, maxPanier: _maxPanier, ...produit }: Produit): ProduitLlm {
  return produit;
}

export type ResultatTerme = {
  terme: string;
  cache: ProduitLlm | null;
  favoris: ProduitLlm[];
  recherche: ProduitLlm[];
  erreur: string | null;
};

// Erreurs de connexion : elles se répéteraient terme par terme (une tentative de login chacune),
// donc elles interrompent tout l'appel de `chercher_produits`.
const ETAPES_CONNEXION = new Set(["config", "config-front", "login", "authorize", "token", "GET /v1/customers/me"]);

function erreurDeConnexion(e: unknown): boolean {
  return e instanceof ErreurChronodrive && ETAPES_CONNEXION.has(e.etape);
}

const AVERTISSEMENT_CACHE = "cache des correspondances indisponible : résultats calculés sans lui (voir les journaux du NAS)";

export function creerServeur(deps: Dependances): McpServer {
  const journal = deps.journal ?? ((message: string) => void process.stderr.write(`${message}\n`));
  const horloge: OptionsHorloge = deps.maintenant ? { maintenant: deps.maintenant } : {};
  const serveur = new McpServer({ name: "chronodrive", version: "1.0.0" });

  // Erreurs du cache non bloquantes (src/correspondances.ts) : journal sur stderr, l'outil continue
  // sans cache et le signale au LLM par `avertissement`.
  function avecCache<T>(action: (cache: CacheCorrespondances) => T, repli: T, etat: { avertissement?: string }): T {
    try {
      return action(deps.cache());
    } catch (e) {
      const nom = e instanceof Error ? e.name : typeof e;
      const message = e instanceof Error ? e.message : String(e);
      journal(`[chronodrive] cache des correspondances en échec, on continue sans : ${nom} ${message}`);
      etat.avertissement = AVERTISSEMENT_CACHE;
      return repli;
    }
  }

  // Un seul lot d'ajout à la fois : deux lots parallèles entremêleraient leurs relectures
  // avant/après du panier, et l'écart de quantité ne serait plus attribuable (RG-83).
  let file: Promise<unknown> = Promise.resolve();
  function enSerie<T>(tache: () => Promise<T>): Promise<T> {
    const suite = file.then(tache, tache);
    file = suite.catch(() => undefined);
    return suite;
  }

  function outil<Forme extends z.ZodRawShape>(
    nom: (typeof NOMS_OUTILS)[number],
    description: string,
    inputSchema: Forme,
    lecture: boolean,
    executer: (args: z.infer<z.ZodObject<Forme>>) => Promise<Contenu>,
  ) {
    const rappel = async (args: z.infer<z.ZodObject<Forme>>) => {
      try {
        const resultat = await executer(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(resultat) }], structuredContent: resultat };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: messagePourLeLlm(e) }] };
      }
    };
    // Les génériques zod de registerTool ne se résolvent pas sur une forme générique : on passe par un cast.
    (serveur.registerTool as (n: string, c: object, r: typeof rappel) => unknown)(
      nom,
      { description, inputSchema, annotations: { readOnlyHint: lecture, destructiveHint: false } },
      rappel,
    );
  }

  // Fiche à jour d'un produit du cache : fiche vue (favoris chargés juste avant, ou recherche
  // récente), sinon recherche par son libellé. Introuvable : null (pas de preuve d'indisponibilité).
  async function ficheActuelle(client: AppelantRecherche, entree: Correspondance, favoris: Produit[]): Promise<Produit | null> {
    const connue = produitVu(client, entree.productId, horloge) ?? favoris.find((p) => p.id === entree.productId);
    if (connue) return connue;
    if (!entree.libelle.trim()) return null;
    const trouves = await rechercher(client, entree.libelle, TAILLE_VERIFICATION, horloge);
    return trouves.find((p) => p.id === entree.productId) ?? null;
  }

  const terme = z.string().trim().min(1).max(200);

  outil(
    "chercher_produits",
    [
      "Cherche, pour chaque article de la liste de courses, les produits Chronodrive candidats. Un seul appel par lot de termes (10 conseillé, 40 au plus).",
      "Pour chaque terme : `cache` = produit déjà acheté pour ce terme lors d'un run précédent, encore disponible (à privilégier) ;",
      "`favoris` = achats habituels du compte dont le libellé contient les mots du terme (5 au plus) ;",
      "`recherche` = résultats du catalogue (8 au plus), lancée seulement s'il n'y a ni cache ni favori disponible.",
      "Quand `cache` est retenu, `favoris` et `recherche` sont vides.",
      "Chaque produit porte `disponible` : `false` = hors stock ou non commandable (voir `raison`), ne jamais l'ajouter.",
      "`erreur` non nulle : la recherche de ce terme a échoué, les autres termes restent valables. Une erreur de connexion fait échouer tout l'appel.",
    ].join(" "),
    { termes: z.array(terme).min(1).max(40).describe("Articles à chercher, tels qu'écrits dans la liste de courses (ex. « lait demi-écrémé »)") },
    // Pas en lecture seule : une entrée du cache dont le produit est indisponible est supprimée.
    false,
    async ({ termes }) => {
      const client = deps.client();
      const favoris = await chargerFavoris(client, horloge);
      const etat: { avertissement?: string } = {};
      const connues = avecCache((c) => c.connues(termes), new Map<string, Correspondance>(), etat);
      const resultats: ResultatTerme[] = [];
      for (const t of termes) {
        const r: ResultatTerme = { terme: t, cache: null, favoris: [], recherche: [], erreur: null };
        resultats.push(r);
        try {
          const entree = connues.get(normaliserTerme(t));
          if (entree) {
            const produit = await ficheActuelle(client, entree, favoris);
            if (produit?.disponible) r.cache = pourLeLlm(produit);
            // Produit retrouvé mais indisponible : l'entrée est supprimée. Introuvable : ignorée seulement.
            else if (produit) avecCache((c) => c.oublier(t), undefined, etat);
          }
          if (r.cache) continue;
          const pourTerme = favorisPour(t, favoris);
          r.favoris = pourTerme.map(pourLeLlm);
          if (!pourTerme.some((p) => p.disponible)) {
            r.recherche = (await rechercher(client, t, RECHERCHE_MAX, horloge)).slice(0, RECHERCHE_MAX).map(pourLeLlm);
          }
        } catch (e) {
          // Pas de reconnexion terme par terme : une erreur de connexion arrête tout l'appel.
          if (erreurDeConnexion(e)) throw e;
          r.erreur = messagePourLeLlm(e);
        }
      }
      return { resultats, ...etat };
    },
  );

  outil(
    "ajouter_au_panier",
    [
      "Ajoute un lot de produits au panier Chronodrive (20 lignes au plus, un même productId une seule fois par lot).",
      "La quantité S'AJOUTE à celle déjà présente. Le panier est relu avant et après :",
      "`confirme: true` seulement si la quantité du produit a réellement augmenté (`avant` → `apres`) ; `erreur` explique un refus ou un ajout partiel.",
      "Seul un produit renvoyé par chercher_produits depuis moins de 30 min est accepté.",
      "Ne jamais relancer une ligne non confirmée sans relire le panier (`lire_panier`) : l'ajout a pu passer.",
      "Les lignes confirmées sont retenues pour le terme (cache des correspondances). Ne commande rien.",
    ].join(" "),
    {
      lignes: z
        .array(
          z.object({
            terme: terme.describe("Article de la liste de courses que ce produit couvre"),
            productId: z.string().trim().min(1).max(50).describe("`id` d'un produit renvoyé par chercher_produits"),
            quantite: z.number().int().min(1).max(20),
          }),
        )
        .min(1)
        .max(20),
    },
    false,
    async ({ lignes }) => {
      if (deps.lectureSeule) {
        throw new ErreurOutil("lecture seule (CHRONODRIVE_LECTURE_SEULE n'est pas '0') : aucun ajout au panier, aucun appel à Chronodrive");
      }
      return enSerie(async () => {
        const client = deps.client();
        const bilan = await ajouterLignes(client, lignes.map(({ productId, quantite }) => ({ productId, quantite })), horloge);
        const resultats: (ResultatAjout & { terme: string })[] = bilan.resultats.map((r, i) => ({ terme: lignes[i].terme, ...r }));
        // Libellé tiré de la fiche du panier relu après l'ajout, sinon de la fiche vue ; jamais du
        // productId (il sert à retrouver le produit par recherche). Sans libellé, rien n'est mémorisé.
        const confirmes: EntreeCorrespondance[] = resultats.flatMap((r) => {
          if (!r.confirme) return [];
          const libelle = bilan.produits.get(r.productId)?.libelle || produitVu(client, r.productId, horloge)?.libelle;
          return libelle ? [{ terme: r.terme, productId: r.productId, libelle }] : [];
        });
        const etat: { avertissement?: string } = {};
        if (confirmes.length > 0) avecCache((c) => c.memoriser(confirmes), undefined, etat);
        return { resultats, ...etat };
      });
    },
  );

  outil(
    "lire_panier",
    "Contenu actuel du panier Chronodrive : chaque ligne porte la fiche produit et la quantité. À utiliser pour vérifier un ajout douteux avant toute relance.",
    {},
    true,
    // Dans la file des ajouts : une lecture ne s'intercale pas entre les relectures d'un lot.
    () =>
      enSerie(async () => {
        const panier = await lirePanierCourant(deps.client());
        const lignes = [...panier.lignes].flatMap(([id, quantite]) => {
          const produit = panier.produits.get(id);
          return produit ? [{ produit: pourLeLlm(produit), quantite }] : [];
        });
        return { lignes };
      }),
  );

  outil(
    "correspondances_connues",
    "Lit le cache des correspondances terme → produit (déjà intégré à chercher_produits). Utile pour vérifier ce qui sera proposé pour un terme.",
    { termes: z.array(terme).min(1).max(40) },
    true,
    async ({ termes }) => {
      const etat: { avertissement?: string } = {};
      const connues = avecCache((c) => c.connues(termes), new Map<string, Correspondance>(), etat);
      const correspondances = termes.map((t) => ({ terme: t, correspondance: connues.get(normaliserTerme(t)) ?? null }));
      return { correspondances, ...etat };
    },
  );

  outil(
    "memoriser_correspondances",
    "Corrige à la main le cache des correspondances : associe un terme à un produit (remplace l'association existante). N'ajoute rien au panier.",
    {
      entrees: z
        .array(
          z.object({
            terme,
            productId: z.string().trim().min(1).max(50),
            libelle: z.string().trim().min(1).max(200).describe("Libellé du produit, servira à le retrouver"),
          }),
        )
        .min(1)
        .max(40),
    },
    false,
    async ({ entrees }) => {
      const etat: { avertissement?: string } = {};
      const memorisees = avecCache(
        (c) => {
          c.memoriser(entrees);
          return entrees.length;
        },
        0,
        etat,
      );
      return { memorisees, ...etat };
    },
  );

  return serveur;
}
