*Dernière mise à jour : 15 juillet 2026*

*Cette politique explique quelles données personnelles « On mange quoi ? » collecte, pourquoi, et comment les faire valoir tes droits.*

## Qui est responsable de tes données ?

Arnaud Solente, éditeur de l'application (voir les *Mentions légales*), est responsable du traitement de tes données personnelles. Contact : [arnaud.solente+omq@gmail.com](mailto:arnaud.solente+omq@gmail.com).

## Quelles données sont collectées ?

- **Compte** : adresse email, mot de passe (jamais stocké en clair — géré par le prestataire d'authentification Supabase).
- **Profil** : prénom, couleur d'avatar (choisie par toi, aucune photo).
- **Contenu que tu crées** : recettes personnelles, réglages de génération, plannings, listes de courses et articles manuels, foyer (composition, code d'invitation).
- **Préférences** : réglages d'affichage (thème clair/sombre), consentement au suivi de mesure d'audience (voir plus bas).
- **Données techniques** : journaux d'erreurs applicatives (voir « Sentry » ci-dessous), et les données techniques usuelles de toute requête web (adresse IP, journaux serveur) traitées par notre hébergeur.

Nous ne collectons **aucune donnée de santé ni de régime alimentaire médical** — les préférences (végétarien, saisonnalité…) sont de simples réglages de génération de menus, pas des données de santé au sens du RGPD.

## Pourquoi ces données sont-elles traitées ?

| Finalité | Base légale |
|---|---|
| Fournir le service (compte, planning, courses, partage en foyer) | Exécution des CGU que tu as acceptées |
| Sécurité et prévention des abus (limitation du nombre de générations par minute) | Intérêt légitime |
| Mesure d'audience anonymisée (si tu l'acceptes) | Consentement |
| Suivi et correction des erreurs applicatives | Intérêt légitime |

## Qui a accès à ces données ? (sous-traitants)

| Prestataire | Rôle | Données concernées |
|---|---|---|
| **Supabase** | Base de données, authentification | Toutes les données de compte et de contenu |
| **Vercel** | Hébergement de l'application | Requêtes techniques, journaux serveur |
| **Sentry** | Suivi des erreurs applicatives | Traces d'erreur techniques (pas d'enregistrement de session, pas de traçage utilisateur) |
| **Upstash** | Limitation anti-abus des requêtes de génération | Identifiant de compte (aucune donnée de contenu) |

Deux prestataires additionnels sont **prévus mais pas encore actifs** à la date de cette version :

- **Resend** (envoi d'emails transactionnels — réinitialisation de mot de passe notamment). Non installé à ce jour.
- **PostHog** (hébergement européen) pour la mesure d'audience, **uniquement si tu acceptes** le suivi analytics via le bandeau cookies. Non installé à ce jour — cette politique sera mise à jour à son activation.

Aucune de ces données n'est vendue à des tiers ni utilisée à des fins publicitaires.

## Cookies et traceurs

Un bandeau te demande ton choix à ta première visite (voir « Consentement au suivi », plus bas). Trois catégories :

- **Strictement nécessaires** (toujours actifs, non soumis à consentement) : cookie de session d'authentification (Supabase), mémorisation de ton choix de consentement lui-même.
- **Mesure d'audience cookieless** (Vercel Analytics / Speed Insights) : agrégée, sans identifiant individuel ni cookie — considérée exempte de consentement.
- **Mesure d'audience avec identifiant** (future intégration PostHog, voir ci-dessus) : **soumise à ton consentement explicite**, révocable à tout moment depuis `/profil` (section « Vie privée »).

Si ton navigateur envoie le signal **Do Not Track**, ton choix est automatiquement réglé sur le refus, sans que le bandeau ne s'affiche.

## Consentement au suivi

Ton choix (accepté / refusé) est mémorisé sur ton appareil et associé à ton compte si tu es connecté. Tu peux le modifier à tout moment :
- en rouvrant le bandeau (il ne réapparaît que si tu supprimes les données locales de ton navigateur) ;
- via l'interrupteur de la section **« Vie privée »** de `/profil`.

## Combien de temps tes données sont-elles conservées ?

- Ton compte et ton contenu sont conservés tant que ton compte existe.
- L'historique des plannings est automatiquement purgé au-delà de 12 semaines (ne concerne que l'historique ancien, pas le planning courant).
- À la suppression de ton compte (voir *CGU*, article 6), tes données sont supprimées, à l'exception des données que la loi nous impose de conserver plus longtemps (aucune à ce jour pour un usage non commercial).

## Utilisateurs antérieurs à cette politique

Si tu avais déjà un compte avant la publication de cette politique, ton compte a été automatiquement marqué comme ayant accepté la version 1 des CGU à la date de mise en place de ce mécanisme — l'application n'ayant, jusqu'ici, jamais été ouverte au public, cette régularisation ne modifie ni la nature ni l'usage des données déjà traitées.

## Tes droits

Conformément au RGPD, tu disposes d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité sur tes données. Pour l'exercer, écris à [arnaud.solente+omq@gmail.com](mailto:arnaud.solente+omq@gmail.com) — ta demande est traitée manuellement à ce jour (un export/suppression en libre-service est prévu, non encore disponible).

Tu peux aussi introduire une réclamation auprès de la CNIL ([cnil.fr](https://www.cnil.fr)).

## Modifications

Cette politique peut évoluer. La date de dernière mise à jour figure en tête de page.
