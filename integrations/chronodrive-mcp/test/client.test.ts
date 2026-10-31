// Client Chronodrive (#308, Task 1) : login, session, reconnexion, en-têtes, erreurs sans secret.
// Aucun appel réseau : `fetch` est simulé par une table de routes, l'horloge est simulée.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClientChronodrive, ErreurChronodrive, chargerConfig, type Config } from "../src/client.ts";

const EMAIL = "arnaud.test@example.org";
const MOT_DE_PASSE = "M0t-de-passe!secret";
const JETON = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature-jeton-1";
// Constantes publiques volontairement fantaisistes : le client doit les lire dans le HTML.
const CLES = {
  CUSTOMERS: "11111111-aaaa-4bbb-8ccc-000000000001",
  CARTS: "22222222-aaaa-4bbb-8ccc-000000000002",
  PRODUCTS: "33333333-aaaa-4bbb-8ccc-000000000003",
  FAVOURITE_PRODUCTS: "44444444-aaaa-4bbb-8ccc-000000000004",
};
const CLIENT_ID = "clientIdDeTest_42xyz";
const HTML_ACCUEIL = `<html><script>window.__NUXT__={config:{public:{${Object.entries(CLES)
  .map(([service, cle]) => `CHR_API_${service}_APIKEY:"${cle}"`)
  .join(",")},CLIENT_ID:"${CLIENT_ID}"}}}</script></html>`;

type Appel = { methode: string; url: URL; entetes: Headers; corps: string | null };
type Route = { methode: string; motif: RegExp; reponse: (appel: Appel, n: number) => Response | Promise<Response> };

function json(corps: unknown, statut = 200, entetes: [string, string][] = []): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: [["content-type", "application/json"], ...entetes] });
}

// Table de routes : chaque requête doit trouver sa route, sinon le test échoue bruyamment.
function fetchSimule(routes: Route[]) {
  const appels: Appel[] = [];
  const compteurs = new Map<Route, number>();
  const fn = async (entree: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(entree instanceof Request ? entree.url : String(entree));
    const appel: Appel = {
      methode: (init.method ?? "GET").toUpperCase(),
      url,
      entetes: new Headers(init.headers),
      corps: typeof init.body === "string" ? init.body : null,
    };
    appels.push(appel);
    const route = routes.find((r) => r.methode === appel.methode && r.motif.test(`${url.origin}${url.pathname}`));
    if (!route) throw new Error(`route non simulée : ${appel.methode} ${url.origin}${url.pathname}`);
    const n = (compteurs.get(route) ?? 0) + 1;
    compteurs.set(route, n);
    return route.reponse(appel, n);
  };
  const compter = (methode: string, motif: RegExp) =>
    appels.filter((a) => a.methode === methode && motif.test(`${a.url.origin}${a.url.pathname}`)).length;
  return { fetch: fn as typeof fetch, appels, compter };
}

const R_ACCUEIL = /^https:\/\/www\.chronodrive\.com\/$/;
const R_LOGIN = /^https:\/\/connect\.chronodrive\.com\/identity\/v1\/password\/login$/;
const R_AUTORISATION = /^https:\/\/connect\.chronodrive\.com\/oauth\/authorize$/;
const R_JETON = /^https:\/\/connect\.chronodrive\.com\/oauth\/token$/;
const R_MOI = /^https:\/\/api\.chronodrive\.com\/v1\/customers\/me$/;
const R_PANIERS = /^https:\/\/api\.chronodrive\.com\/v1\/customers\/me\/carts$/;

// Routes d'un login qui réussit ; le n-ième jeton délivré vaut `${JETON}-${n}`.
function routesLogin(): Route[] {
  return [
    { methode: "GET", motif: R_ACCUEIL, reponse: () => new Response(HTML_ACCUEIL, { headers: { "content-type": "text/html" } }) },
    {
      methode: "POST",
      motif: R_LOGIN,
      reponse: () => json({ tkn: "tkn-de-test" }, 200, [["set-cookie", "sess=abc; Path=/; HttpOnly"], ["set-cookie", "trk=def; Path=/"]]),
    },
    {
      methode: "GET",
      motif: R_AUTORISATION,
      reponse: () => new Response(`<script>parent.postMessage({"type":"authorization_response","response":{"code":"code-de-test","state":""}})</script>`),
    },
    {
      methode: "POST",
      motif: R_JETON,
      reponse: (_a, n) => json({ id_token: "id-token", access_token: `${JETON}-${n}`, expires_in: 7200, token_type: "Bearer" }),
    },
    { methode: "GET", motif: R_MOI, reponse: () => json({ id: 987654, firstName: "Arnaud" }) },
  ];
}

function nouvelleConfig(): Config {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-client-"));
  return { email: EMAIL, motDePasse: MOT_DE_PASSE, siteId: "1034", mode: "DRIVE", fichierSession: join(dossier, "session.json") };
}

function horloge(depart = 1_800_000_000_000) {
  const h = { t: depart, maintenant: () => h.t };
  return h;
}

test("login complet : password → authorize (PKCE S256) → token, session persistée en 600", async () => {
  const config = nouvelleConfig();
  const h = horloge();
  const sim = fetchSimule([...routesLogin(), { methode: "GET", motif: R_PANIERS, reponse: () => json({ content: [{ id: "panier-1" }] }) }]);
  const client = new ClientChronodrive(config, { fetch: sim.fetch, maintenant: h.maintenant });

  const paniers = await client.appeler<{ content: { id: string }[] }>("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" });
  assert.equal(paniers.content[0].id, "panier-1");

  const ordre = sim.appels.map((a) => `${a.methode} ${a.url.host}${a.url.pathname}`);
  assert.deepEqual(ordre, [
    "GET www.chronodrive.com/",
    "POST connect.chronodrive.com/identity/v1/password/login",
    "GET connect.chronodrive.com/oauth/authorize",
    "POST connect.chronodrive.com/oauth/token",
    "GET api.chronodrive.com/v1/customers/me",
    "GET api.chronodrive.com/v1/customers/me/carts",
  ]);

  const [, login, autorisation, jeton] = sim.appels;
  const corpsLogin = JSON.parse(login.corps ?? "{}");
  assert.equal(corpsLogin.email, EMAIL);
  assert.equal(corpsLogin.password, MOT_DE_PASSE);
  assert.equal(corpsLogin.scope, "openid profile email phone full_write offline_access");

  const p = autorisation.url.searchParams;
  assert.equal(p.get("tkn"), "tkn-de-test");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("response_mode"), "web_message");
  assert.equal(p.get("prompt"), "none");
  assert.equal(p.get("redirect_uri"), "https://www.chronodrive.com");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.equal(autorisation.entetes.get("cookie"), "sess=abc; trk=def");
  assert.equal(autorisation.entetes.get("origin"), "https://www.chronodrive.com");

  const corpsJeton = JSON.parse(jeton.corps ?? "{}");
  assert.equal(corpsJeton.grant_type, "authorization_code");
  assert.equal(corpsJeton.code, "code-de-test");
  assert.equal(corpsJeton.redirect_uri, "https://www.chronodrive.com");
  // PKCE S256 : le challenge envoyé à authorize est le SHA-256 base64url du verifier envoyé au jeton.
  assert.equal(createHash("sha256").update(corpsJeton.code_verifier).digest("base64url"), p.get("code_challenge"));
  assert.ok(corpsJeton.code_verifier.length >= 43);

  const session = JSON.parse(readFileSync(config.fichierSession, "utf8"));
  assert.equal(session.accessToken, `${JETON}-1`);
  assert.equal(session.expireA, h.t + 7200 * 1000);
  assert.equal(session.clientId, CLIENT_ID);
  assert.equal(session.customerId, "987654");
  assert.deepEqual(session.cles, CLES);
  // Windows ne connaît que le bit lecture seule : le mode 600 ne se vérifie que sur un système POSIX (NAS).
  if (process.platform !== "win32") assert.equal(statSync(config.fichierSession).mode & 0o777, 0o600);

  // Un second client (nouveau processus) reprend la session du fichier, sans login.
  const sim2 = fetchSimule([...routesLogin(), { methode: "GET", motif: R_PANIERS, reponse: () => json({ content: [] }) }]);
  const client2 = new ClientChronodrive(config, { fetch: sim2.fetch, maintenant: h.maintenant });
  await client2.appeler("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" });
  assert.equal(sim2.compter("POST", R_LOGIN), 0);
  assert.equal(sim2.appels[0].entetes.get("authorization"), `Bearer ${JETON}-1`);
  assert.equal(await client2.idClient(), "987654");
});

test("constantes lues dans le HTML du site, jamais en dur", async () => {
  const sim = fetchSimule([...routesLogin(), { methode: "GET", motif: /\/v1\/carts\/c1$/, reponse: () => json({ items: [] }) }]);
  const client = new ClientChronodrive(nouvelleConfig(), { fetch: sim.fetch, maintenant: horloge().maintenant });
  await client.appeler("GET", "/v1/carts/c1", { service: "CARTS" });

  const login = sim.appels.find((a) => R_LOGIN.test(`${a.url.origin}${a.url.pathname}`));
  assert.equal(JSON.parse(login?.corps ?? "{}").client_id, CLIENT_ID);
  const autorisation = sim.appels.find((a) => R_AUTORISATION.test(`${a.url.origin}${a.url.pathname}`));
  assert.equal(autorisation?.url.searchParams.get("client_id"), CLIENT_ID);
  const moi = sim.appels.find((a) => R_MOI.test(`${a.url.origin}${a.url.pathname}`));
  assert.equal(moi?.entetes.get("x-api-key"), CLES.CUSTOMERS);
  assert.equal(sim.appels.at(-1)?.entetes.get("x-api-key"), CLES.CARTS);

  // Service dont la clé n'est pas sur l'accueil : erreur explicite, aucun appel envoyé.
  const avant = sim.appels.length;
  await assert.rejects(client.appeler("GET", "/v1/sites", { service: "INCONNU" }), (e: unknown) => {
    assert.ok(e instanceof ErreurChronodrive);
    assert.match(e.message, /CHR_API_INCONNU_APIKEY/);
    return true;
  });
  assert.equal(sim.appels.length, avant);

  // Accueil sans clé CARTS : le login échoue avant d'envoyer les identifiants.
  const html = HTML_ACCUEIL.replace(/CHR_API_CARTS_APIKEY:"[^"]+",/, "");
  const simSansCle = fetchSimule([{ methode: "GET", motif: R_ACCUEIL, reponse: () => new Response(html) }, ...routesLogin().slice(1)]);
  const client2 = new ClientChronodrive(nouvelleConfig(), { fetch: simSansCle.fetch, maintenant: horloge().maintenant });
  await assert.rejects(client2.appeler("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" }), /CHR_API_CARTS_APIKEY/);
  assert.equal(simSansCle.compter("POST", R_LOGIN), 0);
});

test("jeton expiré (marge 60 s) → nouveau login avant l'appel", async () => {
  const h = horloge();
  const sim = fetchSimule([...routesLogin(), { methode: "GET", motif: R_PANIERS, reponse: () => json({ content: [] }) }]);
  const client = new ClientChronodrive(nouvelleConfig(), { fetch: sim.fetch, maintenant: h.maintenant });
  const appeler = () => client.appeler("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" });

  await appeler();
  assert.equal(sim.compter("POST", R_LOGIN), 1);

  h.t += 7200_000 - 61_000; // encore 61 s de validité : on garde le jeton
  await appeler();
  assert.equal(sim.compter("POST", R_LOGIN), 1);

  h.t += 2_000; // moins de 60 s de validité : login complet avant l'appel
  await appeler();
  assert.equal(sim.compter("POST", R_LOGIN), 2);
  const dernier = sim.appels.at(-1);
  assert.equal(dernier?.url.pathname, "/v1/customers/me/carts");
  assert.equal(dernier?.entetes.get("authorization"), `Bearer ${JETON}-2`);
  assert.equal(sim.compter("GET", R_PANIERS), 3);
});

test("401 jeton → login complet puis rejeu, une seule fois", async () => {
  // Cas 1 : le 1er appel au panier prend un 401 (jeton révoqué), le rejeu passe.
  const sim = fetchSimule([
    ...routesLogin(),
    {
      methode: "GET",
      motif: R_PANIERS,
      reponse: (_a, n) => (n === 1 ? json({ message: "Unauthorized" }, 401) : json({ content: [{ id: "panier-2" }] })),
    },
  ]);
  const client = new ClientChronodrive(nouvelleConfig(), { fetch: sim.fetch, maintenant: horloge().maintenant });
  const r = await client.appeler<{ content: { id: string }[] }>("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" });
  assert.equal(r.content[0].id, "panier-2");
  assert.equal(sim.compter("POST", R_LOGIN), 2);
  assert.equal(sim.compter("GET", R_PANIERS), 2);
  assert.equal(sim.appels.at(-1)?.entetes.get("authorization"), `Bearer ${JETON}-2`);

  // Cas 2 : 401 persistant → une seule reconnexion, puis ErreurChronodrive (pas de 3e login).
  const simKo = fetchSimule([...routesLogin(), { methode: "GET", motif: R_PANIERS, reponse: () => json({ message: "Unauthorized" }, 401) }]);
  const clientKo = new ClientChronodrive(nouvelleConfig(), { fetch: simKo.fetch, maintenant: horloge().maintenant });
  await assert.rejects(clientKo.appeler("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" }), (e: unknown) => {
    assert.ok(e instanceof ErreurChronodrive);
    assert.equal(e.statut, 401);
    return true;
  });
  assert.equal(simKo.compter("POST", R_LOGIN), 2);
  assert.equal(simKo.compter("GET", R_PANIERS), 2);
});

test("401 « API Key is not valid » → pas de login, ErreurChronodrive", async () => {
  const sim = fetchSimule([
    ...routesLogin(),
    { methode: "GET", motif: R_PANIERS, reponse: () => json({ message: "API Key is not valid" }, 401) },
  ]);
  const client = new ClientChronodrive(nouvelleConfig(), { fetch: sim.fetch, maintenant: horloge().maintenant });
  await assert.rejects(client.appeler("GET", "/v1/customers/me/carts", { service: "CARTS" }), (e: unknown) => {
    assert.ok(e instanceof ErreurChronodrive);
    assert.equal(e.statut, 401);
    assert.match(e.message, /API Key is not valid/);
    return true;
  });
  assert.equal(sim.compter("POST", R_LOGIN), 1); // le login initial seulement
  assert.equal(sim.compter("GET", R_PANIERS), 1); // aucun rejeu
});

test("en-têtes de tout appel", async () => {
  const sim = fetchSimule([...routesLogin(), { methode: "POST", motif: /\/v1\/carts\/c9\/items$/, reponse: () => json({ content: [{ returnType: "SUCCESS" }] }) }]);
  const config = { ...nouvelleConfig(), siteId: "777", mode: "HOME_DELIVERY" as const };
  const client = new ClientChronodrive(config, { fetch: sim.fetch, maintenant: horloge().maintenant });
  const corps = { content: [{ productId: "123", quantity: 1 }], optimizedMode: true };
  await client.appeler("POST", "/v1/carts/c9/items", {
    service: "CARTS",
    corps,
    params: { a: "1", b: "deux mots" },
    entetes: { "X-Kamino-User-Consent": "true" },
  });

  // customers/me (pendant le login) et l'appel lui-même portent les mêmes en-têtes communs.
  for (const appel of sim.appels.filter((a) => a.url.host === "api.chronodrive.com")) {
    const e = appel.entetes;
    assert.equal(e.get("x-chronodrive-site-id"), "777");
    assert.equal(e.get("x-chronodrive-site-mode"), "HOME_DELIVERY");
    assert.equal(e.get("x-device-type"), "WEB");
    assert.equal(e.get("referer"), "https://www.chronodrive.com/");
    assert.equal(e.get("authorization"), `Bearer ${JETON}-1`);
    assert.equal(e.get("accept"), "application/json");
    assert.equal(e.get("content-type"), "application/json");
    assert.match(e.get("user-agent") ?? "", /Mozilla\/5\.0/);
  }
  const ajout = sim.appels.at(-1);
  assert.equal(ajout?.entetes.get("x-api-key"), CLES.CARTS);
  assert.equal(ajout?.entetes.get("x-kamino-user-consent"), "true");
  assert.equal(ajout?.url.searchParams.get("b"), "deux mots");
  assert.deepEqual(JSON.parse(ajout?.corps ?? "null"), corps);
});

test("erreur de login sans secret dans le message", async () => {
  const consoles = (["log", "info", "warn", "error", "debug"] as const).map((m) => mock.method(console, m, () => {}));
  try {
    const secrets = [EMAIL, MOT_DE_PASSE, JETON, "tkn-de-test", "code-de-test"];
    const verifier = (e: unknown) => {
      assert.ok(e instanceof ErreurChronodrive);
      const texte = `${e.message}\n${e.stack ?? ""}\n${JSON.stringify(e)}`;
      for (const s of secrets) assert.ok(!texte.includes(s), `secret présent dans l'erreur : ${texte}`);
      return true;
    };

    // Login refusé, avec une réponse qui renvoie les identifiants saisis.
    const sim = fetchSimule([
      ...routesLogin().filter((r) => r.motif !== R_LOGIN),
      {
        methode: "POST",
        motif: R_LOGIN,
        reponse: () => json({ error: `invalid credentials for ${EMAIL}`, email: EMAIL, password: MOT_DE_PASSE }, 401),
      },
    ]);
    const client = new ClientChronodrive(nouvelleConfig(), { fetch: sim.fetch, maintenant: horloge().maintenant });
    await assert.rejects(client.appeler("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" }), (e: unknown) => {
      verifier(e);
      assert.equal((e as ErreurChronodrive).etape, "login");
      assert.equal((e as ErreurChronodrive).statut, 401);
      return true;
    });

    // Échec réseau sur l'autorisation (dont l'URL porte le tkn).
    const simReseau = fetchSimule([
      ...routesLogin().filter((r) => r.motif !== R_AUTORISATION),
      {
        methode: "GET",
        motif: R_AUTORISATION,
        reponse: (a) => {
          throw new TypeError(`fetch failed ${a.url.href}`);
        },
      },
    ]);
    const clientReseau = new ClientChronodrive(nouvelleConfig(), { fetch: simReseau.fetch, maintenant: horloge().maintenant });
    await assert.rejects(clientReseau.appeler("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" }), verifier);

    // Erreur API après login, dont le corps renvoie le jeton.
    const simApi = fetchSimule([
      ...routesLogin(),
      { methode: "GET", motif: R_PANIERS, reponse: (a) => json({ error: "boom", echo: a.entetes.get("authorization") }, 500) },
    ]);
    const clientApi = new ClientChronodrive(nouvelleConfig(), { fetch: simApi.fetch, maintenant: horloge().maintenant });
    await assert.rejects(clientApi.appeler("GET", "/v1/customers/me/carts", { service: "CUSTOMERS" }), (e: unknown) => {
      verifier(e);
      assert.equal((e as ErreurChronodrive).statut, 500);
      return true;
    });

    // Le client ne logge jamais rien lui-même.
    for (const c of consoles) assert.equal(c.mock.callCount(), 0);
  } finally {
    for (const c of consoles) c.mock.restore();
  }
});

test("chargerConfig : le fichier l'emporte sur l'environnement", () => {
  const dossier = mkdtempSync(join(tmpdir(), "chronodrive-config-"));
  const chemin = join(dossier, "chronodrive.env");
  writeFileSync(chemin, `# identifiants\nCHRONODRIVE_EMAIL=${EMAIL}\nCHRONODRIVE_MOT_DE_PASSE="${MOT_DE_PASSE}"\nCHRONODRIVE_SITE_ID=1034\n`);
  const env = { CHRONODRIVE_EMAIL: "autre@example.org", CHRONODRIVE_MODE: "HOME_DELIVERY", CHRONODRIVE_SESSION: join(dossier, "s.json") };
  assert.deepEqual(chargerConfig(env, chemin), {
    email: EMAIL,
    motDePasse: MOT_DE_PASSE,
    siteId: "1034",
    mode: "HOME_DELIVERY",
    fichierSession: join(dossier, "s.json"),
  });
  assert.equal(chargerConfig({}, chemin).mode, "DRIVE");
  assert.equal(chargerConfig({}, chemin).fichierSession, "/opt/data/chronodrive-session.json");

  // Variable absente ou mode invalide : erreur qui nomme la variable, sans aucune valeur.
  assert.throws(() => chargerConfig({}, join(dossier, "absent.env")), (e: unknown) => {
    assert.ok(e instanceof ErreurChronodrive);
    assert.match(e.message, /CHRONODRIVE_EMAIL/);
    return true;
  });
  assert.throws(() => chargerConfig({ CHRONODRIVE_MODE: "VELO" }, chemin), /CHRONODRIVE_MODE/);
  assert.ok(!existsSync(join(dossier, "s.json")));
});
