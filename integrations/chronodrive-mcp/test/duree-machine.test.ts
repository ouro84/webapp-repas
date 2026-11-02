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
import { formaterTours, lireArguments, lireMessages, toursDeSession, toursParSession } from "../outils/duree-machine.ts";

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
const ms = (session: string, role: string, timestamp: number) => ({ session, role, timestamp });

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
    assert.deepEqual(lireMessages(chemin, { session: "a" }), [ms("a", "user", 10), ms("a", "assistant", 30)]);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("lireMessages : une session absente ou non telegram est refusée", () => {
  const { dossier, chemin } = creerBase([["t", "telegram"], ["w", "webhook"]], [["w", "user", 10], ["w", "assistant", 30]]);
  try {
    assert.throws(() => lireMessages(chemin, { session: "absente" }), /session absente introuvable/);
    assert.throws(() => lireMessages(chemin, { session: "w" }), /session w de source webhook, pas telegram/);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("toursParSession : deux sessions entrelacées comptent chacune leurs tours", () => {
  // Sans regroupement, le user de b à 15 couperait le tour de a (0 → 30).
  const tours = toursParSession([
    ms("a", "user", 0),
    ms("b", "user", 15),
    ms("a", "assistant", 30),
    ms("b", "assistant", 40),
    ms("a", "user", 100),
    ms("a", "assistant", 110),
  ]);
  assert.deepEqual(tours, [
    { question: 0, reponse: 30, duree: 30 },
    { question: 15, reponse: 40, duree: 25 },
    { question: 100, reponse: 110, duree: 10 },
  ]);
});

test("formaterTours : chaque durée arrondie une fois, total = somme des arrondis, heures de Paris", () => {
  const base = Date.parse("2026-11-02T18:00:00Z") / 1000; // 19:00:00 à Paris (heure d'hiver)
  const sortie = formaterTours([
    { question: base, reponse: base + 10.4, duree: 10.4 },
    { question: base + 60, reponse: base + 70.4, duree: 10.4 },
    { question: base + 120, reponse: base + 130.4, duree: 10.4 },
  ]).split("\n");
  assert.equal(sortie[0], "19:00:00 → 19:00:10 : 10 s");
  // 3 × 10 s affichées : le total vaut 30 s, pas Math.round(31,2) = 31 s.
  assert.equal(sortie[3], "Durée machine : 0 min 30 s (objectif < 10 min : atteint)");
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
    assert.deepEqual(lireMessages(chemin, { depuis: 50, jusqua: 300 }), [
      ms("t", "user", 100),
      ms("t", "assistant", 120),
      ms("t", "user", 200),
      ms("t", "assistant", 230),
    ]);
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

test("lireArguments : dates avec fuseau explicite (Z ou ±hh:mm) seulement", () => {
  const ok = lireArguments(["--db", "x.db", "--depuis", "2026-11-02T19:00:00+01:00", "--jusqu-a", "2026-11-02T19:30:00.500Z"]);
  assert.deepEqual(ok, {
    db: "x.db",
    filtre: { depuis: Date.parse("2026-11-02T18:00:00Z") / 1000, jusqua: Date.parse("2026-11-02T19:30:00.500Z") / 1000 },
  });
  for (const date of ["2026-11-02T19:00:00", "2026-11-02", "2026-11-02T19:00:00+0100", "2026-11-02 19:00:00Z"]) {
    const r = lireArguments(["--db", "x.db", "--depuis", date, "--jusqu-a", "2026-11-02T20:00:00Z"]);
    assert.ok("erreur" in r && r.erreur.includes("fuseau"), date);
  }
});

test("lireArguments : une valeur qui commence par -- est refusée", () => {
  const r = lireArguments(["--db", "--session", "s1"]);
  assert.ok("erreur" in r && r.erreur.includes("valeur manquante pour --db"), JSON.stringify(r));
});

test("lireArguments : un drapeau répété est refusé", () => {
  const r = lireArguments(["--db", "x.db", "--session", "s1", "--session", "s2"]);
  assert.ok("erreur" in r && r.erreur.includes("--session donné deux fois"), JSON.stringify(r));
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

test("CLI : session absente ou non telegram → code 2 avec message", async () => {
  const { dossier, chemin } = creerBase([["w", "webhook"]], [["w", "user", 0], ["w", "assistant", 5]]);
  try {
    const absente = await lancer(["--db", chemin, "--session", "x"]);
    assert.equal(absente.code, 2);
    assert.match(absente.erreurs, /session x introuvable/);
    assert.equal(absente.sortie, "");
    const webhook = await lancer(["--db", chemin, "--session", "w"]);
    assert.equal(webhook.code, 2);
    assert.match(webhook.erreurs, /source webhook, pas telegram/);
    assert.equal(webhook.sortie, "");
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("CLI : fenêtre, deux sessions telegram entrelacées", async () => {
  const { dossier, chemin } = creerBase(
    [["a", "telegram"], ["b", "telegram"]],
    [["a", "user", 1000], ["b", "user", 1015], ["a", "assistant", 1030], ["b", "assistant", 1040]],
  );
  try {
    const r = await lancer(["--db", chemin, "--depuis", "1970-01-01T00:00:00Z", "--jusqu-a", "1970-01-01T01:00:00Z"]);
    assert.equal(r.code, 0, r.erreurs);
    assert.ok(r.sortie.trimEnd().endsWith("Durée machine : 0 min 55 s (objectif < 10 min : atteint)"), r.sortie);
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
