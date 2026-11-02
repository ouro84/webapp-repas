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
    'hermes send -t "whatsapp:<numéro ou JID>" -f',
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

// Ligne du tableau des outils, découpée en cellules : outil, arguments, usage, interdit.
function ligneOutil(outil: string): string[] {
  const ligne = SKILL.split("\n").find((l) => l.startsWith(`| OMQ \`${outil}\``));
  assert.ok(ligne, `outil absent du tableau : ${outil}`);
  return ligne.split("|").slice(1, -1).map((c) => c.trim());
}

// Un bloc « Avant d'appeler X, vérifie : » suivi, dans le même bloc, de l'arrêt.
function controle(appel: string): string {
  const debut = SKILL.indexOf(`**Avant d'appeler ${appel}, vérifie :**`);
  assert.ok(debut >= 0, `contrôle absent avant ${appel}`);
  const fin = SKILL.indexOf("Sinon, arrête-toi et dis pourquoi.", debut);
  assert.ok(fin > debut && fin - debut < 1200, `contrôle de ${appel} sans arrêt`);
  return SKILL.slice(debut, fin);
}

test("ancre verrouillée : jamais omise, jamais inventée (RG-85)", () => {
  for (const outil of ["generer_cycle", "lancer_demande_panier", "lire_liste_courses", "cocher_article"]) {
    const [, args, , interdit] = ligneOutil(outil);
    assert.ok(args.includes("`ancre` toujours"), `${outil} : ancre toujours passée`);
    assert.ok(interdit.includes("sans `ancre`"), `${outil} : appel sans ancre interdit`);
  }
  for (const outil of ["generer_cycle", "lancer_demande_panier"]) {
    assert.ok(ligneOutil(outil)[1].includes("la date de début annoncée dans ton premier message"), outil);
  }
  assert.ok(SKILL.includes("passe toujours `ancre` = la date de début annoncée dans ton premier message de ce run"));
  assert.ok(
    SKILL.includes(
      "Si tu ne retrouves pas l'étape 1 dans ce run (session reprise), recommence l'étape 1 ; une étape 1 d'un run précédent ne compte pas ; n'invente jamais l'ancre.",
    ),
  );
  assert.ok(SKILL.includes("ne prends jamais la date du jour"));
});

test("« ce run » délimité : il commence à la dernière demande de préparer le cycle", () => {
  assert.ok(SKILL.includes("Le run commence au dernier message d'Arnaud qui demande de préparer le cycle."));
  // Plus aucune portée floue : « premier message » est toujours celui de ce run.
  assert.equal(SKILL.match(/premier message(?! de ce run)/g), null, "« premier message » sans « de ce run »");
  for (const flou of ["dans ce tour", "de cette conversation", "dans cette conversation,", "dans cette conversation ("]) {
    assert.ok(!SKILL.includes(flou), `portée floue : ${flou}`);
  }
});

test("contrôle avant chaque action risquée, puis arrêt (RG-86)", () => {
  const remplacer = controle("`generer_cycle` avec `remplacer: true`");
  assert.ok(remplacer.includes("est exactement « remplacer », seule (règle « Réponse exacte »)"), "« remplacer » exact, seul");

  const panier = controle("`lancer_demande_panier`");
  assert.ok(panier.includes("jamais la date du jour"), "ancre de l'étape 1, pas la date du jour");
  assert.ok(panier.includes("`cycle.du` égal à `ancre`"), "liste relue sur le bon cycle");
  assert.ok(panier.includes("« repas OK » puis « panier OK », dans cet ordre"), "deux validations ordonnées");
  assert.ok(panier.includes("les deux validations sont postérieures au début de ce run"), "validations de ce run");
  assert.ok(
    panier.includes(
      "« panier OK » est dans un message d'Arnaud postérieur à ton dernier message du placard (étape 6), et « repas OK » postérieur à ton dernier message de liste des repas (étape 5)",
    ),
    "chaque validation suit le message qu'elle valide",
  );

  const modification = controle("`remplacer_repas`, `marquer_restes` ou `changer_personnes`");
  assert.ok(modification.includes("`date` comprise entre `periode.du` et `periode.au` du cycle préparé"));

  const envoi = controle("`hermes send`");
  assert.ok(envoi.includes("le prénom de l'entrée est celui que nomme son ordre"), "destinataire nommé");
  assert.ok(
    envoi.includes(
      "Arnaud a donné l'ordre de partager dans ce run, et ses messages depuis cet ordre ne font que répondre à tes questions de l'étape 8 (ligne panier, destinataire, numéro) ; tout autre message annule l'ordre",
    ),
    "ordre de partage de ce run, annulé par tout autre message",
  );

  // Étape 1 : le cycle suivant relu dans OMQ, pas une date calculée de tête.
  assert.match(SKILL, /Vérifie : `periode\.du` du cycle suivant, relu dans cette réponse d'OMQ, est postérieur à `periode\.au` du cycle en cours\. Sinon, arrête-toi et dis pourquoi/);
});

test("question de remplacement posée seule, trois réponses : « remplacer », « garder », « non »", () => {
  assert.ok(SKILL.includes("pose la question de remplacement **seule**"));
  assert.ok(
    SKILL.includes(
      "« Le cycle du vendredi 06/11 au jeudi 12/11 (ancre 2026-11-06) a déjà 13 repas. Réponds « remplacer » pour écraser le cycle, « garder » pour garder ses repas et les ajuster, « non » pour arrêter. »",
    ),
    "question de remplacement avec l'ancre",
  );
  assert.ok(SKILL.includes("Attends la réponse, puis applique la règle « Réponse exacte » :"));
  assert.match(SKILL, /^\s+- « remplacer » : [^\n]*`generer_cycle\(ancre, remplacer: true\)`/m);
  assert.match(SKILL, /^\s+- « non » : arrête le parcours, sans toucher au cycle\./m);
  assert.match(SKILL, /^\s+- Tout autre message : il est ambigu \(règle « Réponse exacte »\)\. Repose la question avec les mêmes mots\./m);
});

test("« garder » n'appelle jamais `generer_cycle` et suit les mêmes règles", () => {
  const etape1 = /^\s+- « garder » : ([^\n]*)$/m.exec(SKILL);
  assert.ok(etape1, "réponse « garder » absente de l'étape 1");
  assert.ok(etape1[1].includes("tu n'appelles jamais `generer_cycle`"));
  assert.ok(etape1[1].includes("un tiers des repas au plus"));
  assert.ok(etape1[1].includes("tendances confirmées"));

  const etape4 = /^\s+- Réponse « garder » : ([^\n]*)$/m.exec(SKILL);
  assert.ok(etape4, "cas « garder » absent de l'étape 4");
  assert.ok(etape4[1].includes("n'appelle jamais `generer_cycle`"));

  assert.ok(ligneOutil("generer_cycle")[3].includes("tout appel après la réponse « garder »"));
  // Le contrôle de `remplacer: true` reste intact.
  assert.ok(controle("`generer_cycle` avec `remplacer: true`").includes("est exactement « remplacer », seule"));
});

test("règle « Réponse exacte » écrite une fois, référencée aux étapes 1, 5 et 6", () => {
  const regle =
    "Une réponse n'est acceptée que si le message d'Arnaud, sans espaces autour, sans ponctuation et casse ignorée, vaut exactement `remplacer`, `garder`, `non`, `repas ok` ou `panier ok`";
  assert.equal(SKILL.split(regle).length, 2, "règle écrite une seule fois");
  assert.ok(SKILL.includes("Tout autre message (négation, phrase, plusieurs mots, « oui ») est ambigu : redemande avec le mot exact, en rappelant qu'à l'étape 1 « non » arrête tout."));
  assert.ok(SKILL.includes("`remplacer`, `garder` ou `non` à l'étape 1, `repas ok` à l'étape 5, `panier ok` à l'étape 6"));
  assert.ok(SKILL.includes("attends la réponse « repas OK », selon la règle « Réponse exacte »"));
  assert.ok(SKILL.includes("attends la réponse « panier OK », selon la règle « Réponse exacte »"));
  // Plus de variantes répétées ni de « contient », qui laisserait passer « pas repas OK ».
  for (const ancien of ["contient « repas OK »", "contient « panier OK »", "contient le mot", "ok pour les repas", "majuscules ou minuscules"]) {
    assert.ok(!SKILL.includes(ancien), `ancienne formule : ${ancien}`);
  }
});

test("partage : ligne panier sûre, destinataire nommé", () => {
  assert.ok(SKILL.includes("porte les dates de ce cycle"));
  assert.ok(SKILL.includes("« Quelle ligne panier ?"));
  assert.ok(SKILL.includes("Sans certitude, aucune ligne panier."));
  // Entrée sans préfixe : le préfixe `whatsapp:` n'apparaît que dans la commande.
  assert.ok(SKILL.includes("« OMQ contact partage cycle : <prénom> → <numéro ou JID> »"));
  assert.ok(!SKILL.includes("→ whatsapp:"), "préfixe whatsapp: dans l'entrée mémoire");
  assert.ok(SKILL.includes("« J'envoie à <prénom> ? »"), "confirmation du destinataire");
  assert.ok(SKILL.includes("N'envoie jamais à un contact qu'Arnaud n'a pas explicitement nommé ou confirmé."));
});

test("créneaux vides : énumération complète du cycle", () => {
  assert.ok(SKILL.includes("Énumère chaque jour de `periode.du` à `periode.au`, midi puis soir"));
  assert.ok(SKILL.includes("un créneau absent de `repas` s'écrit `/`"));
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
