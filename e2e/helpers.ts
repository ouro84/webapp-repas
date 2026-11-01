// Helpers e2e partagés.
//
// Lecture de .env.local (Playwright ne charge pas les env Next) + nettoyage de
// l'état distant du compte de test (planning + coches) pour repartir d'une base
// vierge — nécessaire depuis la sync multi-device (#6) : sans ça, un planning
// persisté en base par un test précédent réapparaîtrait à l'hydratation et
// casserait l'état vide attendu.

import { readFileSync } from "node:fs";
import type { APIRequestContext, Page } from "@playwright/test";

export const E2E_EMAIL = process.env.E2E_EMAIL ?? "claude-e2e-test@example.com";
export const E2E_PASSWORD =
  process.env.E2E_PASSWORD ?? "E2E-Test-Claude-2026!";

// Lit une variable dans .env.local.
export function lireEnvLocal(cle: string): string {
  const ligne = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${cle}=`));
  if (!ligne) throw new Error(`${cle} introuvable dans .env.local`);
  return ligne.slice(cle.length + 1).trim().replace(/^"|"$/g, "");
}

/**
 * Supprime le planning et les coches du compte de test côté base (RLS
 * propriétaire → ne touche que ses propres lignes). Authentification REST par
 * mot de passe, comme auth.setup. À appeler en beforeEach des specs qui
 * dépendent d'un état distant vierge (#6, US-13).
 */
export async function nettoyerEtatDistant(
  request: APIRequestContext
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  });
  if (!auth.ok()) {
    throw new Error(
      `Auth REST du compte de test impossible : HTTP ${auth.status()}`
    );
  }
  const { access_token: jeton } = (await auth.json()) as {
    access_token: string;
  };
  const headers = { apikey: anon, Authorization: `Bearer ${jeton}` };

  // PostgREST exige un filtre pour DELETE ; foyer_id=not.is.null couvre toutes
  // les lignes visibles (la RLS « foyer » #56 restreint déjà au foyer du compte
  // de test). Les slots du planning partent en cascade.
  await request.delete(`${url}/rest/v1/planning?foyer_id=not.is.null`, {
    headers,
  });
  // Coches par-article (#56 PR4) : la table etat_courses (blob) a été remplacée.
  await request.delete(
    `${url}/rest/v1/etat_courses_article?foyer_id=not.is.null`,
    { headers }
  );
  // Articles manuels (#216) : résiduels d'un test précédent fausseraient l'état
  // vide/le compte d'articles attendu par les specs suivantes.
  await request.delete(
    `${url}/rest/v1/article_manuel?foyer_id=not.is.null`,
    { headers }
  );
}

/**
 * Supprime les articles manuels du compte de test (#216) via DELETE REST. À
 * appeler en beforeEach ET afterAll de toute spec qui en crée, en plus de
 * nettoyerEtatDistant si celui-ci n'est pas déjà appelé dans le même test.
 */
export async function nettoyerArticlesManuelsDistants(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.delete(
    `${url}/rest/v1/article_manuel?foyer_id=not.is.null`,
    { headers }
  );
}

/**
 * Supprime les réglages de génération du compte de test (#45) via DELETE REST.
 * À appeler en beforeEach ET afterAll de reglages.spec : le compte étant
 * partagé, un réglage non nettoyé ferait diverger les specs qui supposent le
 * comportement par défaut (ex. « génération = 2 personnes »).
 */
export async function nettoyerReglagesDistants(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.delete(`${url}/rest/v1/reglages?user_id=not.is.null`, {
    headers,
  });
}

// Jeton d'accès du compte de test (auth REST par mot de passe).
async function jetonTest(request: APIRequestContext): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  });
  if (!auth.ok()) {
    throw new Error(
      `Auth REST du compte de test impossible : HTTP ${auth.status()}`
    );
  }
  const { access_token: jeton } = (await auth.json()) as {
    access_token: string;
  };
  return { url, headers: { apikey: anon, Authorization: `Bearer ${jeton}` } };
}

/**
 * Remet le jour de courses du foyer de test à LUNDI (1) via PATCH REST — c'est
 * l'ancre du cycle de courses non calendaire (#257, `ancreCourante` de
 * lib/cycles.ts). Le foyer étant partagé (comme les réglages/le profil), une
 * spec qui le laisse à un autre jour (ex. jeudi) ferait diverger l'ancre vue
 * par les specs suivantes (courses.spec, coches-realtime.spec…), qui supposent
 * toutes l'ancrage par défaut lundi. Grant au niveau colonne (même pattern que
 * `profiles` en #22 PR1) : le rôle authenticated ne peut écrire QUE
 * `jour_courses` sur `foyers` ; la RLS (`id = mon_foyer()`) scope déjà à la
 * ligne du foyer de test — pas de filtre explicite par id nécessaire (mirroir
 * de `nettoyerReglagesDistants`). À appeler en beforeEach ET afterAll de toute
 * spec qui modifie le jour de courses (cf. cycle-courses.spec.ts).
 */
export async function reinitialiserJourCoursesDistant(
  request: APIRequestContext
): Promise<void> {
  await definirJourCoursesDistant(request, 1);
}

/**
 * Fixe le jour de courses du foyer de test à une valeur ISO arbitraire
 * (1=lundi…7=dimanche) — sert à faire tomber le cycle sur un jour ≠ lundi et
 * ainsi l'étaler sur DEUX semaines ISO (#257 : ancre=vendredi → ven/sam/dim
 * dans une semaine, lun-jeu dans la suivante), scénario qu'aucune spec ne
 * couvre par défaut (`reinitialiserJourCoursesDistant` remet toujours à 1).
 * Toute spec qui l'utilise DOIT restaurer via `reinitialiserJourCoursesDistant`
 * en afterAll (même règle que le reset, cf. commentaire ci-dessus).
 */
export async function definirJourCoursesDistant(
  request: APIRequestContext,
  jour: number
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.patch(`${url}/rest/v1/foyers?id=not.is.null`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { jour_courses: jour },
  });
}

/**
 * Supprime tous les masquages de recettes du compte de test (#105) via DELETE
 * REST. Le masquage (« suppression » d'une recette par défaut) persiste en base
 * pour l'utilisateur : sans nettoyage, une recette du catalogue masquée par un
 * test resterait absente du vivier pour les runs suivants (génération faussée).
 * À appeler en beforeEach ET afterAll de recettes.spec.
 */
export async function nettoyerMasquagesDistants(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.delete(`${url}/rest/v1/recette_masquee?foyer_id=not.is.null`, {
    headers,
  });
}

/**
 * Supprime toutes les préférences favoris/évités du foyer de test (#219) via
 * DELETE REST. Le compte étant partagé, une préférence résiduelle biaiserait
 * le tirage pondéré des specs de génération suivantes. À appeler en beforeEach
 * ET afterAll de recettes.spec (même esprit que nettoyerMasquagesDistants).
 */
export async function nettoyerPreferencesDistantes(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.delete(`${url}/rest/v1/recette_preference?foyer_id=not.is.null`, {
    headers,
  });
}

/**
 * Marque un compte comme ayant terminé l'onboarding (#22 PR2) via PATCH REST.
 * Indispensable depuis que le proxy redirige tout compte `onboarding_complete`
 * faux vers le tunnel `/bienvenue` : sans ça, le login d'un compte fraîchement
 * créé (signup → false par défaut) atterrit sur `/bienvenue` au lieu de
 * `/planning`. À appeler après `inscrire` pour les comptes jetables, et dans
 * `auth.setup` pour le compte partagé (défensif sur une base staging neuve — le
 * compte existant est déjà onboardé par le backfill de la migration).
 * Auth par mot de passe (compte partagé par défaut, ou un compte jetable donné).
 */
export async function marquerOnboardingCompletDistant(
  request: APIRequestContext,
  email: string = E2E_EMAIL,
  password: string = E2E_PASSWORD
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password },
  });
  if (!auth.ok()) {
    throw new Error(`Auth REST de ${email} impossible : HTTP ${auth.status()}`);
  }
  const { access_token: jeton } = (await auth.json()) as { access_token: string };
  // RLS UPDATE « ma propre ligne » → ne touche que le profil de ce compte (le
  // filtre est requis par PostgREST). Grant au niveau colonne : onboarding_complete
  // est modifiable par le rôle authenticated.
  await request.patch(`${url}/rest/v1/profiles?user_id=not.is.null`, {
    headers: { apikey: anon, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    data: { onboarding_complete: true },
  });
}

/**
 * Lit les réglages de génération d'un compte (par mot de passe) via GET REST —
 * sert à vérifier que l'onboarding les a bien calibrés (#174, RG-37). Renvoie la
 * ligne `reglages` du compte (RLS propriétaire) ou null si absente.
 */
export async function lireReglagesDistants(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<{
  personnes_defaut: number;
  vege_dejeuner_semaine: boolean;
  vege_diner_semaine: boolean;
} | null> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password },
  });
  if (!auth.ok()) {
    throw new Error(`Auth REST de ${email} impossible : HTTP ${auth.status()}`);
  }
  const { access_token: jeton } = (await auth.json()) as { access_token: string };
  const res = await request.get(
    `${url}/rest/v1/reglages?select=personnes_defaut,vege_dejeuner_semaine,vege_diner_semaine`,
    { headers: { apikey: anon, Authorization: `Bearer ${jeton}` } }
  );
  if (!res.ok()) {
    throw new Error(`Lecture des réglages impossible : HTTP ${res.status()}`);
  }
  const rows = (await res.json()) as Array<{
    personnes_defaut: number;
    vege_dejeuner_semaine: boolean;
    vege_diner_semaine: boolean;
  }>;
  return rows[0] ?? null;
}

/**
 * Lit les colonnes RGPD (#235) du profil d'un compte (par mot de passe) via
 * GET REST — vérifie que le signup a bien horodaté l'acceptation des CGU.
 */
export async function lireProfilRgpdDistant(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<{ cgu_version: number | null; cgu_acceptees_le: string | null }> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password },
  });
  if (!auth.ok()) {
    throw new Error(`Auth REST de ${email} impossible : HTTP ${auth.status()}`);
  }
  const { access_token: jeton } = (await auth.json()) as { access_token: string };
  const res = await request.get(
    `${url}/rest/v1/profiles?select=cgu_version,cgu_acceptees_le`,
    { headers: { apikey: anon, Authorization: `Bearer ${jeton}` } }
  );
  if (!res.ok()) {
    throw new Error(`Lecture du profil RGPD impossible : HTTP ${res.status()}`);
  }
  const rows = (await res.json()) as Array<{
    cgu_version: number | null;
    cgu_acceptees_le: string | null;
  }>;
  return rows[0] ?? { cgu_version: null, cgu_acceptees_le: null };
}

/**
 * Remet le consentement analytics (#236) du compte de test PARTAGÉ à NULL
 * (aucun choix) via PATCH REST. À appeler en beforeEach ET afterAll de
 * rgpd.spec.ts : un choix résiduel ferait diverger la lecture de l'interrupteur
 * « Vie privée » de /profil pour les runs suivants.
 */
export async function reinitialiserConsentementDistant(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.patch(`${url}/rest/v1/profiles?user_id=not.is.null`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { consentement_analytics: null },
  });
}

/**
 * Réinitialise l'identité du profil du compte de test (#22) : prénom et couleur
 * d'avatar remis à null via PATCH REST. Le compte étant partagé, un prénom
 * résiduel ferait dériver l'avatar de la nav d'un run à l'autre. NE touche PAS
 * onboarding_complete (laissé à true → pas de redirection onboarding en PR2).
 * À appeler en beforeEach ET afterAll de profil.spec.
 */
export async function reinitialiserProfilDistant(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  // RLS UPDATE « ma propre ligne » → ne touche que le profil du compte de test
  // (le filtre est requis par PostgREST). Grant au niveau colonne : prenom /
  // couleur_avatar sont modifiables par le rôle authenticated.
  await request.patch(`${url}/rest/v1/profiles?user_id=not.is.null`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { prenom: null, couleur_avatar: null },
  });
}

/**
 * Supprime les recettes de test du run (nom contenant le suffixe) via DELETE
 * REST — teardown de recettes.spec. Remplace la suppression via clics UI, qui
 * dépassait le timeout afterAll (re-render de la liste → « element detached »).
 * Filtre par suffixe : sans effet sur d'éventuels runs CI concurrents.
 */
export async function nettoyerRecettesDistantes(
  request: APIRequestContext,
  suffixe: string
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  // RLS « propriétaire » : seules les recettes perso du compte de test sont
  // supprimées (les globales user_id=null sont épargnées). recette_ingredient
  // part en cascade.
  await request.delete(
    `${url}/rest/v1/recette?nom=like.*${encodeURIComponent(suffixe)}*`,
    { headers }
  );
}

/**
 * Ferme la modale « Recettes en double » (ModaleDoublons, #56 PR3, RG-33) si
 * elle s'affiche après une jonction de foyer — elle apparaît dès que le
 * catalogue effectif du compte contient deux recettes de même nom (globales
 * ou du foyer rejoint), ce qui bloquerait sinon l'assertion suivante (modale
 * au-dessus du reste de la page). Comportement légitime de l'app, pas un bug :
 * tout parcours e2e qui rejoint un foyer par code doit tolérer son apparition.
 * No-op si la modale n'apparaît pas (délai court, ne ralentit pas le test).
 */
export async function fermerModaleDoublonsSiPresente(page: Page): Promise<void> {
  const modale = page.getByRole("dialog", { name: "Recettes en double" });
  // `isVisible()` seul n'attend pas (contrairement à `expect().toBeVisible()`) :
  // la modale peut apparaître après un court aller-retour réseau (RPC de
  // jonction puis détection des doublons) → il faut la GUETTER un court
  // instant, pas juste constater son absence immédiate.
  const apparue = await modale
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (apparue) {
    await modale.getByRole("button", { name: /Plus tard|Terminé/ }).click();
  }
}

// --- Demandes de panier (#308) : écritures réservées au service_role ---

function enTetesServiceRole(): { url: string; headers: Record<string, string> } {
  const cle = lireEnvLocal("SUPABASE_SERVICE_ROLE_KEY");
  return {
    url: lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL"),
    headers: { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
  };
}

/**
 * Recule `cree_le` ou `pris_le` d'une demande de panier de `minutes`, pour
 * simuler l'expiration paresseuse (RG-83 : en_attente > 5 min, en_cours >
 * 30 min) sans attendre. Les clients n'ont aucun droit d'écriture sur
 * `demande_panier` : passe par le service_role. Le décalage part de la valeur
 * en base (et non de l'horloge locale), pour rester juste malgré un écart
 * d'horloge entre la machine de test et Postgres.
 */
export async function vieillirDemandePanier(
  request: APIRequestContext,
  id: string,
  champ: "cree_le" | "pris_le",
  minutes: number
): Promise<void> {
  const { url, headers } = enTetesServiceRole();
  const lecture = await request.get(`${url}/rest/v1/demande_panier?id=eq.${id}&select=${champ}`, { headers });
  if (!lecture.ok()) throw new Error(`Lecture de la demande ${id} impossible : HTTP ${lecture.status()}`);
  const [ligne] = (await lecture.json()) as Array<Record<string, string | null>>;
  const valeur = ligne?.[champ];
  if (!valeur) throw new Error(`Demande ${id} : ${champ} absent, rien à vieillir`);
  const recule = new Date(new Date(valeur).getTime() - minutes * 60_000).toISOString();
  const maj = await request.patch(`${url}/rest/v1/demande_panier?id=eq.${id}`, {
    headers,
    data: { [champ]: recule },
  });
  if (!maj.ok()) throw new Error(`Vieillissement de la demande ${id} impossible : HTTP ${maj.status()}`);
}

/** Demandes actives (`en_attente` | `en_cours`) d'un foyer, lues en service_role. */
export async function demandesPanierActives(
  request: APIRequestContext,
  foyerId: string
): Promise<Array<{ id: string; statut: "en_attente" | "en_cours" }>> {
  const { url, headers } = enTetesServiceRole();
  const r = await request.get(
    `${url}/rest/v1/demande_panier?foyer_id=eq.${foyerId}&statut=in.(en_attente,en_cours)&select=id,statut`,
    { headers }
  );
  if (!r.ok()) throw new Error(`Lecture des demandes actives impossible : HTTP ${r.status()}`);
  return (await r.json()) as Array<{ id: string; statut: "en_attente" | "en_cours" }>;
}

/**
 * Supprime toutes les demandes de panier d'un foyer (service_role) : un test
 * qui a besoin d'un foyer sans historique (captures) crée cet état lui-même
 * et nettoie derrière lui, sans dépendre de l'ordre des tests.
 */
export async function supprimerDemandesPanier(request: APIRequestContext, foyerId: string): Promise<void> {
  const { url, headers } = enTetesServiceRole();
  const r = await request.delete(`${url}/rest/v1/demande_panier?foyer_id=eq.${foyerId}`, { headers });
  if (!r.ok()) throw new Error(`Suppression des demandes impossible : HTTP ${r.status()} — ${await r.text()}`);
}

/**
 * Déplace une demande de panier sur une autre ancre (service_role), sans passer
 * par un lancement : utile pour poser la demande d'un autre cycle (par exemple
 * pour tester que `etat_panier(p_ancre)` la filtre, #320). Un lancement réel sur
 * un autre cycle passe par la route (`{ ancre }`), le bouton de la carte ou
 * l'outil MCP `lancer_demande_panier`.
 */
export async function deplacerDemandePanier(request: APIRequestContext, id: string, ancre: string): Promise<void> {
  const { url, headers } = enTetesServiceRole();
  const r = await request.patch(`${url}/rest/v1/demande_panier?id=eq.${id}`, { headers, data: { ancre } });
  if (!r.ok()) throw new Error(`Déplacement de la demande ${id} impossible : HTTP ${r.status()} — ${await r.text()}`);
}

/** Enregistre l'exécuteur de panier d'un foyer (RPC service_role seulement, #308). */
export async function enregistrerExecuteurPanier(
  request: APIRequestContext,
  foyerId: string,
  urlWebhook: string,
  secret: string
): Promise<void> {
  const { url, headers } = enTetesServiceRole();
  const r = await request.post(`${url}/rest/v1/rpc/enregistrer_executeur_panier`, {
    headers,
    data: { p_foyer: foyerId, p_url: urlWebhook, p_secret: secret },
  });
  if (!r.ok()) throw new Error(`Enregistrement de l'exécuteur impossible : HTTP ${r.status()} — ${await r.text()}`);
}

/**
 * Supprime l'exécuteur de panier d'un foyer (service_role) et renvoie le
 * nombre d'exécuteurs qui restent pour ce foyer (0 attendu). Nettoie staging
 * et exerce le trigger qui supprime le secret Vault (#308).
 */
export async function supprimerExecuteurPanier(request: APIRequestContext, foyerId: string): Promise<number> {
  const { url, headers } = enTetesServiceRole();
  const suppression = await request.delete(`${url}/rest/v1/executeur_panier?foyer_id=eq.${foyerId}`, { headers });
  if (!suppression.ok()) throw new Error(`Suppression de l'exécuteur impossible : HTTP ${suppression.status()} — ${await suppression.text()}`);
  const relecture = await request.get(`${url}/rest/v1/executeur_panier?foyer_id=eq.${foyerId}&select=id`, { headers });
  if (!relecture.ok()) throw new Error(`Relecture de l'exécuteur impossible : HTTP ${relecture.status()}`);
  return ((await relecture.json()) as unknown[]).length;
}
