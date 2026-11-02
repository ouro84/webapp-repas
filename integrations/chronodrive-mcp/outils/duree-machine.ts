// Mesure la « durée machine » d’un run de préparation de cycle (#320, RG-86) : somme des écarts
// « message d’Arnaud → réponse finale de l’assistant » sur la session Telegram du run, lus dans le
// state.db de Hermes. Hors run panier (session webhook) et hors temps de lecture d’Arnaud. Objectif < 10 min.
// Lecture seule : la base est en WAL et la gateway y écrit ; on ne lit jamais `content`.
//
// Usage : node outils/duree-machine.ts --db /opt/data/state.db (--session <id> | --depuis <ISO> --jusqu-a <ISO>)
//   --session           une session précise (identifiant de `sessions.id`)
//   --depuis / --jusqu-a  fenêtre de dates ISO 8601 ; sessions Telegram seulement (le run panier est un webhook)
// Code de sortie : 0 mesure affichée ; 1 base illisible ; 2 argument invalide.
import { realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export type Tour = { question: number; reponse: number; duree: number };
export type Message = { role: string; timestamp: number };
export type Filtre = { session?: string; depuis?: number; jusqua?: number };

const OBJECTIF_SECONDES = 10 * 60;

// Pour chaque message `user`, la réponse est le dernier `assistant` avant le `user` suivant (ou la fin) ;
// un `user` sans réponse `assistant` est ignoré. Messages supposés triés par timestamp.
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

// Lecture seule ; ni `content` ni `tool_calls` ne sont sélectionnés. Par fenêtre, seules les sessions
// `telegram` comptent. Une base introuvable lève (jamais créée : `readOnly`).
export function lireMessages(chemin: string, filtre: Filtre): Message[] {
  const db = new DatabaseSync(chemin, { readOnly: true, timeout: 2000 });
  try {
    // Les lignes de node:sqlite ont un prototype nul : on les recopie en objets simples.
    const simples = (lignes: Record<string, unknown>[]): Message[] =>
      lignes.map((l) => ({ role: String(l.role), timestamp: Number(l.timestamp) }));
    if (filtre.session !== undefined) {
      return simples(
        db.prepare("select role, timestamp from messages where session_id = ? order by timestamp, id").all(filtre.session),
      );
    }
    return simples(
      db
        .prepare(
          `select m.role as role, m.timestamp as timestamp
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
    if (nom !== "--db" && nom !== "--session" && nom !== "--depuis" && nom !== "--jusqu-a") {
      return { erreur: `argument inconnu : ${nom}` };
    }
    const valeur = argv[i + 1];
    if (valeur === undefined || valeur === "") return { erreur: `valeur manquante pour ${nom}` };
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
  const debut = Date.parse(depuis);
  const fin = Date.parse(jusqua);
  if (Number.isNaN(debut)) return { erreur: `--depuis n’est pas une date ISO : ${depuis}` };
  if (Number.isNaN(fin)) return { erreur: `--jusqu-a n’est pas une date ISO : ${jusqua}` };
  if (fin < debut) return { erreur: "--jusqu-a est antérieure à --depuis" };
  return { db, filtre: { depuis: debut / 1000, jusqua: fin / 1000 } };
}

const deuxChiffres = (n: number) => String(n).padStart(2, "0");

// Heure locale de la machine qui lance l’outil (le NAS).
function heure(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}:${deuxChiffres(d.getSeconds())}`;
}

export function formaterTours(tours: Tour[]): string {
  const lignes = tours.map((t) => `${heure(t.question)} → ${heure(t.reponse)} : ${Math.round(t.duree)} s`);
  const total = Math.round(tours.reduce((somme, t) => somme + t.duree, 0));
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
    const tours = toursDeSession(lireMessages(args.db, args.filtre));
    if (tours.length === 0) process.stderr.write("aucun tour trouvé : session ou fenêtre à vérifier\n");
    process.stdout.write(`${formaterTours(tours)}\n`);
  } catch (e) {
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
