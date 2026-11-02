// Skill Hermes `preparer-cycle` (#320, US-54, RG-85, RG-86, RG-87) : test statique qui fige ses invariants.
// La skill est une consigne pour l'assistant, pas une garde : ce test vérifie que les garde-fous RG-86 et le
// format exact du message de partage y figurent, mot pour mot. Aucun réseau, lecture du seul fichier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = readFileSync(new URL("../hermes/skills/omq/preparer-cycle/SKILL.md", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n",
);

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const CODES = ["L", "Ma", "Me", "J", "V", "S", "D"];
const ENTETE = /^La liste des repas de (\p{L}+) (\d{2})\/(\d{2}) au (\p{L}+) (\d{2})\/(\d{2}) est prête :$/u;
const LIGNE = /^(L|Ma|Me|J|V|S|D)(M|S) : (.+)$/;
const LIEN = /^https:\/\/webapp-repas\.vercel\.app\/planning\?cycle=(\d{4})-(\d{2})-(\d{2})$/;
const PANIER = "Le panier Chronodrive est prêt, plus qu'à le valider";

function frontmatter(): Record<string, string> {
  const bloc = /^---\n([\s\S]*?)\n---\n/.exec(SKILL);
  assert.ok(bloc, "frontmatter absent");
  const champs: Record<string, string> = {};
  for (const ligne of bloc[1].split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(ligne);
    if (m) champs[m[1]] = m[2].trim();
  }
  return champs;
}

// Exemples de message : blocs de code qui commencent par l'en-tête du format.
function exemples(): string[][] {
  const blocs = [...SKILL.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd().split("\n"));
  return blocs.filter((lignes) => lignes[0].startsWith("La liste des repas de"));
}

// Vérifie un exemple complet contre le format RG-86 ; renvoie ses lignes de créneau.
function verifierExemple(lignes: string[]): { creneaux: string[]; derniere: string } {
  const entete = ENTETE.exec(lignes[0]);
  assert.ok(entete, `en-tête hors format : ${lignes[0]}`);
  const [, jourDebut, jjDebut, mmDebut, jourFin] = entete;
  assert.ok(JOURS.includes(jourDebut) && JOURS.includes(jourFin), "jours en toutes lettres, en minuscules");

  const indexLien = lignes.indexOf("Lien vers le planning :");
  assert.ok(indexLien > 1, "« Lien vers le planning : » après la liste");
  const creneaux = lignes.slice(1, indexLien);
  assert.equal(creneaux.length % 2, 0, "deux créneaux par jour");

  // Une ligne par créneau, dans l'ordre du cycle : midi puis soir, jour après jour.
  const debut = JOURS.indexOf(jourDebut);
  creneaux.forEach((ligne, i) => {
    const m = LIGNE.exec(ligne);
    assert.ok(m, `ligne de créneau hors format : ${ligne}`);
    assert.equal(m[1], CODES[(debut + Math.floor(i / 2)) % 7], `jour attendu à la ligne « ${ligne} »`);
    assert.equal(m[2], i % 2 === 0 ? "M" : "S", `créneau attendu à la ligne « ${ligne} »`);
  });
  const jours = creneaux.length / 2;
  assert.equal(JOURS[(debut + jours - 1) % 7], jourFin, "le dernier créneau tombe le jour de fin");

  const lien = LIEN.exec(lignes[indexLien + 1]);
  assert.ok(lien, `lien profond hors format : ${lignes[indexLien + 1]}`);
  assert.equal(`${lien[3]}/${lien[2]}`, `${jjDebut}/${mmDebut}`, "le lien porte l'ancre du premier jour du cycle");

  const reste = lignes.slice(indexLien + 2);
  assert.ok(reste.length <= 1, "une ligne panier au plus après le lien");
  return { creneaux, derniere: reste[0] ?? "" };
}

test("frontmatter : nom, version et description", () => {
  const champs = frontmatter();
  assert.equal(champs.name, "preparer-cycle");
  assert.equal(champs.version, "1.0.0");
  assert.ok((champs.description ?? "").length > 0, "description vide");
  assert.match(SKILL, /metadata:\n\s+hermes:\n\s+tags: \[omq/);
});

test("format du message : chaînes exactes (RG-86, RG-87)", () => {
  for (const chaine of [
    "La liste des repas de",
    "est prête :",
    "Lien vers le planning :",
    "https://webapp-repas.vercel.app/planning?cycle=",
    PANIER,
    ", après avoir choisi :",
    "`Ma`",
    "`Me`",
    "restes",
    " : /",
  ]) {
    assert.ok(SKILL.includes(chaine), `chaîne absente : ${chaine}`);
  }
});

test("consignes RG-85 et RG-86 présentes", () => {
  for (const chaine of [
    "75 %",
    "8 semaines",
    "observation",
    "un tiers",
    "repas OK",
    "panier OK",
    "remplacer: true",
    "lancer_demande_panier",
    "hermes send",
    "memory",
    "OMQ tendance confirmée :",
    "OMQ tendance rejetée :",
    'hermes send -t "whatsapp:<contact>" -f',
  ]) {
    assert.ok(SKILL.includes(chaine), `consigne absente : ${chaine}`);
  }
});

test("outils MCP nommés comme Hermes les expose, sans outil inventé", () => {
  for (const outil of [
    "lire_planning",
    "lire_liste_courses",
    "generer_cycle",
    "chercher_recettes",
    "remplacer_repas",
    "marquer_restes",
    "changer_personnes",
    "cocher_article",
    "lancer_demande_panier",
  ]) {
    assert.ok(SKILL.includes(`\`${outil}\``), `outil absent : ${outil}`);
  }
  assert.ok(SKILL.includes("mcp__On_Mange_Quoi____"), "préfixe Hermes des outils OMQ absent");
  // Hermes n'expose pas `send_message` à l'agent : l'envoi passe par `hermes send` (outil `terminal`).
  assert.match(SKILL, /pas d'outil `send_message`/);
  assert.match(SKILL, /`terminal`/);
});

test("interdits explicites", () => {
  assert.match(SKILL, /N'envoie jamais de message (WhatsApp )?sans ordre explicite d'Arnaud/);
  assert.match(SKILL, /N'enchaîne jamais seul/);
  assert.match(SKILL, /jamais .*sans les deux validations/);
  assert.match(SKILL, /N'écris jamais le contact dans un fichier du dépôt/);
  assert.match(SKILL, /`lancer_demande_panier`[^\n]*seulement après « panier OK »/);
  assert.match(SKILL, /`remplacer: true`[^\n]*seulement après/);
  assert.match(SKILL, /`prendre_demande_panier`[^\n]*interdit/i);
  assert.match(SKILL, /`rapporter_panier`[^\n]*interdit/i);
});

test("la skill se dit consigne, pas garde", () => {
  assert.match(SKILL, /pas une garde/);
});

test("deux exemples complets de message au format exact", () => {
  const liste = exemples();
  assert.equal(liste.length, 2, "deux exemples de message attendus");

  // Premier : cycle de 7 jours, un créneau vide, un repas en restes, ligne panier « après avoir choisi ».
  const premier = verifierExemple(liste[0]);
  assert.equal(premier.creneaux.length, 14, "cycle de 7 jours");
  assert.ok(premier.creneaux.includes("VM : /"), "créneau vide « VM : / »");
  assert.ok(premier.creneaux.some((l) => l.endsWith(" : restes")), "repas en restes");
  assert.ok(premier.derniere.startsWith(`${PANIER}, après avoir choisi : `), "ligne panier avec articles à choisir");

  // Second : sans ligne panier.
  const second = verifierExemple(liste[1]);
  assert.equal(second.derniere, "", "aucune ligne panier");
  assert.ok(!liste[1].some((l) => l.includes("Chronodrive")), "aucune mention du panier");
});
