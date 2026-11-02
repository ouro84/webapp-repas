# Skill « préparer mon cycle » (PR4b de #320) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une skill Hermes `preparer-cycle` qui prépare le prochain cycle avec Arnaud sur Telegram (tendances découvertes et confirmées, ajustements, deux validations, panier, partage WhatsApp sur ordre), plus l’outil de mesure de la durée machine et le gabarit des mesures de run.

**Architecture:** Aucun code applicatif OMQ : la skill compose les outils MCP déjà livrés (PR4a, PR4c, PR4d) et les consignes RG-86. Elle vit dans `integrations/chronodrive-mcp/hermes/skills/omq/preparer-cycle/SKILL.md`, comme `panier-chronodrive`. Un script Node `outils/duree-machine.ts` lit `state.db` de Hermes (lecture seule) pour mesurer la durée machine d’un run. Un test statique garde les invariants de la skill (formats, seuils, validations) contre une dérive de rédaction.

**Tech Stack:** Markdown (skill Hermes, frontmatter `name`/`description`/`version`), Node ≥ 24 TypeScript à syntaxe effaçable, `node:sqlite`, `node --test`.

**Spec:** `SPECS_FONCTIONNELLES.md` US-54, RG-85, RG-86, RG-87 ; `ADR.md` ADR-12. Décisions du grilling #320 (2026-10-31 et 2026-11-01) : Q7/Q16-20 format du message, Q8 mesures, Q14 cycle préparé.

## Global Constraints

- Code dans `integrations/chronodrive-mcp/` : hors CI de l’app ; `npm test` et `npm run typecheck` dans ce dossier.
- **Cycle préparé** : le cycle courant s’il n’a aucun repas, sinon le suivant (`ancre = au + 1 jour` du courant) ; dates annoncées dès le premier message ; demander avant d’écraser un cycle qui a des repas (`generer_cycle(…, remplacer: true)`). Toutes les lectures et écritures suivantes portent la même `ancre`.
- **Découverte** sur 8 semaines d’historique (repli sur l’historique disponible, signalé) ; pistes non limitatives ; chaque tendance = règle + preuves (dates, taux) + action possible avec les outils ; seuil **75 % des occurrences possibles** ; sans action possible = **observation** (montrée, jamais appliquée).
- **Confirmation** : tendance nouvelle proposée avant usage ; confirmées et rejetées mémorisées par l’exécuteur (outil `memory` de Hermes), jamais dans OMQ ; tendance confirmée absente des données → proposée à l’oubli.
- **Volume** : un tiers des repas du cycle modifié au plus ; au-delà, proposer sans appliquer.
- **Deux validations explicites** : « repas OK » (après la liste des repas, chaque modification expliquée par sa tendance), puis « panier OK » (après la vérification du placard dans OMQ). Relire le planning après toute correction. Ne jamais enchaîner seul. `lancer_demande_panier(ancre)` seulement après « panier OK ».
- **Partage WhatsApp sur ordre explicite seulement** ; contact dans la mémoire de Hermes (entrée nommée), jamais dans Git ; envoi par `hermes send -t "whatsapp:<contact>" -f <fichier>` (outil `terminal`), Hermes n’exposant pas `send_message` à l’agent.
- **Format du message (exact)** :
  - en-tête `La liste des repas de {jourSemaine DD/MM} au {jourSemaine DD/MM} est prête :`, jours en minuscules (« vendredi 06/11 ») ;
  - une ligne par créneau du cycle, dans l’ordre : `{L|Ma|Me|J|V|S|D}{M|S} : {recette}` ; nom de la recette seul ; `restes` pour un repas en restes ; `/` pour un créneau vide (« VM : / ») ;
  - après la liste : `Lien vers le planning :` puis `https://webapp-repas.vercel.app/planning?cycle=<ancre>` ;
  - dernière ligne selon la dernière demande de panier **du cycle** : `terminee` sans article à choisir → `Le panier Chronodrive est prêt, plus qu'à le valider` ; `terminee` avec articles à choisir → même phrase suivie de `, après avoir choisi : {articles}` ; demande active, en échec ou absente → aucune ligne ; introuvables jamais mentionnés.
- **Mesures** : un fichier par run `integrations/chronodrive-mcp/mesures/cycle-<ancre>.md` ; durée machine = somme des écarts « message d’Arnaud → réponse finale de l’assistant » sur la session Telegram du run (hors run panier, qui vit dans une session webhook, et hors temps de lecture) ; objectif < 10 min ; 3 runs réels consécutifs réussis, un run raté remet le compteur à zéro.
- Langue française ; commentaires citant RG-85/86/87 ; `CHANGELOG.md` et `.claude/rules/chronodrive.md` dans la PR.

## Rulings (décisions prises au plan)

- **Format produit par la skill, sans outil OMQ dédié** : la spec versionne le format dans la skill ; un outil « résumé du cycle » serait un bonus non validé. Le test statique fige les chaînes du format et deux exemples complets. Coût si faux : un run raté sur le format, corrigé dans la skill.
- **État de la demande de panier lu par l’assistant** : Telegram n’a pas `etat_panier` ; la ligne panier se déduit du compte-rendu reçu sur Telegram ou se demande à Arnaud. La skill dit : sans certitude, aucune ligne panier. Coût si faux : une ligne panier manquante.
- **Durée machine par session** : la session Telegram du run est repérée par `--session <id>` ou par `--depuis/--jusqu-a` (timestamps) sur `sessions.source = 'telegram'` ; la réponse finale d’un tour = dernier message `assistant` avant le message `user` suivant.

## Review Focus

1. Cycle courant déjà rempli : la skill vise le suivant et le dit ; elle ne régénère jamais un cycle rempli sans « oui ». → assertions du test statique (Task 2).
2. Historique de moins de 8 semaines : la skill le signale et continue sur ce qui existe. → test statique.
3. Session avec appels d’outils intermédiaires (messages `assistant` à `tool_calls`, messages `tool`) : la durée d’un tour s’arrête à la dernière réponse `assistant` avant le message `user` suivant, pas au premier appel d’outil. → test Task 1.
4. Créneau désactivé ou vide, repas en restes : `/` et `restes` dans le message. → exemple complet du test statique.
5. Ordre de partage absent : la skill ne propose pas d’envoyer d’elle-même au-delà d’une question, n’envoie jamais. → test statique.

---

### Task 1 : mesure de la durée machine

**Files:**
- Create: `integrations/chronodrive-mcp/outils/duree-machine.ts`, `integrations/chronodrive-mcp/test/duree-machine.test.ts`

**Interfaces:**
- Produces:
  - `export type Tour = { question: number; reponse: number; duree: number }` (secondes, timestamps Unix réels).
  - `export function toursDeSession(messages: { role: string; timestamp: number }[]): Tour[]` — pour chaque message `user`, la réponse est le **dernier** message `assistant` avant le message `user` suivant (ou la fin) ; un `user` sans réponse `assistant` est ignoré.
  - `export function lireMessages(chemin: string, filtre: { session?: string; depuis?: number; jusqua?: number }): { role: string; timestamp: number }[]` — `node:sqlite` en lecture seule (`readOnly: true`), sessions `source = 'telegram'` quand `--depuis/--jusqu-a` est utilisé, ordre `timestamp`.
  - CLI : `node outils/duree-machine.ts --db /opt/data/state.db (--session <id> | --depuis <ISO> --jusqu-a <ISO>)` → une ligne par tour (`HH:MM:SS question → réponse : Ns`), puis `Durée machine : M min S s (objectif < 10 min : atteint|dépassé)` ; code 0, 2 si arguments invalides. Aucune lecture de `content`.

- [ ] **Step 1 : tests** (`test/duree-machine.test.ts`, base SQLite temporaire créée par le test avec les seules colonnes utiles de `sessions` et `messages`)
  - `toursDeSession` : `user 0, assistant(tool_calls) 5, tool 6, assistant 20, user 100, assistant 130` → durées `[20, 30]` ; `user` final sans réponse ignoré ; aucun message → `[]`.
  - `lireMessages` par `session` et par fenêtre (`depuis`/`jusqua`) : seules les sessions `telegram` de la fenêtre ; une session `webhook` dans la fenêtre est exclue (run panier).
  - CLI : arguments manquants → code 2 ; total formaté `Durée machine : 0 min 50 s (objectif < 10 min : atteint)`.
- [ ] **Step 2 :** `npm test` → échecs attendus. **Step 3 :** implémenter. **Step 4 :** `npm test`, `npm run typecheck` → PASS.
- [ ] **Step 5 : commit** `feat: outil de mesure de la durée machine d’un run de préparation (#320, RG-86)`

### Task 2 : skill `preparer-cycle`

**Files:**
- Create: `integrations/chronodrive-mcp/hermes/skills/omq/preparer-cycle/SKILL.md`, `integrations/chronodrive-mcp/test/skill-preparer-cycle.test.ts`

**Interfaces:**
- Consumes: outils MCP OMQ (noms Hermes `mcp__On_Mange_Quoi____<outil>`) : `lire_planning({ semaine? | ancre? })`, `lire_liste_courses({ ancre, inclure_coches? })`, `generer_cycle({ ancre, remplacer? })`, `chercher_recettes(filtres)`, `remplacer_repas`, `marquer_restes`, `changer_personnes`, `lancer_demande_panier({ ancre })` ; outils Hermes `memory`, `terminal`.
- Produces: skill `name: preparer-cycle`, `version: 1.0.0`, déclenchée par « prépare mon cycle » (ou équivalent) sur Telegram.

- [ ] **Step 1 : test statique qui échoue** (`test/skill-preparer-cycle.test.ts`, lit le fichier) :
  - frontmatter : `name: preparer-cycle`, `version: 1.0.0`, `description` non vide ;
  - présence littérale des chaînes du format (Global Constraints) : `La liste des repas de`, `est prête :`, `Lien vers le planning :`, `https://webapp-repas.vercel.app/planning?cycle=`, `Le panier Chronodrive est prêt, plus qu'à le valider`, `, après avoir choisi :` ; codes `Ma`, `Me` ; `restes` ; ` : /` ;
  - consignes : `75 %`, `8 semaines`, `observation`, `un tiers`, `repas OK`, `panier OK`, `remplacer: true`, `lancer_demande_panier`, `hermes send`, `memory` ;
  - interdits explicites : la skill dit ne jamais envoyer sans ordre, ne jamais enchaîner sans les deux validations, ne jamais mettre le contact dans un fichier du dépôt ;
  - deux exemples complets de message dans la skill : un cycle de 7 jours avec un créneau vide (`VM : /`), un repas en restes et la ligne panier « après avoir choisi » ; un second sans ligne panier.
- [ ] **Step 2 : écrire la skill**, sections : Rôle et limites ; Outils (tableau outil / usage / interdit) ; Étape 1 cycle préparé ; Étape 2 découverte (lecture de 8 semaines par `lire_planning(semaine)`, calcul des taux, seuil, observations) ; Étape 3 confirmation et mémoire (entrées `memory` : « OMQ tendance confirmée : … » / « OMQ tendance rejetée : … », oubli proposé) ; Étape 4 génération et ajustements (≤ un tiers, chaque modification rattachée à une tendance) ; Étape 5 liste des repas et « repas OK » ; Étape 6 placard (Arnaud coche dans OMQ ce qu’il a, l’assistant relit `lire_liste_courses(ancre)`) et « panier OK » ; Étape 7 panier (`lancer_demande_panier(ancre)`, le compte-rendu arrive sur Telegram par le run webhook) ; Étape 8 partage sur ordre (message au format exact, fichier temporaire hors dépôt, `hermes send -t "whatsapp:<contact>" -f <fichier>`, contact lu dans `memory`, demandé et mémorisé s’il manque) ; Mesures (rappel du fichier de run, rempli par Claude Code avec Arnaud, pas par la skill).
- [ ] **Step 3 :** `npm test` → PASS. **Step 4 : commit** `feat: skill Hermes preparer-cycle (#320, US-54, RG-85, RG-86)`

### Task 3 : gabarit de mesures, doc et règles

**Files:**
- Create: `integrations/chronodrive-mcp/mesures/cycle-gabarit.md`
- Modify: `integrations/chronodrive-mcp/README.md`, `.claude/rules/chronodrive.md`, `CHANGELOG.md`

- [ ] **Step 1 : gabarit** `mesures/cycle-gabarit.md` : date, ancre, session Telegram, durée machine (sortie de l’outil), tendances proposées / confirmées / rejetées / observations (jugées justes ? par Arnaud), modifications et tendance de chacune, repas corrigés entre proposition et « panier OK » (≤ 2), validations respectées (oui/non), partage (ordre donné ? format exact ?), verdict du run (réussi/raté), compteur de runs consécutifs (x/3).
- [ ] **Step 2 : README** : section « Préparer le cycle (skill preparer-cycle) » : installation (même commande que l’étape 5, la skill est copiée avec `omq`), contact WhatsApp à mémoriser dans Hermes avec Arnaud (jamais dans Git), mesure (`node outils/duree-machine.ts --db /opt/data/state.db --depuis … --jusqu-a …` dans le conteneur), fichier de run d’après le gabarit. Mettre à jour l’étape 8 avec l’état réel des surfaces : `platform_toolsets.cli`, `cron`, `homeassistant` et `discord` sont des listes explicites ; `cron`, `homeassistant` et `discord` ne nomment ni `chronodrive` ni `chronodrive-admin` ; `cli` nomme `chronodrive` (mesures manuelles) mais pas `chronodrive-admin` ; un nouveau serveur MCP s’ajoute à la main à chaque liste.
- [ ] **Step 3 : règles** `chronodrive.md` (règle + Pourquoi) : la skill `preparer-cycle` porte les garde-fous RG-86 (consignes, pas des gardes : seule la liste des outils borne) ; partage par `hermes send` (pas de `send_message` agent dans Hermes), contact en mémoire Hermes ; surfaces `cron`/`homeassistant`/`discord` sans `chronodrive` (une tâche cron lit du contenu web non fiable) ; durée machine mesurée par `outils/duree-machine.ts` (lecture seule de `state.db`).
- [ ] **Step 4 : CHANGELOG** `[Unreleased]` / « Ajouté » : « Hermes : skill « préparer mon cycle » (tendances confirmées, ajustements, deux validations, panier et partage WhatsApp sur ordre) et mesure de la durée machine d’un run (#320). »
- [ ] **Step 5 :** `npm test`, `npm run typecheck` → PASS. **Step 6 : commit** `docs: gabarit de mesures, installation et règles de la skill preparer-cycle (#320)`

## Après le plan (contrôleur, avec Arnaud)

1. Revue finale, correction de **tous** les constats, mineurs compris ; push, PR `Refs #320`, merge sur CI verte.
2. NAS : sauvegarde des skills (`/opt/data/skills-omq.bak-avant-320-pr4b.tgz`), copie (`tar … omq`, README étape 5), copie de `outils/duree-machine.ts` ; vérifier la skill dans le conteneur (empreinte). Redémarrage de la gateway seulement sur accord explicite si la skill n’est pas prise à chaud.
3. Avec Arnaud : mémoriser le contact WhatsApp dans Hermes ; 3 runs réels consécutifs (« prépare mon cycle » sur Telegram), un fichier `mesures/cycle-<ancre>.md` par run, durée machine mesurée par l’outil ; un run raté remet le compteur à zéro et donne lieu à une correction de la skill avant le suivant.
