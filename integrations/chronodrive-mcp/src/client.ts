// Client de l'API front privée Chronodrive pour l'exécuteur (#308, ADR-12, RG-80).
// Protocole : docs/etudes/chronodrive.md, « Protocole relevé ». Pièges : .claude/rules/chronodrive.md.
// Tourne sur le NAS de l'utilisateur, jamais côté OMQ. Ne logge rien : aucun mot de passe,
// jeton ni cookie ne sort de ce module, pas même dans un message d'erreur.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const SITE = "https://www.chronodrive.com";
const CONNECT = "https://connect.chronodrive.com";
const API = "https://api.chronodrive.com";
const SCOPE = "openid profile email phone full_write offline_access";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const MARGE_EXPIRATION_MS = 60_000;
// Services dont la clé doit figurer sur l'accueil pour que l'exécuteur fonctionne.
const SERVICES_REQUIS = ["CUSTOMERS", "CARTS", "PRODUCTS", "FAVOURITE_PRODUCTS"];
const MASQUE = "[masqué]";

export class ErreurChronodrive extends Error {
  etape: string;
  statut?: number;

  constructor(etape: string, message: string, statut?: number) {
    super(`${etape} : ${message}`);
    this.name = "ErreurChronodrive";
    this.etape = etape;
    if (statut !== undefined) this.statut = statut;
  }
}

export type Config = {
  email: string;
  motDePasse: string;
  siteId: string;
  mode: "DRIVE" | "HOME_DELIVERY";
  fichierSession: string;
};

export type Session = {
  accessToken: string;
  expireA: number;
  clientId: string;
  cles: Record<string, string>;
  customerId: string;
};

type Env = Record<string, string | undefined>;

// Le fichier `KEY=valeur` (mode 600 sur le NAS) l'emporte sur l'environnement. Fichier absent :
// l'environnement seul. Les erreurs nomment la variable, jamais sa valeur.
export function chargerConfig(env: Env = process.env, chemin: string = env.CHRONODRIVE_ENV ?? "/opt/data/chronodrive.env"): Config {
  let fichier: Env = {};
  try {
    fichier = parseEnv(readFileSync(chemin, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ErreurChronodrive("config", `lecture de ${chemin} impossible (${(e as NodeJS.ErrnoException).code ?? "erreur"})`);
    }
  }
  const lire = (nom: string) => fichier[nom] ?? env[nom];
  const requise = (nom: string) => {
    const valeur = lire(nom);
    if (!valeur) throw new ErreurChronodrive("config", `variable ${nom} absente (${chemin} ou environnement)`);
    return valeur;
  };
  const mode = lire("CHRONODRIVE_MODE") ?? "DRIVE";
  if (mode !== "DRIVE" && mode !== "HOME_DELIVERY") {
    throw new ErreurChronodrive("config", "CHRONODRIVE_MODE doit valoir DRIVE ou HOME_DELIVERY");
  }
  return {
    email: requise("CHRONODRIVE_EMAIL"),
    motDePasse: requise("CHRONODRIVE_MOT_DE_PASSE"),
    siteId: requise("CHRONODRIVE_SITE_ID"),
    mode,
    fichierSession: lire("CHRONODRIVE_SESSION") ?? "/opt/data/chronodrive-session.json",
  };
}

type Options = { fetch?: typeof fetch; maintenant?: () => number };
type OptionsAppel = { service: string; params?: Record<string, string>; corps?: unknown; entetes?: Record<string, string> };

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function sessionValide(brut: unknown): brut is Session {
  const s = brut as Partial<Session> | null;
  return (
    typeof s?.accessToken === "string" &&
    typeof s.expireA === "number" &&
    typeof s.clientId === "string" &&
    typeof s.customerId === "string" &&
    typeof s.cles === "object" &&
    s.cles !== null
  );
}

export class ClientChronodrive {
  #config: Config;
  #fetch: typeof fetch;
  #maintenant: () => number;
  #session: Session | null = null;
  // Login en cours, partagé par les appels concurrents.
  #connexion: Promise<Session> | null = null;
  // Valeurs à masquer dans tout message d'erreur (identifiants, jetons, codes intermédiaires).
  #secrets = new Set<string>();

  constructor(config: Config, options: Options = {}) {
    this.#config = config;
    this.#fetch = options.fetch ?? ((entree, init) => fetch(entree, init));
    this.#maintenant = options.maintenant ?? Date.now;
    this.#secret(config.email);
    this.#secret(config.motDePasse);
  }

  // Identifiant du client Chronodrive (en-tête `X-Kamino-User-Id` de la recherche).
  async idClient(): Promise<string> {
    return (await this.#sessionCourante()).customerId;
  }

  // Appel authentifié. Session ouverte paresseusement ; jeton expiré (marge 60 s) → login complet
  // avant l'appel. Un 401 d'authentification → un seul login complet puis un seul rejeu ; un second
  // 401 remonte en erreur (pas de boucle de login). Un 401 « API Key is not valid » est une erreur
  // de clé de service : jamais de login dessus.
  async appeler<T>(methode: "GET" | "POST", chemin: string, options: OptionsAppel): Promise<T> {
    const etape = `${methode} ${chemin}`;
    const session = await this.#sessionCourante();
    const premier = await this.#requete(session, methode, chemin, options);
    if (premier.ok) return this.#analyser<T>(premier.texte, etape) as T;
    if (premier.reponse.status !== 401 || /api key/i.test(premier.texte)) throw this.#echec(etape, premier.reponse, premier.texte);

    // Le jeton a pu être renouvelé entre-temps par un appel concurrent : on le reprend sans relogin.
    const courante = this.#session;
    const neuve = courante && courante.accessToken !== session.accessToken ? courante : await this.#reconnecter();
    const second = await this.#requete(neuve, methode, chemin, options);
    if (second.ok) return this.#analyser<T>(second.texte, etape) as T;
    throw this.#echec(etape, second.reponse, second.texte);
  }

  #secret(valeur: string | undefined | null) {
    if (valeur && valeur.length >= 4) this.#secrets.add(valeur);
  }

  // Session valide : mémoire, sinon fichier, sinon login complet.
  async #sessionCourante(): Promise<Session> {
    if (!this.#session) this.#session = this.#lireFichierSession();
    if (this.#session && this.#session.expireA - MARGE_EXPIRATION_MS > this.#maintenant()) return this.#session;
    return this.#reconnecter();
  }

  // Login complet partagé : deux appels qui trouvent le jeton périmé ne déclenchent qu'un login.
  async #reconnecter(): Promise<Session> {
    if (!this.#connexion) {
      this.#connexion = this.#seConnecter()
        .then((neuve) => {
          this.#session = neuve;
          this.#enregistrer(neuve);
          return neuve;
        })
        .finally(() => {
          this.#connexion = null;
        });
    }
    return this.#connexion;
  }

  #lireFichierSession(): Session | null {
    try {
      const brut: unknown = JSON.parse(readFileSync(this.#config.fichierSession, "utf8"));
      if (!sessionValide(brut)) return null;
      this.#secret(brut.accessToken);
      return brut;
    } catch {
      // Fichier absent ou illisible : un login complet le recréera.
      return null;
    }
  }

  // Écriture atomique, créée d'emblée en 600 : le jeton n'est jamais lisible par un autre compte.
  #enregistrer(session: Session) {
    const temporaire = `${this.#config.fichierSession}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaire, JSON.stringify(session), { mode: 0o600 });
      chmodSync(temporaire, 0o600);
      renameSync(temporaire, this.#config.fichierSession);
    } catch (e) {
      throw new ErreurChronodrive("session", `écriture de ${this.#config.fichierSession} impossible (${(e as NodeJS.ErrnoException).code ?? "erreur"})`);
    }
  }

  // Clés `x-api-key` par service et client_id OAuth : publiques, lues dans la config Nuxt de l'accueil.
  async #lireConfigFront(): Promise<{ cles: Record<string, string>; clientId: string }> {
    const r = await this.#envoyer("config-front", SITE + "/", { headers: { "User-Agent": UA } });
    const html = await r.text();
    if (!r.ok) throw this.#echec("config-front", r, html);
    const cles: Record<string, string> = {};
    const motif = /CHR_API_([A-Z_]{2,40})_APIKEY["':\s]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/g;
    for (const [, nom, valeur] of html.matchAll(motif)) cles[nom] = valeur;
    for (const service of SERVICES_REQUIS) {
      if (!cles[service]) throw new ErreurChronodrive("config-front", `clé CHR_API_${service}_APIKEY introuvable sur l'accueil`);
    }
    const clientId = html.match(/CLIENT_ID["':\s]+([A-Za-z0-9_-]{10,})/)?.[1];
    if (!clientId) throw new ErreurChronodrive("config-front", "CLIENT_ID introuvable sur l'accueil");
    return { cles, clientId };
  }

  // Login complet : config front → password → authorize (PKCE S256) → jeton → customers/me.
  // Pas de refresh token chez Chronodrive : chaque reconnexion repasse par ici.
  async #seConnecter(): Promise<Session> {
    const { cles, clientId } = await this.#lireConfigFront();

    const login = await this.#envoyer("login", `${CONNECT}/identity/v1/password/login`, {
      method: "POST",
      headers: { "User-Agent": UA, "content-type": "application/json", Accept: "application/json", Origin: SITE, Referer: `${SITE}/` },
      body: JSON.stringify({ client_id: clientId, scope: SCOPE, email: this.#config.email, password: this.#config.motDePasse }),
    });
    const texteLogin = await login.text();
    if (!login.ok) throw this.#echec("login", login, texteLogin);
    const tkn = this.#analyser<{ tkn?: string }>(texteLogin, "login")?.tkn;
    if (!tkn) throw new ErreurChronodrive("login", "réponse sans tkn (captcha ou 2FA ?)", login.status);
    this.#secret(tkn);
    const cookies = login.headers.getSetCookie().map((c) => c.split(";")[0]);
    for (const c of cookies) this.#secret(c.split("=").slice(1).join("="));

    const { verifier, challenge } = pkce();
    this.#secret(verifier);
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
    const autorisation = await this.#envoyer("authorize", `${CONNECT}/oauth/authorize?${params}`, {
      headers: { "User-Agent": UA, Origin: SITE, Referer: `${SITE}/`, Cookie: cookies.join("; ") },
    });
    const texteAutorisation = await autorisation.text();
    if (!autorisation.ok) throw this.#echec("authorize", autorisation, texteAutorisation);
    const code = texteAutorisation.match(/"code"\s*:\s*"([^"]+)"/)?.[1];
    if (!code) throw new ErreurChronodrive("authorize", "aucun code dans la réponse", autorisation.status);
    this.#secret(code);

    const jeton = await this.#envoyer("token", `${CONNECT}/oauth/token`, {
      method: "POST",
      headers: { "User-Agent": UA, "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, grant_type: "authorization_code", code_verifier: verifier, code, redirect_uri: SITE }),
    });
    const texteJeton = await jeton.text();
    if (!jeton.ok) throw this.#echec("token", jeton, texteJeton);
    const corps = this.#analyser<{ access_token?: string; expires_in?: number; id_token?: string }>(texteJeton, "token");
    this.#secret(corps?.id_token);
    if (!corps?.access_token) throw new ErreurChronodrive("token", "réponse sans access_token", jeton.status);
    this.#secret(corps.access_token);
    const expiresIn = typeof corps.expires_in === "number" && corps.expires_in > 0 ? corps.expires_in : 300;
    const provisoire: Session = { accessToken: corps.access_token, expireA: this.#maintenant() + expiresIn * 1000, clientId, cles, customerId: "" };

    // Identifiant client lu une fois par login (en-tête Kamino de la recherche).
    const moi = await this.#requete(provisoire, "GET", "/v1/customers/me", { service: "CUSTOMERS" });
    if (!moi.ok) throw this.#echec("GET /v1/customers/me", moi.reponse, moi.texte);
    const id = this.#analyser<{ id?: string | number }>(moi.texte, "GET /v1/customers/me")?.id;
    if (id === undefined || id === null || id === "") throw new ErreurChronodrive("GET /v1/customers/me", "réponse sans id client");
    return { ...provisoire, customerId: String(id) };
  }

  // Requête API brute : en-têtes du protocole, corps lu en texte (pour distinguer les 401).
  async #requete(session: Session, methode: string, chemin: string, options: OptionsAppel) {
    const cle = session.cles[options.service];
    if (!cle) throw new ErreurChronodrive(`${methode} ${chemin}`, `clé CHR_API_${options.service}_APIKEY introuvable sur l'accueil`);
    const requete = options.params ? `?${new URLSearchParams(options.params)}` : "";
    const reponse = await this.#envoyer(`${methode} ${chemin}`, `${API}${chemin}${requete}`, {
      method: methode,
      headers: {
        "User-Agent": UA,
        "x-chronodrive-site-id": this.#config.siteId,
        "x-chronodrive-site-mode": this.#config.mode,
        "x-device-type": "WEB",
        referer: `${SITE}/`,
        "content-type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        "x-api-key": cle,
        ...options.entetes,
      },
      body: options.corps === undefined ? undefined : JSON.stringify(options.corps),
    });
    return { ok: reponse.ok, reponse, texte: await reponse.text() };
  }

  // `fetch` dont l'échec réseau est réécrit : la cause d'origine (URL avec tkn, en-têtes) n'est pas propagée.
  async #envoyer(etape: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, init);
    } catch (e) {
      const nom = e instanceof Error ? e.name : "erreur";
      throw new ErreurChronodrive(etape, `erreur réseau (${nom})`);
    }
  }

  #analyser<T>(texte: string, etape: string): T | null {
    if (!texte) return null;
    try {
      return JSON.parse(texte) as T;
    } catch {
      throw new ErreurChronodrive(etape, "réponse non JSON");
    }
  }

  // Réponse en échec : statut, indices Cloudflare et extrait du corps, caviardé (secrets connus,
  // champs sensibles, adresses e-mail, JWT).
  #echec(etape: string, reponse: Response, texte: string): ErreurChronodrive {
    const cfRay = reponse.headers.get("cf-ray");
    const cf = cfRay ? ` [cf-ray ${cfRay}, cf-mitigated ${reponse.headers.get("cf-mitigated") ?? "-"}]` : "";
    const extrait = this.#caviarder(texte.replace(/\s+/g, " ").trim()).slice(0, 300);
    return new ErreurChronodrive(etape, `HTTP ${reponse.status}${cf}${extrait ? ` ${extrait}` : ""}`, reponse.status);
  }

  #caviarder(texte: string): string {
    let propre = texte;
    for (const secret of this.#secrets) {
      for (const forme of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])) {
        propre = propre.split(forme).join(MASQUE);
      }
    }
    return propre
      .replace(/"(password|email|tkn|code|code_verifier|access_token|id_token|refresh_token)"\s*:\s*"[^"]*"/gi, `"$1":"${MASQUE}"`)
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, MASQUE)
      .replace(/[^\s"'<>@:;,]+@[^\s"'<>@:;,]+\.[a-z]{2,}/gi, MASQUE)
      .replace(/Bearer\s+\S+/gi, `Bearer ${MASQUE}`);
  }
}
