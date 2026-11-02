// Outil de mesure de la durée machine d’un run de préparation (#320, RG-86) : tours « message d’Arnaud →
// réponse finale de l’assistant » lus dans state.db de Hermes, en lecture seule, sans jamais lire `content`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lireArguments, lireMessages, toursDeSession } from "../outils/duree-machine.ts";

const SCRIPT = fileURLToPath(new URL("../outils/duree-machine.ts", import.meta.url));

type Msg = [session: string, role: string, timestamp: number];

// Base jetable avec les seules colonnes utiles du schéma Hermes (sessions, messages).
function creerBase(sessions: [id: string, source: string][], messages: Msg[]): { dossier: string; chemin: string } {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-duree-"));
  const chemin = join(dossier, "state.db");
  const db = new DatabaseSync(chemin);
  db.exec(`
    create table sessions (id text primary key, source text not null, started_at real not null, ended_at real);
    create table messages (id integer primary key autoincrement, session_id text not null, role text not null,
      content text, tool_calls text, timestamp real not null);
  `);
  const s = db.prepare("insert into sessions (id, source, started_at) values (?, ?, 0)");
  for (const [id, source] of sessions) s.run(id, source);
  const m = db.prepare("insert into messages (session_id, role, content, timestamp) values (?, ?, 'SECRET', ?)");
  for (const [session, role, timestamp] of messages) m.run(session, role, timestamp);
  db.close();
  return { dossier, chemin };
}

async function lancer(args: string[]): Promise<{ code: number | null; sortie: string; erreurs: string }> {
  const enfant = spawn(process.execPath, [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "";
  let erreurs = "";
  enfant.stdout.setEncoding("utf8").on("data", (d: string) => (sortie += d));
  enfant.stderr.setEncoding("utf8").on("data", (d: string) => (erreurs += d));
  const code = await new Promise<number | null>((r) => enfant.once("close", r));
  return { code, sortie, erreurs };
}

const m = (role: string, timestamp: number) => ({ role, timestamp });

test("toursDeSession : la réponse est le dernier assistant avant le user suivant", () => {
  const tours = toursDeSession([m("user", 0), m("assistant", 5), m("tool", 6), m("assistant", 20), m("user", 100), m("assistant", 130)]);
  assert.deepEqual(tours, [
    { question: 0, reponse: 20, duree: 20 },
    { question: 100, reponse: 130, duree: 30 },
  ]);
});

test("toursDeSession : un user sans réponse assistant est ignoré, aucun message donne []", () => {
  assert.deepEqual(toursDeSession([m("user", 0), m("assistant", 10), m("user", 50)]), [{ question: 0, reponse: 10, duree: 10 }]);
  assert.deepEqual(toursDeSession([m("user", 0), m("tool", 3), m("user", 9), m("assistant", 12)]), [{ question: 9, reponse: 12, duree: 3 }]);
  assert.deepEqual(toursDeSession([]), []);
});

test("lireMessages : filtre par session, trié par timestamp", () => {
  const { dossier, chemin } = creerBase(
    [["a", "telegram"], ["b", "telegram"]],
    [["a", "assistant", 30], ["a", "user", 10], ["b", "user", 15]],
  );
  try {
    assert.deepEqual(lireMessages(chemin, { session: "a" }), [m("user", 10), m("assistant", 30)]);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("lireMessages : fenêtre depuis/jusqua, sessions telegram seulement (le run panier webhook est exclu)", () => {
  const { dossier, chemin } = creerBase(
    [["t", "telegram"], ["w", "webhook"], ["c", "cron"]],
    [
      ["t", "user", 5], // avant la fenêtre
      ["t", "user", 100], ["t", "assistant", 120],
      ["w", "user", 110], ["w", "assistant", 400], // run panier : exclu
      ["c", "assistant", 130], // autre source : exclu
      ["t", "user", 200], ["t", "assistant", 230],
      ["t", "user", 900], // après la fenêtre
    ],
  );
  try {
    assert.deepEqual(lireMessages(chemin, { depuis: 50, jusqua: 300 }), [m("user", 100), m("assistant", 120), m("user", 200), m("assistant", 230)]);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("lireArguments : session ou fenêtre, rien d’autre", () => {
  assert.deepEqual(lireArguments(["--db", "x.db", "--session", "s1"]), { db: "x.db", filtre: { session: "s1" } });
  const f = lireArguments(["--db", "x.db", "--depuis", "2026-11-02T18:00:00Z", "--jusqu-a", "2026-11-02T19:00:00Z"]);
  assert.deepEqual(f, { db: "x.db", filtre: { depuis: Date.parse("2026-11-02T18:00:00Z") / 1000, jusqua: Date.parse("2026-11-02T19:00:00Z") / 1000 } });
  for (const mauvais of [
    [],
    ["--session", "s1"],
    ["--db", "x.db"],
    ["--db", "x.db", "--depuis", "2026-11-02T18:00:00Z"],
    ["--db", "x.db", "--session", "s1", "--depuis", "2026-11-02T18:00:00Z", "--jusqu-a", "2026-11-02T19:00:00Z"],
    ["--db", "x.db", "--depuis", "pas une date", "--jusqu-a", "2026-11-02T19:00:00Z"],
    ["--db", "x.db", "--inconnu", "1"],
    ["--db", "x.db", "--session"],
  ]) assert.ok("erreur" in lireArguments(mauvais), JSON.stringify(mauvais));
});

test("CLI : arguments manquants → code 2", async () => {
  const r = await lancer(["--db", "/inexistant.db"]);
  assert.equal(r.code, 2);
  assert.match(r.erreurs, /--session|--depuis/);
});

test("CLI : une ligne par tour puis le total formaté", async () => {
  const { dossier, chemin } = creerBase(
    [["s1", "telegram"]],
    [["s1", "user", 1000], ["s1", "assistant", 1005], ["s1", "tool", 1006], ["s1", "assistant", 1020], ["s1", "user", 1100], ["s1", "assistant", 1130]],
  );
  try {
    const r = await lancer(["--db", chemin, "--session", "s1"]);
    assert.equal(r.code, 0, r.erreurs);
    assert.equal(r.erreurs, "");
    const lignes = r.sortie.trimEnd().split("\n");
    assert.equal(lignes.length, 3);
    assert.match(lignes[0], /^\d\d:\d\d:\d\d → \d\d:\d\d:\d\d : 20 s$/);
    assert.match(lignes[1], /^\d\d:\d\d:\d\d → \d\d:\d\d:\d\d : 30 s$/);
    assert.equal(lignes[2], "Durée machine : 0 min 50 s (objectif < 10 min : atteint)");
    assert.ok(!r.sortie.includes("SECRET"));
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("CLI : objectif dépassé à partir de 10 min", async () => {
  const { dossier, chemin } = creerBase([["s1", "telegram"]], [["s1", "user", 0], ["s1", "assistant", 605]]);
  try {
    const r = await lancer(["--db", chemin, "--session", "s1"]);
    assert.equal(r.code, 0, r.erreurs);
    assert.ok(r.sortie.trimEnd().endsWith("Durée machine : 10 min 5 s (objectif < 10 min : dépassé)"), r.sortie);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("CLI : base introuvable → code 1, jamais créée", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-duree-"));
  try {
    const r = await lancer(["--db", join(dossier, "absente.db"), "--session", "s1"]);
    assert.equal(r.code, 1);
    assert.notEqual(r.erreurs, "");
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
