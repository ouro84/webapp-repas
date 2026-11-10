import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTE_SENTRY } from "@/lib/sentry-collecte";

// Verrou du périmètre de collecte Sentry (v11) : sans `dataCollection`, le SDK
// collecte par défaut cookies (session Supabase), corps HTTP et infos
// utilisateur. Cf. lib/sentry-collecte.ts.

describe("périmètre de collecte Sentry", () => {
  it("garde la base restrictive de la v10", () => {
    expect(COLLECTE_SENTRY.userInfo).toBe(false);
    expect(COLLECTE_SENTRY.cookies).toBe(false);
    expect(COLLECTE_SENTRY.httpBodies).toEqual([]);
    expect(COLLECTE_SENTRY.databaseQueryData).toBe(false);
    expect(COLLECTE_SENTRY.mcp).toEqual({ inputs: false, outputs: false });
    expect(COLLECTE_SENTRY.genAI).toEqual({ inputs: false, outputs: false });
  });

  it.each(["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"])(
    "%s passe la base restrictive à Sentry.init",
    (fichier) => {
      const source = readFileSync(path.resolve(__dirname, "..", fichier), "utf8");
      expect(source).toContain("dataCollection: COLLECTE_SENTRY");
    },
  );
});
