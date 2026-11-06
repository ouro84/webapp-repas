# Phase 2 de #362 : un seul moteur de coche, horodaté (spec issue du grilling)

Grilling du 2026-11-06 avec Arnaud, questions Q1 à Q15. Toutes les recommandations ont été acceptées ; seul le délai entre les PR a été ramené à 1 h.

## Problème

Les coches d'ingrédients dérivés (`etat_courses_article`) se décochent par `DELETE`. L'état « décoché » n'a donc ni ligne ni horodatage, ce qui laisse deux limites connues (`.claude/rules/sync-planning.md`) :

- **(a)** l'écho tardif d'une coche, livré après la décoche, peut laisser la case cochée jusqu'à la prochaine hydratation ;
- **(b)** la coche d'un autre membre, écrite pendant que notre écriture sur le même article est en vol, est ignorée à l'écran.

Les articles manuels (`article_manuel.coche` + `updated_at`) suivent un second moteur, écrit à part dans `lib/sync.ts`.

## Décisions

1. **Modèle (Q2, Q6).** `etat_courses_article` gagne `coche boolean not null default true`.
   - Décocher = upsert `coche = false` (ligne conservée, `updated_at` posé par trigger).
   - « Tout décocher » et la régénération RG-13 (`sauvegarder_cycle`) = `UPDATE … set coche = false … returning`.
   - `DELETE` réservé aux purges : vieux cycles (`purgerCyclesAvant`), suppression de compte, nettoyage de foyer.
2. **Lecteurs (Q7).** Tout lecteur de coches filtre `coche = true` : `chargerCochesDistantes` (synchro, MCP, exécuteur), le clonage SQL de `quitter_foyer`.
3. **Moteur (Q4, Q9).** `lib/moteur-coches.ts`, générique, deux adaptateurs : `etat_courses_article` (clé `nom|unité`, valeur = quantité) et `article_manuel` (clé = `id`).
   - Une écriture en vol par clé ; le dernier geste gagne.
   - Arbitrage : **dernier commit gagnant** sur `updated_at`. Un événement temps réel s'applique s'il est plus récent que l'horodatage connu de la clé.
   - Un événement reçu pendant une écriture (ou une opération en file) sur sa clé est différé, puis jugé contre l'horodatage renvoyé par la base.
4. **Hors ligne (Q3, Q11, Q12, Q13).** File hors ligne pour les deux sortes, persistée.
   - Chaque opération porte son `ancre` ; le rejeu écrit dans cette ancre.
   - Un échec met en file et passe l'indicateur à « hors ligne », sans toast.
   - Opération sur un article manuel disparu (0 ligne) : abandonnée, loggée.
5. **Local (Q8).** Le blob `courses_cochees` reste la vue des ingrédients (RG-12, annulation US-09, page). Les horodatages par clé et la file sont rangés à côté. L'annulation passe par le diff du blob, qui alimente le moteur.
6. **Jumeaux (Q14).** UI, `cocher_article` (MCP) et `cocher_article_demande` (exécuteur) passent par les mêmes fonctions de `lib/persistance.ts` et basculent ensemble.
7. **Livraison (Q5, Q15).**
   - **PR 1** : colonne + filtres + clonage.
   - **PR 2** : moteur, adaptateurs, bascule des écritures, mergée au plus tôt **1 h** après le déploiement en prod de la PR 1 (Arnaud seul client actif).
8. **Preuve (Q10).** Table de cas sur le moteur (faux transport) pour (a) et (b) dans tous les ordres, e2e à deux contextes navigateur (coche, décoche, coche concurrente), e2e staging `courses*`, `coches-realtime` et MCP avant chaque PR.
