// Réveil automatique du projet Supabase staging en pause (tier gratuit).
//
// Pourquoi ce test existe : le chemin « projet en pause » ne peut pas être
// exercé à la demande (mettre staging en pause pour de vrai coûte plusieurs
// minutes et casse toute CI concurrente). Or c'est exactement le profil de bug
// que ce projet a déjà rencontré plusieurs fois — une fonction écrite mais
// jamais exécutée qui casse au premier appel réel (search_path pgcrypto de
// #56 PR3, colonne `semaine` de quitter_foyer en #257). On simule donc l'API
// de management pour couvrir les quatre branches.
import { describe, it, expect, vi, afterEach } from "vitest";
import { assurerProjetActif, statutProjet } from "../scripts/supabase-projet.mjs";

const REF = "upxoxrjumxpzumakawiv";
const TOKEN = "sbp_factice";

/** Stub de fetch : rend les statuts de la file, note les appels de restauration. */
function stubApi(statuts: string[], { restoreOk = true } = {}) {
  const appels: string[] = [];
  const file = [...statuts];
  const faux = vi.fn(async (url: string, init?: RequestInit) => {
    appels.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/restore")) {
      return { ok: restoreOk, status: restoreOk ? 200 : 400 } as Response;
    }
    const statut = file.length > 1 ? file.shift() : file[0];
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: statut }),
    } as Response;
  });
  vi.stubGlobal("fetch", faux);
  return appels;
}

// Attente injectée : les tests ne doivent pas patienter 15 s pour de vrai.
const sansAttente = async () => {};

afterEach(() => vi.unstubAllGlobals());

describe("assurerProjetActif", () => {
  it("ne fait rien si le projet est déjà actif (cas nominal, aucun restore)", async () => {
    const appels = stubApi(["ACTIVE_HEALTHY"]);
    await assurerProjetActif(REF, TOKEN, sansAttente);
    expect(appels).toEqual([`GET https://api.supabase.com/v1/projects/${REF}`]);
    expect(appels.some((a) => a.includes("/restore"))).toBe(false);
  });

  it("réveille un projet en pause puis attend ACTIVE_HEALTHY", async () => {
    const appels = stubApi(["INACTIVE", "COMING_UP", "RESTORING", "ACTIVE_HEALTHY"]);
    await assurerProjetActif(REF, TOKEN, sansAttente);
    expect(appels).toContain(`POST https://api.supabase.com/v1/projects/${REF}/restore`);
    // Statut initial + 3 sondages
    expect(appels.filter((a) => a.startsWith("GET")).length).toBe(4);
  });

  it("attend une transition en cours SANS demander de restauration", async () => {
    // Une restauration sur un projet déjà en COMING_UP serait rejetée par l'API.
    const appels = stubApi(["COMING_UP", "ACTIVE_HEALTHY"]);
    await assurerProjetActif(REF, TOKEN, sansAttente);
    expect(appels.some((a) => a.includes("/restore"))).toBe(false);
  });

  it("échoue explicitement si le projet ne remonte jamais", async () => {
    stubApi(["INACTIVE", "RESTORING"]);
    await expect(assurerProjetActif(REF, TOKEN, sansAttente)).rejects.toThrow(
      /toujours pas ACTIVE_HEALTHY/
    );
  });

  it("remonte une restauration refusée par l'API", async () => {
    stubApi(["INACTIVE"], { restoreOk: false });
    await expect(assurerProjetActif(REF, TOKEN, sansAttente)).rejects.toThrow(
      /restauration refusée \(HTTP 400\)/
    );
  });
});

describe("statutProjet", () => {
  it("remonte une erreur d'authentification management lisible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 }) as Response));
    await expect(statutProjet(REF, TOKEN)).rejects.toThrow(/HTTP 401/);
  });
});
