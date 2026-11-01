// Outils MCP de l'exécuteur Chronodrive (#308) : travail par lot, pour un run Hermes court.
// RG-82 : aucun outil de retrait, de commande, de créneau ni de paiement. RG-83 : un ajout n'est
// mémorisé dans le cache qu'une fois confirmé par l'écart de quantité (src/panier.ts).
// stdout est le canal JSON-RPC du MCP : rien n'y est écrit ici, le journal part sur stderr.
// Pièges : .claude/rules/chronodrive.md.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  chargerFavoris,
  DUREE_FAVORIS_MS,
  noterProduits,
  produitVu,
  rechercher,
  type AppelantRecherche,
  type OptionsHorloge,
  type Produit,
} from "./catalogue.ts";
import { ErreurChronodrive } from "./client.ts";
import { normaliserTerme, type Correspondance, type Correspondances, type EntreeCorrespondance } from "./correspondances.ts";
import { ajouterLignes, lirePanierCourant, PRODUIT_INCONNU, type ResultatAjout } from "./panier.ts";

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

export const PRODUIT_NON_PROPOSE = "produit non proposé pour cet article : relance chercher_produits pour ce terme";

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
// Prépositions qui introduisent un complément (« à » et « d' » une fois normalisés : « a », « d ») ;
// « à la » et « à l' » (« a la », « a l ») sont traités à part.
const PREPOSITIONS = new Set(["au", "aux", "a", "de", "du", "des", "d", "en"]);

type Mot = { mot: string; complement: boolean };

// Mots normalisés, pluriel replié (« tomates » ↔ « tomate », « choux » ↔ « chou ») sur les mots de
// plus de 3 lettres. `complement` : le mot suit une préposition (« au lait », « aux oeufs », « à la fraise »).
function mots(texte: string): Mot[] {
  const bruts = normaliserTerme(texte)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m !== "");
  return bruts.map((m, i) => ({
    mot: m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m,
    complement: i > 0 && (PREPOSITIONS.has(bruts[i - 1]) || ((bruts[i - 1] === "la" || bruts[i - 1] === "l") && bruts[i - 2] === "a")),
  }));
}

// Un favori correspond au terme quand chaque mot significatif du terme (3 lettres ou plus, hors mots
// vides) figure dans son libellé (la marque ne compte pas). Un mot qui, dans le libellé, ne figure
// qu'en complément (juste après « au », « aux », « à », « à la », « à l' », « de », « du », « des », « d' »,
// « en ») ne compte que s'il est aussi complément dans le terme : « lait » ne trouve ni « Oeufs en
// chocolat au lait » ni « Feta au lait de brebis », « œufs » ne trouve pas « Feuilles de lasagnes
// aux oeufs », mais « coulis de tomate » trouve « Coulis de tomates ». Un terme sans mot significatif
// est comparé sur tous ses mots. 5 favoris au plus, les disponibles d'abord. Un favori manqué n'a
// pas de coût grave : la recherche prend le relais.
export function favorisPour(terme: string, favoris: Produit[]): Produit[] {
  const tous = mots(terme);
  const significatifs = tous.filter(({ mot }) => mot.length >= 3 && !MOTS_VIDES.has(mot));
  const requis = significatifs.length > 0 ? significatifs : tous;
  if (requis.length === 0) return [];
  const trouves = favoris.filter((p) => {
    const libelle = mots(p.libelle);
    return requis.every((r) => libelle.some((l) => l.mot === r.mot && (r.complement || !l.complement)));
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

// Un 401 qui a survécu à l'unique reconnexion du client se répéterait aussi à chaque terme
// (un login par terme) : même traitement.
function erreurDeConnexion(e: unknown): boolean {
  return e instanceof ErreurChronodrive && (ETAPES_CONNEXION.has(e.etape) || e.statut === 401);
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

  // Produits proposés par `chercher_produits`, par client puis par terme normalisé : numéro de
  // l'appel où le terme a été cherché pour la première fois, instant de sa dernière recherche, et
  // id → instant de la dernière proposition pour CE terme (cache, favoris, recherche renvoyés).
  // Tout expire après 30 min et est élagué à chaque appel. `ajouter_au_panier` refuse sans POST une
  // ligne dont le produit n'a pas été proposé pour son terme. Pourquoi : au run réel, l'id des
  // lasagnes proposé pour « œufs » a été recopié sur la ligne « lait » ; « vu par ailleurs »
  // (`produitVu`) ne suffit pas.
  type TermeCherche = { premierAppel: number; chercheA: number; ids: Map<string, number> };
  const propositions = new WeakMap<object, { appels: number; termes: Map<string, TermeCherche> }>();
  const instant = deps.maintenant ?? Date.now;
  const frais = (a: number) => instant() - a <= DUREE_FAVORIS_MS;

  // Un appel de `chercher_produits` = un numéro ; `premierAppel` d'un terme n'est jamais rajeuni
  // tant que son entrée vit (chaque recherche la prolonge de 30 min).
  function noterPropositions(client: object, lot: [string, Produit[]][]): void {
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
      // Fiches complètes effectivement montrées au LLM, par terme : notées à nouveau en fin d'appel,
      // comme vues et comme proposées pour ce terme.
      const montresParTerme: [string, Produit[]][] = [];
      for (const t of termes) {
        const r: ResultatTerme = { terme: t, cache: null, favoris: [], recherche: [], erreur: null };
        resultats.push(r);
        const montres: Produit[] = [];
        montresParTerme.push([t, montres]);
        try {
          const entree = connues.get(normaliserTerme(t));
          if (entree) {
            const produit = await ficheActuelle(client, entree, favoris);
            if (produit?.disponible) {
              r.cache = pourLeLlm(produit);
              montres.push(produit);
            }
            // Produit retrouvé mais indisponible : l'entrée est supprimée. Introuvable : ignorée seulement.
            else if (produit) avecCache((c) => c.oublier(t), undefined, etat);
          }
          if (r.cache) continue;
          const pourTerme = favorisPour(t, favoris);
          r.favoris = pourTerme.map(pourLeLlm);
          montres.push(...pourTerme);
          if (!pourTerme.some((p) => p.disponible)) {
            const trouves = (await rechercher(client, t, RECHERCHE_MAX, horloge)).slice(0, RECHERCHE_MAX);
            r.recherche = trouves.map(pourLeLlm);
            montres.push(...trouves);
          }
        } catch (e) {
          // Pas de reconnexion terme par terme : une erreur de connexion arrête tout l'appel.
          if (erreurDeConnexion(e)) throw e;
          r.erreur = messagePourLeLlm(e);
        }
      }
      // Les favoris viennent d'une mémoire de 30 min : sans cette note, un favori montré à
      // chargement + 29 min serait refusé à l'ajout deux minutes plus tard (« vu il y a plus de 30 min »).
      // Les 30 min de `produitVu` courent ainsi depuis le dernier affichage au LLM.
      noterProduits(client, montresParTerme.flatMap(([, montres]) => montres), horloge);
      noterPropositions(client, montresParTerme);
      return { resultats, ...etat };
    },
  );

  outil(
    "ajouter_au_panier",
    [
      "Ajoute un lot de produits au panier Chronodrive (20 lignes au plus, un même productId une seule fois par lot).",
      "La quantité S'AJOUTE à celle déjà présente. Le panier est relu avant et après :",
      "`confirme: true` seulement si la quantité du produit a réellement augmenté (`avant` → `apres`) ; `erreur` explique un refus ou un ajout partiel.",
      "Seul un produit renvoyé par chercher_produits depuis moins de 30 min POUR CE TERME est accepté : copier l'`id` depuis le résultat du terme de cet article,",
      "et passer `terme_recherche` quand le produit vient d'une reformulation, cherchée dans un appel de chercher_produits POSTÉRIEUR à celui du terme.",
      "Sinon la ligne est refusée sans envoi (« produit non proposé pour cet article »).",
      "Passer `quantite_omq` (quantité OMQ de l'article, texte exact) : quand elle et la contenance du produit se comparent (masse, volume ou nombre),",
      "la quantité est plafonnée au nombre d'unités qui couvre le besoin, jamais augmentée ; `demande` = quantité envoyée, `quantiteAjustee` {demandee, envoyee} signale le plafond.",
      "Ne jamais relancer une ligne non confirmée sans relire le panier (`lire_panier`) : l'ajout a pu passer.",
      "Les lignes confirmées sont retenues pour le terme (cache des correspondances). Ne commande rien.",
    ].join(" "),
    {
      lignes: z
        .array(
          z.object({
            terme: terme.describe("Article de la liste de courses que ce produit couvre"),
            terme_recherche: z
              .string()
              .trim()
              .max(200)
              .optional()
              .describe(
                "Reformulation passée à chercher_produits, dans un appel postérieur à celui de `terme`, quand le produit vient de son résultat (ex. « poireau » pour « poireaux »)",
              ),
            productId: z.string().trim().min(1).max(50).describe("`id` d'un produit renvoyé par chercher_produits pour ce terme"),
            quantite: z.number().int().min(1).max(20),
            quantite_omq: z
              .string()
              .trim()
              .max(100)
              .optional()
              .describe(
                "Quantité OMQ de l'article, texte exact (ex. « 800 g », « 2 c.à.s », « » si vide) ; articles fusionnés : leurs quantités jointes par « + » (« 2 c.à.s + 160 g »)",
              ),
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
        // Garde par terme (`propose`). Un produit jamais vu en recherche ou en favoris (même s'il est
        // dans le panier) garde le refus « produit inconnu » ; un produit vu pour un autre terme, ou
        // avec une reformulation non valable, est « non proposé ».
        const aEnvoyer = lignes.map(({ terme: t, terme_recherche, productId, quantite, quantite_omq: quantiteOmq }) => {
          if (propose(client, t, terme_recherche, productId)) return { productId, quantite, quantiteOmq };
          return { productId, quantite, refus: produitVu(client, productId, horloge) ? PRODUIT_NON_PROPOSE : PRODUIT_INCONNU };
        });
        const bilan = await ajouterLignes(client, aEnvoyer, horloge);
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
