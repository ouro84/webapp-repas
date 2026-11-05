---
paths:
  - "lib/sync*.ts"
  - "lib/stockage.ts"
  - "lib/persistance.ts"
  - "lib/coches-sync*.ts"
  - "lib/planning-diff*.ts"
  - "lib/adapters*.ts"
  - "app/planning/**"
  - "components/ui/alerte-modif-planning.tsx"
---

# Synchronisation multi-appareil et temps réel

La base est la source de vérité ; localStorage est le cache de la semaine affichée. Tout le mécanisme vit dans `lib/sync.ts`, la couche d'accès dans `lib/persistance.ts`. Pour `/courses` et le cycle, voir aussi `courses-cycle.md`.

## Planning : cache local, push débouncé, horloge serveur

- `useSync()` (page `/planning`) hydrate au montage. Un gestionnaire abonné à `storePlanning` pousse en base (débounce 800 ms) à chaque écriture locale, sans qu'aucun handler de page n'ait à le faire.
- **Écriture planning = RPC atomique** `sauvegarder_planning(p_semaine, p_slots)` : upsert par (foyer, semaine), qui **remplace toute la semaine**. Le foyer est dérivé côté serveur.
- **Dirty-first** : une édition pose `planning_dirty` et, tant qu'il est posé, **le local fait foi**. Un pull n'a lieu que si le cache est vide ou si l'`updated_at` serveur est **strictement** plus récent que `planning_courant_maj`. Un cache non horodaté (offline, injecté en test) compte comme le plus frais.
- **Horloge 100 % serveur** : un trigger SQL `BEFORE INSERT OR UPDATE` pose `updated_at = now()` et écrase toute valeur client. Les payloads omettent donc `updated_at`, et le client lit la valeur renvoyée par le RETURNING.
- Les `pousser*()` sont **sérialisés** (garde anti-concurrence), pour éviter `duplicate key` et les échecs RLS.
- **Historique** : les semaines s'accumulent en base. `hydrater` purge une fois par session ce qui précède `semaineDecalee(courante, -12)` (fire-and-forget, garde `dejaPurge`).

## Rechargements après édition

- **Jamais de `setChargement(true)` sur un rechargement post-édition.** Une édition met l'état local à jour de façon optimiste ; seuls le montage, la navigation et la génération passent par un chargement (« Chargement… » au premier chargement seulement, corps estompé ensuite, cf. `courses-cycle.md`). Pourquoi : un chargement estompe la grille et ignore la navigation le temps d'un aller-retour réseau, et sa relecture écraserait l'état optimiste (#301).
- **Tout patch de `storePlanning` qui reflète une écriture déjà faite en base passe sous la garde `hydratationEnCours`** (cf. `modifierSlotDistant`). Pourquoi : sinon `planifierPush` relance un `sauvegarder_planning` de toute la semaine (double écriture).

## Navigation entre semaines

- Semaine affichée : store `useSemaineAffichee` (clé `semaine_affichee`). `planning_courant` / `courses_cochees` sont le cache **de cette semaine**.
- `naviguerVers(semaine)` **flushe d'abord les écritures en attente** (`attendreSync`) puis charge la cible (gardes d'hydratation, sans re-push). Sans ce flush, des données se perdent.
- Un rechargement complet revient à la semaine par défaut.
- **Lien `/planning?semaine=AAAA-Wnn`** (#336, `lib/lien-semaine.ts`) : lu une fois au montage (`lireLienSemaine`, plage du navigateur −12/+6, `null` si invalide), passé à `useSync(semaine)` → `hydrater(semaine)`, qui le charge à la place de la semaine par défaut, ou y navigue (`naviguerVers`) si l'app est déjà hydratée ou si le cache local fait foi. Il force la vue Semaine pour la visite (sans écrire la préférence), est ignoré si `?cycle=` est présent, et retiré par `history.replaceState`. Pourquoi : depuis `/ce-soir`, le week-end, la semaine par défaut est la suivante et le repas affiché n'y serait pas.
- **Semaine passée** (RG-24) : régénérer ou modifier un slot d'une semaine passée **non vide** ouvre une `ConfirmationModale`. Mécanique : chaque action mutante prend `force = false` et, en tête, `confirmerSiPassee(reprise)` diffère l'action puis la rejoue avec `force = true`. `selectionnerRecette` capture le slot **avant** la garde (le sélecteur se ferme). Le stepper personnes n'est pas gardé.

## Undo (US-09, RG-19)

`capturerSnapshotAnnulation` fige `planning_courant` + `courses_cochees` avant toute action destructive ; `restaurerSnapshotAnnulation` réécrit les deux directement dans les stores de `lib/stockage.ts`. Passer par `sauvegarderPlanningComplet` ré-effacerait les coches qu'on veut rendre. Le snapshot est **mono-niveau** et **expire** (~6 s), il reste local, et le toast utilise un id fixe (`annulation-planning`).

## Coches temps réel (RG-32)

- Table `etat_courses_article(foyer_id, ancre, cle, quantite, updated_at)` : **une ligne par article**. Pourquoi : un blob unique upserté faisait s'écraser deux membres qui cochaient en parallèle. Écritures directes sous RLS (`cocherArticleDistant` / `decocherArticleDistant` / `viderCochesDistantes`), `foyer_id` posé par `default mon_foyer()`.
- Le blob localStorage `courses_cochees` reste la représentation locale : `/courses` et `lib/coches.ts` l'ignorent tout du distant. `surChangementCoches` calcule le **diff** entre l'état synchronisé (`cochesConnues`) et le blob courant (`deriverOps`, `lib/coches-sync.ts`, pur et testé). Un blob vidé produit un seul `viderCochesDistantes`. `courses_dirty` = ops en attente.
- **Une écriture de l'utilisateur n'est jamais filtrée** : `surChangementCoches` ne s'arrête que sur `applicationDistanteEnCours`, que toute écriture interne pose (blob distant, event, purge). Toute hydratation **relit `courses_dirty` après chaque `await`** avant d'appliquer le distant (`hydraterCoches`, `chargerCycleDansCache`). Pourquoi : un drapeau « hydratation en cours » ignorait les coches posées pendant le chargement de `/courses` ; elles restaient locales, jamais poussées, et l'hydratation suivante les écrasait (coche perdue en revenant sur la liste).
- **Changement d'ancre = blob local vidé d'entrée** (`chargerCycleDansCache`, sauf dirty) : sinon une coche posée avant l'arrivée des coches distantes pousserait aussi celles de l'ancien cycle sous la nouvelle ancre.
- Abonnement `postgres_changes` filtré par `ancre`. Un event distant est fusionné par `appliquerEventLocal` **sous le drapeau `applicationDistanteEnCours`**, sinon il re-dériverait des ops en boucle. Un seul client Supabase mémoïsé gère les canaux. Abonnements sérialisés, avec purge du topic (parade à « cannot add callbacks after subscribe() »).
- **Présence « en magasin »** (RG-31) : `usePresenceCourses()`, canal Presence par foyer, une clé `crypto.randomUUID()` par onglet ; ≥ 2 clés signifie qu'un autre membre est sur la liste. Hook propre à `/courses`, hors de `useSync`, pour que `/planning` ne compte pas.

## Alerte intrusive de modification du planning (US-21)

- Abonnement `postgres_changes` à la table `planning`, en lisant seulement `new` (pas besoin de `REPLICA IDENTITY FULL`).
- **Changement distant ou écho de ma propre écriture ?** Toute écriture planning par RPC (`pousser`, `modifierSlotDistant`, `appliquerGenerationCycle`) retient l'`updated_at` que la base lui renvoie (`retenirHorodatageEcrit`, ensemble borné par semaine, clé à la microseconde) ; un event n'est un écho que si son horodatage est retenu. Tout autre event, même plus ancien que `planning_courant_maj`, déclenche un re-pull **forcé** (`chargerSemaineDansCache`, qui lève volontairement le « local fait foi ») puis comparaison `signaturePlanning` avant/après (`lib/planning-diff.ts`, pur). Si elle diffère, `declencherAlertePlanning`. Pourquoi : avec `<= planning_courant_maj`, le commit d'un autre membre passé juste avant le nôtre passait pour un écho ; son slot manquait au cache, et le `sauvegarder_planning` suivant (toute la semaine) l'effaçait en base.
- **Un event reçu pendant une écriture planning en vol est différé** (`ecrituresPlanningEnVol`, `eventsPlanningDifferes` : tous ses horodatages, par semaine) et jugé quand la dernière écriture se termine (`terminerEcriturePlanning`), contre les horodatages alors retenus, seulement si la semaine est encore celle voulue (`semainePlanningVoulue`, posée synchroniquement, remise à `null` par `couperTempsReel`). Toute nouvelle écriture planning (RPC) incrémente le compteur avant son `await`, retient ses `updated_at` et appelle `terminerEcriturePlanning` dans son `finally`, comme `pousser`, `modifierSlotDistant` et `appliquerGenerationCycle`. Celle-ci reporte aussi les jours générés dans le cache de la semaine affichée (`reporterGenerationSurSemaineAffichee`, miroir de l'upsert de `sauvegarder_cycle`). Pourquoi : l'écho Realtime arrive parfois avant la réponse HTTP de la RPC ; jugé tout de suite, il déclenchait une relecture qui écrasait les clics faits pendant le push, puis l'alerte sur sa propre écriture (#352).
- **Relecture avec des éditions locales en attente (`dirty`) : elles sont rejouées, pas écrasées** (#355). `traiterChangementPlanningDistant` lit le distant sans toucher au cache (`relireEnRejouantEditionsLocales`), puis `fusionnerEditionsLocales` (`lib/planning-fusion.ts`, pur) : un créneau modifié localement et intact à distance est rejoué ; modifié des deux côtés, le distant gagne (même contenu des deux côtés : ni rejoué ni en conflit). La fusion est écrite sous la garde d'hydratation, `dirty` reste posé si des créneaux ont été rejoués, et le push repart à la fin du traitement. Alerte ssi `signaturePlanning(distant) !== signaturePlanning(confirmé)`. Pourquoi : le re-pull forcé effaçait un clic de stepper pas encore poussé dès qu'un autre membre modifiait un autre repas.
- **Base du rejeu = instantané persistant `planning_confirme`** : dernier planning connu du serveur pour la semaine affichée, écrit par tout pull (`chargerSemaineDansCache`), tout push réussi (le planning poussé) et patché comme le cache par `modifierSlotDistant` / `reporterGenerationSurSemaineAffichee` (jumeaux) ; après un rejeu, il vaut le **distant**, pas la fusion, jusqu'au push suivant ; purgé par `reinitialiserCacheFoyer`. Rejeu seulement s'il est de la **même semaine** et si local et confirmé ont **les 7 jours** ; sinon chemin historique (le distant fait foi). Pourquoi : sans base fiable, on ne sait pas distinguer une édition locale d'un changement distant, et un créneau vidé à distance serait ressuscité.
- **Pas de push pendant une relecture US-21** : `pousser()` lui-même rend la main tant que `traitementPlanningEnCours` (`dirty` reste posé), car `attendreSync`, le remontage de `hydrater`, le retour en ligne et le re-push de fin de `pousser` l'appellent directement ; `suspendrePush()` coupe le minuteur au début du traitement et son `finally` relance le push si `dirty`. `attendreSync` part aussitôt un push replanifié par la relecture (sans attendre le débounce). Pourquoi : `sauvegarder_planning` remplace toute la semaine ; parti pendant la lecture, il effaçait en base le changement distant qu'on était en train de lire.
- **Event reçu pendant un traitement = une relecture finale**, pas jeté (`relecturePlanningDemandee`) : le `finally` relance `traiterChangementPlanningDistant` **avant** tout push, contre l'instantané devenu « distant ». Pourquoi : jeté, la fusion (sans ce second changement) repartait en push et l'effaçait en base.
- **Relecture avec rejeu en échec : aucun push avant une relecture réussie** (`relectureARefaire`, levé par toute lecture réussie) ; `pousser` refait d'abord la relecture au prochain déclencheur (édition, retour en ligne, navigation, remontage). Pourquoi : pousser le local sans elle effaçait le changement de l'autre membre.
- **Limite connue** : un push **déjà en vol** quand un autre membre écrit (requête partie avec l'ancien planning) écrase son créneau en base si le serveur l'applique après lui ; le rejeu n'y peut rien (l'event est différé jusqu'à la fin du push, qui a déjà effacé). Pourquoi : RPC « toute la semaine » sans contrôle de version ; une RPC par créneaux ou un `updated_at` attendu le corrigerait (migration, hors #355).
- **`signaturePlanning` lit personnes et restes avec leur défaut** (`personnesDuSlot`, 2 ; faux). Pourquoi : le générateur pose `personnes: 2` explicitement alors que `dbSlotToJourPlanning` l'omet ; comparer les champs bruts voyait un changement dans toute relecture qui suit une génération.
- La modale (`components/ui/alerte-modif-planning.tsx`, store `useAlertePlanning` / `acquitterAlertePlanning`) est montée **une seule fois dans `app/layout.tsx`** ; elle reste inerte hors de `/planning` et `/courses`.
- Côté cycle (`/courses`, vue Cycle) : voir `courses-cycle.md` (abonnement par semaine ISO, même règle d'écho par horodatages retenus).

## Changement de foyer

Après jonction, sortie ou déconnexion, appeler `reinitialiserCacheFoyer()` (vide planning, coches, drapeaux, horodatages, instantané confirmé et snapshot ; garde `semaine_affichee`) puis recharger. Sans cela, le dirty-first ferait foi avec l'ancien cache et un push différé l'écrirait sous le nouveau foyer.
