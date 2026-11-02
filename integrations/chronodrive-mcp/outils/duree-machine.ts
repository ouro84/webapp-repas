// Mesure la « durée machine » d’un run de préparation de cycle (#320, RG-86) : somme des écarts
// « message d’Arnaud → réponse finale de l’assistant » sur la session Telegram du run, lus dans le
// state.db de Hermes. Hors run panier (session webhook) et hors temps de lecture d’Arnaud. Objectif < 10 min.
// Lecture seule : la base est en WAL et la gateway y écrit ; on ne lit jamais `content`.
//
// Usage : node outils/duree-machine.ts --db /opt/data/state.db (--session <id> | --depuis <ISO> --jusqu-a <ISO>)
//   --session           mode précis : une session (identifiant de `sessions.id`), refusée si sa source n’est pas `telegram`
//   --depuis / --jusqu-a  fenêtre de dates ISO 8601 avec fuseau (`Z` ou `±hh:mm`) ; toutes les sessions Telegram
//                       de la fenêtre, tours comptés session par session (le run panier est un webhook, exclu)
// Heures affichées en Europe/Paris. Code de sortie : 0 mesure affichée ; 1 base illisible ; 2 argument invalide.
import { realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export type Tour = { question: number; reponse: number; duree: number };
export type Message = { role: string; timestamp: number };
export type MessageDeSession = Message & { session: string };
export type Filtre = { session?: string; depuis?: number; jusqua?: number };

const OBJECTIF_SECONDES = 10 * 60;
const DRAPEAUX = ["--db", "--session", "--depuis", "--jusqu-a"];
// Date et heure ISO 8601 avec fuseau explicite : sans fuseau, `Date.parse` prendrait l’heure locale de la machine.
const DATE_AVEC_FUSEAU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Argument invalide découvert à la lecture de la base (session absente ou hors Telegram) : code de sortie 2.
export class ErreurArgument extends Error {
  override name = "ErreurArgument";
}

// Pour chaque message `user`, la réponse est le dernier `assistant` avant le `user` suivant (ou la fin) ;
// un `user` sans réponse `assistant` est ignoré. Messages d’une seule session, supposés triés par timestamp.
export function toursDeSession(messages: Message[]): Tour[] {
  const tours: Tour[] = [];
  let question: number | null = null;
  let reponse: number | null = null;
  const clore = () => {
    if (question !== null && reponse !== null) tours.push({ question, reponse, duree: reponse - question });
  };
  for (const m of messages) {
    if (m.role === "user") {
      clore();
      question = m.timestamp;
      reponse = null;
    } else if (m.role === "assistant" && question !== null) {
      reponse = m.timestamp;
    }
  }
  clore();
  return tours;
}

// Tours calculés session par session, puis réunis par ordre de question : deux sessions entrelacées
// dans la fenêtre ne se coupent pas leurs tours.
export function toursParSession(messages: MessageDeSession[]): Tour[] {
  const parSession = new Map<string, Message[]>();
  for (const m of messages) {
    const liste = parSession.get(m.session) ?? [];
    liste.push({ role: m.role, timestamp: m.timestamp });
    parSession.set(m.session, liste);
  }
  return [...parSession.values()].flatMap(toursDeSession).sort((a, b) => a.question - b.question);
}

// Lecture seule ; ni `content` ni `tool_calls` ne sont sélectionnés. Seules les sessions `telegram` comptent :
// en mode précis, une session absente ou d’une autre source lève `ErreurArgument`. Une base introuvable lève
// (jamais créée : `readOnly`).
export function lireMessages(chemin: string, filtre: Filtre): MessageDeSession[] {
  const db = new DatabaseSync(chemin, { readOnly: true, timeout: 2000 });
  try {
    // Les lignes de node:sqlite ont un prototype nul : on les recopie en objets simples.
    const simples = (lignes: Record<string, unknown>[]): MessageDeSession[] =>
      lignes.map((l) => ({ session: String(l.session), role: String(l.role), timestamp: Number(l.timestamp) }));
    if (filtre.session !== undefined) {
      const session = db.prepare("select source from sessions where id = ?").get(filtre.session);
      if (session === undefined) throw new ErreurArgument(`session ${filtre.session} introuvable dans sessions`);
      if (session.source !== "telegram") {
        throw new ErreurArgument(`session ${filtre.session} de source ${String(session.source)}, pas telegram`);
      }
      return simples(
        db
          .prepare(
            "select session_id as session, role, timestamp from messages where session_id = ? order by timestamp, id",
          )
          .all(filtre.session),
      );
    }
    return simples(
      db
        .prepare(
          `select m.session_id as session, m.role as role, m.timestamp as timestamp
             from messages m join sessions s on s.id = m.session_id
            where s.source = 'telegram' and m.timestamp >= ? and m.timestamp <= ?
            order by m.timestamp, m.id`,
        )
        .all(filtre.depuis ?? 0, filtre.jusqua ?? Number.MAX_SAFE_INTEGER),
    );
  } finally {
    db.close();
  }
}

export function lireArguments(argv: string[]): { db: string; filtre: Filtre } | { erreur: string } {
  const valeurs = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const nom = argv[i];
    if (!DRAPEAUX.includes(nom)) return { erreur: `argument inconnu : ${nom}` };
    if (valeurs.has(nom)) return { erreur: `${nom} donné deux fois` };
    const valeur = argv[i + 1];
    // Une valeur en `--…` est un drapeau suivant : la vraie valeur manque.
    if (valeur === undefined || valeur === "" || valeur.startsWith("--")) return { erreur: `valeur manquante pour ${nom}` };
    valeurs.set(nom, valeur);
  }
  const db = valeurs.get("--db");
  if (!db) return { erreur: "--db <chemin de state.db> est obligatoire" };
  const session = valeurs.get("--session");
  const depuis = valeurs.get("--depuis");
  const jusqua = valeurs.get("--jusqu-a");
  if (session !== undefined) {
    if (depuis !== undefined || jusqua !== undefined) return { erreur: "--session et --depuis/--jusqu-a s’excluent" };
    return { db, filtre: { session } };
  }
  if (depuis === undefined || jusqua === undefined) {
    return { erreur: "il faut --session <id>, ou --depuis <ISO> et --jusqu-a <ISO>" };
  }
  const debut = DATE_AVEC_FUSEAU.test(depuis) ? Date.parse(depuis) : Number.NaN;
  const fin = DATE_AVEC_FUSEAU.test(jusqua) ? Date.parse(jusqua) : Number.NaN;
  if (Number.isNaN(debut)) return { erreur: `--depuis n’est pas une date ISO avec fuseau (Z ou ±hh:mm) : ${depuis}` };
  if (Number.isNaN(fin)) return { erreur: `--jusqu-a n’est pas une date ISO avec fuseau (Z ou ±hh:mm) : ${jusqua}` };
  if (fin < debut) return { erreur: "--jusqu-a est antérieure à --depuis" };
  return { db, filtre: { depuis: debut / 1000, jusqua: fin / 1000 } };
}

// Heure de Paris, quel que soit le fuseau de la machine qui lance l’outil (le conteneur du NAS est en UTC).
function heure(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });
}

// Chaque durée est arrondie une fois ; le total est la somme des durées affichées.
export function formaterTours(tours: Tour[]): string {
  const arrondies = tours.map((t) => ({ ...t, secondes: Math.round(t.duree) }));
  const lignes = arrondies.map((t) => `${heure(t.question)} → ${heure(t.reponse)} : ${t.secondes} s`);
  const total = arrondies.reduce((somme, t) => somme + t.secondes, 0);
  const verdict = total < OBJECTIF_SECONDES ? "atteint" : "dépassé";
  lignes.push(`Durée machine : ${Math.floor(total / 60)} min ${total % 60} s (objectif < 10 min : ${verdict})`);
  return lignes.join("\n");
}

function main(): void {
  const args = lireArguments(process.argv.slice(2));
  if ("erreur" in args) {
    process.stderr.write(`${args.erreur}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const tours = toursParSession(lireMessages(args.db, args.filtre));
    if (tours.length === 0) process.stderr.write("aucun tour trouvé : session ou fenêtre à vérifier\n");
    process.stdout.write(`${formaterTours(tours)}\n`);
  } catch (e) {
    if (e instanceof ErreurArgument) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`lecture de la base impossible : ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}

// `argv[1]` peut passer par un lien symbolique alors que `import.meta.url` est le chemin réel.
function estLance(): boolean {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (estLance()) main();
