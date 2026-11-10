// Helpers e2e partagés.
//
// Lecture de .env.local (Playwright ne charge pas les env Next) + nettoyage de
// l'état distant du compte de test (planning + coches) pour repartir d'une base
// vierge — nécessaire depuis la sync multi-device (#6) : sans ça, un planning
// persisté en base par un test précédent réapparaîtrait à l'hydratation et
// casserait l'état vide attendu.

import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { APIRequestContext, Page, WebSocket } from "@playwright/test";

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

// Une seule connexion par mot de passe et par compte (#404) : le jeton est
// gardé par worker jusqu'à une minute de son expiration, et `inscrireDistant`
// l'amorce avec celui du signup. Pourquoi : l'Auth de staging limite les
// connexions par IP ; avec 4 workers jetables en parallèle, la CI prenait des
// 429 (`suppression-compte.spec`, `panier-demande.spec`), et une preuve en
// `--repeat-each` sur le compte partagé s'en approchait (deux `nettoyer*` par
// test). Toute lecture ou écriture REST d'un compte passe par `sessionDe`.
const sessions = new Map<string, { jeton: string; expire: number }>();

function memoriserSession(email: string, corps: { access_token?: string; expires_in?: number }): void {
  if (!corps.access_token) return;
  sessions.set(email, {
    jeton: corps.access_token,
    expire: Date.now() + (corps.expires_in ?? 3600) * 1000,
  });
}

/** Jeton d'accès d'un compte (connexion par mot de passe au plus une fois par worker). */
export async function sessionDe(
  request: APIRequestContext,
  email: string = E2E_EMAIL,
  password: string = E2E_PASSWORD
): Promise<string> {
  const connue = sessions.get(email);
  if (connue && connue.expire - Date.now() > 60_000) return connue.jeton;
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password },
  });
  if (!auth.ok()) {
    throw new Error(`Auth REST de ${email} impossible : HTTP ${auth.status()}`);
  }
  const corps = (await auth.json()) as { access_token: string; expires_in?: number };
  memoriserSession(email, corps);
  return corps.access_token;
}

/**
 * Signup REST idempotent d'un compte jetable (confirmation email désactivée sur
 * staging : le compte est utilisable aussitôt). Le jeton renvoyé par le signup
 * amorce `sessionDe`, sans connexion supplémentaire. `onboarde` (défaut) marque
 * l'onboarding terminé, sinon le login atterrirait sur /bienvenue.
 */
export async function inscrireDistant(
  request: APIRequestContext,
  email: string,
  { onboarde = true }: { onboarde?: boolean } = {}
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const r = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: anon, "Content-Type": "application/json" },
    data: { email, password: E2E_PASSWORD },
  });
  if (![200, 400, 422].includes(r.status())) {
    throw new Error(`Signup ${email} impossible : HTTP ${r.status()} — ${await r.text()}`);
  }
  if (r.status() === 200) memoriserSession(email, (await r.json()) as { access_token?: string });
  if (onboarde) await marquerOnboardingCompletDistant(request, email, E2E_PASSWORD);
}

/** Préfixes des topics temps réel de l'app (`realtime:<prefixe>…`). */
export type PrefixeRealtime =
  | "planning:" // planning de la semaine (`/planning`, `planning:<foyer>:<semaine>`)
  | "planning-cycle:" // planning du cycle (`/courses`, #259)
  | "coches:" // coches d'ingrédients (`/courses`, `coches:<foyer>:<ancre>`)
  | "articles-manuels:"; // articles manuels (`/courses`, #216)

/**
 * Résout quand Supabase Realtime confirme un abonnement `postgres_changes`
 * (message `system` « ok ») sur un topic `realtime:<prefixe>…`. À appeler AVANT
 * `goto` : le WebSocket s'ouvre au chargement, et `page.on("websocket")` ne
 * rejoue pas une connexion déjà ouverte. Signal réel plutôt qu'une attente
 * fixe (trop courte : event manqué ; trop longue : temps perdu).
 *
 * Rejette après `delaiMs` avec un message qui nomme le protocole attendu, ou
 * dès que la page se ferme avant le signal (#357 : sinon la promesse restait en
 * suspens et l'appelant n'échouait qu'au timeout du test), et retire ses
 * écouteurs (WebSocket et page) dès que le signal est reçu, le délai écoulé ou
 * la page fermée. Partagé par `alerte-planning.spec` et `coches-concurrence.spec`.
 */
export function abonnementRealtimePret(
  page: Page,
  prefixe: PrefixeRealtime,
  delaiMs = 30_000
): Promise<void> {
  const promesse = new Promise<void>((resoudre, rejeter) => {
    const ecouteurs: Array<() => void> = [];
    const nettoyer = () => {
      clearTimeout(minuteur);
      page.off("websocket", surWebSocket);
      page.off("close", surFermeture);
      for (const retirer of ecouteurs) retirer();
    };
    const surFermeture = () => {
      nettoyer();
      rejeter(
        new Error(
          `Page fermée avant la confirmation de l'abonnement temps réel « realtime:${prefixe} ».`
        )
      );
    };
    const minuteur = setTimeout(() => {
      nettoyer();
      rejeter(
        new Error(
          `Abonnement temps réel « realtime:${prefixe} » non confirmé après ${delaiMs} ms : ` +
            "trame attendue = message `system` avec `extension: postgres_changes` et " +
            "`status: ok` (serialiseur 2.0.0 de realtime-js : [join_ref, ref, topic, event, payload])."
        )
      );
    }, delaiMs);
    const surWebSocket = (ws: WebSocket) => {
      const surTrame = ({ payload }: { payload: string | Buffer }) => {
        if (typeof payload !== "string") return;
        try {
          type Charge = { extension?: string; status?: string };
          const brut: unknown = JSON.parse(payload);
          // Sérialiseur 2.0.0 de realtime-js : [join_ref, ref, topic, event, payload] ;
          // 1.0.0 : objet { topic, event, payload }.
          const [topic, event, charge] = Array.isArray(brut)
            ? [brut[2] as string, brut[3] as string, brut[4] as Charge]
            : [
                (brut as { topic?: string }).topic,
                (brut as { event?: string }).event,
                (brut as { payload?: Charge }).payload,
              ];
          if (
            topic?.startsWith(`realtime:${prefixe}`) &&
            event === "system" &&
            charge?.extension === "postgres_changes" &&
            charge.status === "ok"
          ) {
            nettoyer();
            resoudre();
          }
        } catch {
          // Trame non JSON (heartbeat binaire, etc.) : ignorée.
        }
      };
      ws.on("framereceived", surTrame);
      ecouteurs.push(() => ws.off("framereceived", surTrame));
    };
    page.on("websocket", surWebSocket);
    page.on("close", surFermeture);
  });
  // Un rejet après la fin d'un test qui a échoué plus tôt ne doit pas planter le
  // worker ; l'appelant qui attend la promesse reçoit bien l'erreur.
  promesse.catch(() => {});
  return promesse;
}

/**
 * Attend la fin du chargement de la page (#400) : plus aucune zone
 * `role="status"` « Chargement… » dans `main` (le filtre sur le texte écarte
 * l'indicateur de synchro de /planning, lui aussi `role="status"`). Pourquoi :
 * un squelette rend des `ul > li` (7 jours du planning) et du texte factice
 * transparent que `getByText` trouve ; `main li` n'est plus une preuve de page
 * chargée.
 *
 * À appeler juste après un `goto`, un `reload` ou un `waitForURL` : le
 * squelette est prérendu, donc présent dès le premier rendu. Après une
 * navigation SPA ou un changement de vue, l'ancien `main` peut encore être
 * affiché sans squelette : faire suivre d'un marqueur réel (rôle ARIA, qui
 * exclut le contenu `aria-hidden` du squelette, ou
 * `main button[aria-label^='Voir la recette']`). Un `toHaveCount(0)` seul passe
 * à son premier essai (cf. e2e.md, « Pièges Playwright »).
 */
export async function attendreChargementTermine(
  page: Page,
  options: { timeout?: number } = {}
): Promise<void> {
  await expect(page.locator("main").first()).toBeVisible(options);
  await expect(
    page.locator("main [role=status]").filter({ hasText: "Chargement…" })
  ).toHaveCount(0, options);
}

/**
 * Supprime le planning et les coches du compte de test côté base (RLS
 * propriétaire → ne touche que ses propres lignes). Session REST du compte
 * mise en cache (`sessionDe`). À appeler en beforeEach des specs qui
 * dépendent d'un état distant vierge (#6, US-13).
 */
export async function nettoyerEtatDistant(
  request: APIRequestContext
): Promise<void> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const jeton = await sessionDe(request, E2E_EMAIL, E2E_PASSWORD);
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

// En-têtes REST du compte de test (session mise en cache, `sessionDe`).
// Exporté pour les specs qui relisent la base en boucle (`coches-concurrence.spec`).
export async function jetonTest(request: APIRequestContext): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const jeton = await sessionDe(request, E2E_EMAIL, E2E_PASSWORD);
  return { url, headers: { apikey: anon, Authorization: `Bearer ${jeton}` } };
}

/**
 * Planifie des repas côté base pour le compte de test (#336) : résout chaque
 * recette du catalogue par son NOM exact (ids = uuid en base, ≠ fixtures) puis
 * écrit les slots via la RPC `sauvegarder_slots` (upsert des seuls créneaux
 * fournis, planning créé s'il n'existe pas). Sert à rendre /ce-soir
 * déterministe quelle que soit l'heure d'exécution. Nettoyé par
 * `nettoyerEtatDistant`.
 */
export async function planifierRepasDistant(
  request: APIRequestContext,
  semaine: string,
  repas: Array<{
    jour: string;
    typeRepas: "dejeuner" | "diner";
    nomRecette: string;
    restes?: boolean;
  }>
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  const slots = [];
  for (const r of repas) {
    const rep = await request.get(
      `${url}/rest/v1/recette?select=id&nom=eq.${encodeURIComponent(r.nomRecette)}&limit=1`,
      { headers }
    );
    const lignes = (await rep.json()) as Array<{ id: string }>;
    if (!rep.ok() || lignes.length === 0) {
      throw new Error(`Recette du catalogue introuvable : « ${r.nomRecette} »`);
    }
    slots.push({
      recette_id: lignes[0]!.id,
      jour: r.jour,
      type_repas: r.typeRepas,
      personnes: 2,
      restes: r.restes ?? false,
    });
  }
  const ecriture = await request.post(`${url}/rest/v1/rpc/sauvegarder_slots`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { p_semaine: semaine, p_slots: slots },
  });
  if (!ecriture.ok()) {
    throw new Error(
      `Écriture des slots impossible : HTTP ${ecriture.status()} ${await ecriture.text()}`
    );
  }
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
 * Étire (ou raccourcit) le cycle d'ancre donnée à `longueur` jours (#352) :
 * upsert REST de `cycle_courses` (`on_conflict=foyer_id,ancre`, miroir de
 * `definirLongueurCycle`, lib/persistance.ts ; `foyer_id` posé par le default
 * `mon_foyer()`). Sert à tester un cycle de plus ou moins de 7 jours. Toute spec
 * qui l'utilise DOIT nettoyer via `nettoyerLongueursCycleDistantes` en
 * beforeEach ET afterAll (foyer partagé).
 */
export async function definirLongueurCycleDistant(
  request: APIRequestContext,
  ancre: string,
  longueur: number
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  const reponse = await request.post(
    `${url}/rest/v1/cycle_courses?on_conflict=foyer_id,ancre`,
    {
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      data: { ancre, longueur },
    }
  );
  if (!reponse.ok()) {
    throw new Error(
      `Longueur de cycle impossible à poser : HTTP ${reponse.status()} ${await reponse.text()}`
    );
  }
}

/**
 * Supprime toutes les longueurs de cycle étirées du foyer de test (#352) : sans
 * ligne, un cycle fait 7 jours (LONGUEUR_DEFAUT). Le foyer étant partagé, une
 * longueur résiduelle changerait la fenêtre de /courses et de la vue Cycle pour
 * les specs suivantes.
 */
export async function nettoyerLongueursCycleDistantes(
  request: APIRequestContext
): Promise<void> {
  const { url, headers } = await jetonTest(request);
  await request.delete(`${url}/rest/v1/cycle_courses?foyer_id=not.is.null`, {
    headers,
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
  const jeton = await sessionDe(request, email, password);
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
  max_dejeuner_semaine: string;
} | null> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const jeton = await sessionDe(request, email, password);
  const res = await request.get(
    `${url}/rest/v1/reglages?select=personnes_defaut,vege_dejeuner_semaine,vege_diner_semaine,max_dejeuner_semaine`,
    { headers: { apikey: anon, Authorization: `Bearer ${jeton}` } }
  );
  if (!res.ok()) {
    throw new Error(`Lecture des réglages impossible : HTTP ${res.status()}`);
  }
  const rows = (await res.json()) as Array<{
    personnes_defaut: number;
    vege_dejeuner_semaine: boolean;
    vege_diner_semaine: boolean;
    max_dejeuner_semaine: string;
  }>;
  return rows[0] ?? null;
}

/**
 * Lit les slots de planning d'un compte (par mot de passe) via GET REST, tous
 * plannings confondus (#386) : vérifie EN BASE ce que la génération a écrit,
 * la vue Cycle masquant au rendu les créneaux « aucun ». Une ligne par slot
 * rempli (`planning_slot.recette_id` est non nul).
 */
export async function lirePlanningDistant(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<Array<{ semaine: string; jour: string; type_repas: string }>> {
  const url = lireEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
  const anon = lireEnvLocal("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const jeton = await sessionDe(request, email, password);
  const res = await request.get(
    `${url}/rest/v1/planning?select=semaine,planning_slot(jour,type_repas)`,
    { headers: { apikey: anon, Authorization: `Bearer ${jeton}` } }
  );
  if (!res.ok()) {
    throw new Error(`Lecture du planning impossible : HTTP ${res.status()}`);
  }
  const rows = (await res.json()) as Array<{
    semaine: string;
    planning_slot: Array<{ jour: string; type_repas: string }>;
  }>;
  return rows.flatMap((p) =>
    p.planning_slot.map((s) => ({ semaine: p.semaine, ...s }))
  );
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
  const jeton = await sessionDe(request, email, password);
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
