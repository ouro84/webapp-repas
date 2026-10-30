// Spike #307 — client de l'API front privée Chronodrive (jetable, remplacé par #308).
// Protocole : docs/etudes/chronodrive.md, « Protocole relevé ».
// Tourne chez l'utilisateur (ADR-12, RG-80) : jamais côté OMQ.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";

const SITE = "https://www.chronodrive.com";
const CONNECT = "https://connect.chronodrive.com";
const API = "https://api.chronodrive.com";
const SCOPE = "openid profile email phone full_write offline_access";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const CLIENT_ORIGIN = "WEB|SEARCH|TG|/promotions";
const MARGE_EXPIRATION_MS = 60_000;

const CHEMIN_SESSION = process.env.CHRONODRIVE_SESSION ?? "/opt/data/chronodrive-session.json";

export class ErreurChronodrive extends Error {
  constructor(etape, statut, message) {
    super(`${etape} : ${message}`);
    this.etape = etape;
    this.statut = statut;
  }
}

export function chargerEnv(chemin = process.env.CHRONODRIVE_ENV ?? "/opt/data/chronodrive.env") {
  process.loadEnvFile(chemin);
  for (const nom of ["CHRONODRIVE_EMAIL", "CHRONODRIVE_MOT_DE_PASSE", "CHRONODRIVE_SITE_ID"]) {
    if (!process.env[nom]) throw new ErreurChronodrive("config", null, `variable ${nom} absente de ${chemin}`);
  }
}

// Réponse non JSON (page Cloudflare, captcha…) : on garde de quoi diagnostiquer, sans en-tête d'autorisation.
async function echec(etape, reponse) {
  const texte = (await reponse.text()).replace(/\s+/g, " ").slice(0, 300);
  const cf = reponse.headers.get("cf-ray") ? ` [cf-ray ${reponse.headers.get("cf-ray")}, cf-mitigated ${reponse.headers.get("cf-mitigated") ?? "-"}]` : "";
  return new ErreurChronodrive(etape, reponse.status, `HTTP ${reponse.status}${cf} ${texte}`);
}

let configFront = null;

// Clés `x-api-key` par microservice et client_id OAuth, publiques, lues dans la config Nuxt de l'accueil.
export async function lireConfigFront() {
  if (configFront) return configFront;
  const r = await fetch(SITE, { headers: { "User-Agent": UA } });
  if (!r.ok) throw await echec("config-front", r);
  const html = await r.text();
  const cles = {};
  for (const [, nom, valeur] of html.matchAll(/CHR_API_([A-Z_]{2,40})_APIKEY["':\s]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/g)) {
    cles[nom] = valeur;
  }
  const clientId = html.match(/CLIENT_ID["':\s]+([A-Za-z0-9_-]{10,})/)?.[1];
  for (const service of ["CUSTOMERS", "CARTS", "PRODUCTS", "FAVOURITE_PRODUCTS"]) {
    if (!cles[service]) throw new ErreurChronodrive("config-front", null, `clé CHR_API_${service}_APIKEY introuvable sur l'accueil`);
  }
  if (!clientId) throw new ErreurChronodrive("config-front", null, "CLIENT_ID introuvable sur l'accueil");
  configFront = { cles, clientId };
  return configFront;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function cookiesDe(reponse) {
  return reponse.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function sessionDepuisJeton(corps) {
  return {
    jetonAcces: corps.access_token,
    jetonRafraichissement: corps.refresh_token ?? null,
    expireA: Date.now() + (corps.expires_in ?? 300) * 1000,
    // Diagnostic du spike : noms des champs et scope accordé, jamais les valeurs.
    champsJeton: Object.keys(corps),
    scopeAccorde: corps.scope ?? null,
  };
}

async function demanderJeton(clientId, champs, etape) {
  const r = await fetch(`${CONNECT}/oauth/token`, {
    method: "POST",
    headers: { "User-Agent": UA, "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, ...champs }),
  });
  if (!r.ok) throw await echec(etape, r);
  return sessionDepuisJeton(await r.json());
}

// Login complet : password → PKCE → jeton (protocole relevé, Task 1).
export async function seConnecter() {
  const { clientId } = await lireConfigFront();
  const login = await fetch(`${CONNECT}/identity/v1/password/login`, {
    method: "POST",
    headers: { "User-Agent": UA, "content-type": "application/json", Accept: "application/json", Origin: SITE, Referer: `${SITE}/` },
    body: JSON.stringify({
      client_id: clientId,
      scope: SCOPE,
      email: process.env.CHRONODRIVE_EMAIL,
      password: process.env.CHRONODRIVE_MOT_DE_PASSE,
    }),
  });
  if (!login.ok) throw await echec("login", login);
  const { tkn } = await login.json();
  if (!tkn) throw new ErreurChronodrive("login", login.status, "réponse sans tkn (captcha ou 2FA ?)");

  const { verifier, challenge } = pkce();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    nonce: String(randomInt(1e9)),
    persistent: "true",
    redirect_uri: SITE,
    scope: SCOPE,
    response_mode: "web_message",
    prompt: "none",
    code_challenge: challenge,
    code_challenge_method: "S256",
    tkn,
  });
  const autorisation = await fetch(`${CONNECT}/oauth/authorize?${params}`, {
    headers: { "User-Agent": UA, Origin: SITE, Referer: `${SITE}/`, Cookie: cookiesDe(login) },
  });
  if (!autorisation.ok) throw await echec("authorize", autorisation);
  const code = (await autorisation.text()).match(/"code"\s*:\s*"([^"]+)"/)?.[1];
  if (!code) throw new ErreurChronodrive("authorize", autorisation.status, "aucun code dans la réponse");

  return demanderJeton(clientId, { grant_type: "authorization_code", code_verifier: verifier, code, redirect_uri: SITE }, "token");
}

export async function rafraichir(session) {
  if (!session.jetonRafraichissement) throw new ErreurChronodrive("refresh", null, "aucun refresh token (offline_access refusé ?)");
  const { clientId } = await lireConfigFront();
  const neuve = await demanderJeton(clientId, { grant_type: "refresh_token", refresh_token: session.jetonRafraichissement }, "refresh");
  return { ...session, ...neuve, jetonRafraichissement: neuve.jetonRafraichissement ?? session.jetonRafraichissement };
}

function enregistrer(session) {
  writeFileSync(CHEMIN_SESSION, JSON.stringify(session), { mode: 0o600 });
  chmodSync(CHEMIN_SESSION, 0o600);
}

// Client et panier courant : on garde le mode (DRIVE / HOME_DELIVERY) où le compte a un panier.
async function completer(session) {
  if (session.panierId) return session;
  const moi = await requete(session, "GET", "/v1/customers/me", { service: "CUSTOMERS" });
  for (const mode of ["DRIVE", "HOME_DELIVERY"]) {
    // Route du service clients : la clé CARTS y est refusée (401 « API Key is not valid »).
    const paniers = await requete({ ...session, mode }, "GET", "/v1/customers/me/carts", { service: "CUSTOMERS" });
    const panierId = paniers?.content?.[0]?.id;
    if (panierId) return { ...session, clientId: String(moi.id ?? ""), panierId: String(panierId), mode };
  }
  throw new ErreurChronodrive("panier", null, "aucun panier pour ce drive (CHRONODRIVE_SITE_ID ?)");
}

// Session valide : cache disque, sinon refresh, sinon login complet.
export async function ouvrirSession({ forcerLogin = false, forcerRefresh = false } = {}) {
  let session = !forcerLogin && existsSync(CHEMIN_SESSION) ? JSON.parse(readFileSync(CHEMIN_SESSION, "utf8")) : null;
  if (session && (forcerRefresh || session.expireA - MARGE_EXPIRATION_MS < Date.now())) {
    try {
      session = await rafraichir(session);
    } catch (e) {
      if (forcerRefresh) throw e;
      session = null;
    }
  }
  if (!session) session = await seConnecter();
  session = await completer(session);
  enregistrer(session);
  return session;
}

async function requete(session, methode, chemin, { service, corps, params, entetes } = {}) {
  const { cles } = await lireConfigFront();
  const url = `${API}${chemin}${params ? `?${new URLSearchParams(params)}` : ""}`;
  const r = await fetch(url, {
    method: methode,
    headers: {
      "User-Agent": UA,
      "x-chronodrive-site-id": process.env.CHRONODRIVE_SITE_ID,
      "x-chronodrive-site-mode": session.mode ?? "DRIVE",
      "x-device-type": "WEB",
      referer: `${SITE}/`,
      "content-type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${session.jetonAcces}`,
      "x-api-key": cles[service],
      ...entetes,
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (!r.ok) throw await echec(`${methode} ${chemin}`, r);
  const texte = await r.text();
  return texte ? JSON.parse(texte) : null;
}

// Appel API authentifié : sur 401, une seule reconnexion puis nouvel essai (Review Focus 1).
// Chronodrive ne renvoie pas de refresh token malgré offline_access : on refait alors le login.
export async function appeler(session, methode, chemin, options = {}) {
  try {
    return await requete(session, methode, chemin, options);
  } catch (e) {
    if (e.statut !== 401) throw e;
    const neuve = { ...session, ...(session.jetonRafraichissement ? await rafraichir(session) : await seConnecter()) };
    enregistrer(neuve);
    Object.assign(session, neuve);
    return requete(session, methode, chemin, options);
  }
}

export function resumerProduit(p) {
  const labels = p.labels ?? {};
  const prix = p.prices ?? {};
  return {
    id: String(p.id ?? ""),
    libelle: (labels.productLabel ?? "").trim(),
    marque: (labels.brandLabel ?? "").trim() || null,
    contenance: labels.unitQuantityLabel || null,
    prix: prix.defaultPrice ?? null,
    prixAuKg: prix.pricePerUnitMeasure ?? null,
    disponible: p.isEligible !== false && (p.remainingStock == null || p.remainingStock > 0),
    bio: Boolean(p.flags?.isOrganic),
  };
}

export async function lirePanier(session) {
  const panier = await appeler(session, "GET", `/v1/carts/${session.panierId}`, { service: "CARTS" });
  return {
    id: session.panierId,
    articles: (panier?.items ?? []).map((item) => ({
      productId: String(item.product?.id ?? ""),
      libelle: (item.product?.labels?.productLabel ?? "").trim(),
      quantite: item.quantity ?? 1,
    })),
  };
}

export async function ajouterAuPanier(session, productId, quantite) {
  const reponse = await appeler(session, "POST", `/v1/carts/${session.panierId}/items`, {
    service: "CARTS",
    corps: { content: [{ clientOrigin: CLIENT_ORIGIN, productId: String(productId), quantity: quantite }], optimizedMode: true },
  });
  const statut = reponse?.content?.[0]?.returnType;
  if (statut !== "SUCCESS") throw new ErreurChronodrive("ajout", null, `returnType ${statut ?? "absent"}`);
}

export async function retirerDuPanier(session, productId) {
  await appeler(session, "DELETE", `/v1/carts/${session.panierId}/items/${productId}`, { service: "CARTS" });
}

export async function listerFavoris(session) {
  const produits = [];
  for (let page = 1; ; page++) {
    const corps = await appeler(session, "GET", "/v1/favourite-products", { service: "FAVOURITE_PRODUCTS", params: { page, size: 50 } });
    produits.push(...(corps?.content ?? []).map(resumerProduit));
    if (!corps?.page?.hasNext) return produits;
  }
}

export async function rechercherProduits(session, terme, taille = 20) {
  const corps = await appeler(session, "GET", "/v1/products", {
    service: "PRODUCTS",
    params: { searchTerm: terme, page: 1, size: taille, withKamino: "true", kaminoMode: "ADVANCED" },
    entetes: { "X-Kamino-User-Consent": "true", "X-Kamino-User-Id": session.clientId ?? "" },
  });
  return (corps?.content ?? []).map(resumerProduit);
}
