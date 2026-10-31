// Cache des correspondances terme → produit de l'exécuteur Chronodrive (#308).
// Écrit seulement après un ajout confirmé (RG-83) ; une entrée dont le produit n'est plus disponible
// est supprimée par l'appelant (`oublier`). Pièges : .claude/rules/chronodrive.md.
// `node:sqlite` émet un ExperimentalWarning sur stderr (Node 24) : stdout reste réservé au canal MCP stdio,
// rien n'est imprimé ici et l'avertissement n'est pas filtré.
import { DatabaseSync } from "node:sqlite";

export const CHEMIN_CACHE_PAR_DEFAUT = "/opt/data/chronodrive-correspondances.sqlite";

/** Chemin de la base : `CHRONODRIVE_CACHE` s'il est défini et non vide, sinon le chemin du NAS. */
export function cheminCache(env: Record<string, string | undefined> = process.env): string {
  const surcharge = env.CHRONODRIVE_CACHE?.trim();
  return surcharge ? surcharge : CHEMIN_CACHE_PAR_DEFAUT;
}

export type Correspondance = { productId: string; libelle: string; vuLe: string };
export type EntreeCorrespondance = { terme: string; productId: string; libelle: string };

/**
 * Minuscules, sans accents, ligatures dépliées, espaces réduits : « Crème  FRAÎCHE » → « creme fraiche »,
 * « Œufs » → « oeufs ». NFD ne décompose pas `œ`/`æ` : sans ce dépliage, « œufs » et « oeufs » divergeraient.
 */
export function normaliserTerme(terme: string): string {
  return terme
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/\s+/g, " ")
    .trim();
}

// Le cache peut être partagé par deux processus (deux MCP stdio, deux runs webhook) : sans délai d'attente,
// toute écriture concurrente lève « database is locked » aussitôt. Pas de WAL : `-shm` est peu fiable sur
// les montages Docker/réseau. La couche MCP (Task 4) traite une erreur de cache comme non fatale.
const DELAI_ATTENTE_MS = 5000;

// Limite historique de SQLite : 999 paramètres liés par requête.
const TAILLE_LOT = 500;

export class Correspondances {
  #base: DatabaseSync;
  #fermee = false;

  constructor(chemin: string) {
    try {
      this.#base = new DatabaseSync(chemin, { timeout: DELAI_ATTENTE_MS });
    } catch (e) {
      // Erreur SQLite brute peu parlante (« unable to open database file ») : on nomme le fichier.
      throw new Error(`cache des correspondances : ouverture de ${chemin} impossible (${e instanceof Error ? e.message : String(e)})`);
    }
    try {
      this.#base.exec(
        `create table if not exists correspondance (
           terme text primary key,
           product_id text not null,
           libelle text not null,
           vu_le text not null
         )`,
      );
    } catch (e) {
      // Base ouverte mais inutilisable : le handle est libéré avant de remonter l'erreur.
      this.#base.close();
      throw e;
    }
  }

  /** Correspondances connues parmi `termes`, indexées par terme normalisé. */
  connues(termes: string[]): Map<string, Correspondance> {
    const normalises = [...new Set(termes.map(normaliserTerme))].filter((t) => t !== "");
    const trouvees = new Map<string, Correspondance>();
    for (let debut = 0; debut < normalises.length; debut += TAILLE_LOT) {
      const lot = normalises.slice(debut, debut + TAILLE_LOT);
      const lignes = this.#base
        .prepare(
          `select terme, product_id, libelle, vu_le from correspondance where terme in (${lot.map(() => "?").join(",")})`,
        )
        .all(...lot);
      for (const ligne of lignes) {
        trouvees.set(String(ligne.terme), {
          productId: String(ligne.product_id),
          libelle: String(ligne.libelle),
          vuLe: String(ligne.vu_le),
        });
      }
    }
    return trouvees;
  }

  /** Upsert : un terme déjà connu est remplacé (produit, libellé, date). */
  memoriser(entrees: EntreeCorrespondance[]): void {
    if (entrees.length === 0) return;
    const ecrire = this.#base.prepare(
      `insert into correspondance (terme, product_id, libelle, vu_le) values (?, ?, ?, ?)
       on conflict(terme) do update set
         product_id = excluded.product_id, libelle = excluded.libelle, vu_le = excluded.vu_le`,
    );
    const vuLe = new Date().toISOString();
    this.#base.exec("begin");
    try {
      for (const { terme, productId, libelle } of entrees) {
        const cle = normaliserTerme(terme);
        if (cle !== "") ecrire.run(cle, productId, libelle, vuLe);
      }
      this.#base.exec("commit");
    } catch (erreur) {
      try {
        this.#base.exec("rollback");
      } catch {
        // Transaction déjà annulée par SQLite : l'erreur d'origine est la seule utile.
      }
      throw erreur;
    }
  }

  oublier(terme: string): void {
    this.#base.prepare("delete from correspondance where terme = ?").run(normaliserTerme(terme));
  }

  /** Idempotent : un second appel ne fait rien. */
  fermer(): void {
    if (this.#fermee) return;
    this.#fermee = true;
    this.#base.close();
  }
}
