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

/** Minuscules, sans accents, espaces réduits : « Crème  FRAÎCHE » → « creme fraiche ». */
export function normaliserTerme(terme: string): string {
  return terme
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Limite historique de SQLite : 999 paramètres liés par requête.
const TAILLE_LOT = 500;

export class Correspondances {
  #base: DatabaseSync;

  constructor(chemin: string) {
    this.#base = new DatabaseSync(chemin);
    this.#base.exec(
      `create table if not exists correspondance (
         terme text primary key,
         product_id text not null,
         libelle text not null,
         vu_le text not null
       )`,
    );
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
      this.#base.exec("rollback");
      throw erreur;
    }
  }

  oublier(terme: string): void {
    this.#base.prepare("delete from correspondance where terme = ?").run(normaliserTerme(terme));
  }

  fermer(): void {
    this.#base.close();
  }
}
