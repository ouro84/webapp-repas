// Périmètre de collecte Sentry, partagé par les trois runtimes
// (instrumentation-client.ts, sentry.server.config.ts, sentry.edge.config.ts).
//
// Depuis @sentry/nextjs v11, `dataCollection` remplace `sendDefaultPii`, et
// l'option absente collecte PAR DÉFAUT cookies, corps HTTP, infos utilisateur,
// requêtes SQL et entrées/sorties MCP. Nos cookies portent la session Supabase
// et les corps de requête des données de foyer (listes, plannings) : on fixe
// donc explicitement la base restrictive de la v10 (guide de migration Sentry
// 10 → 11, « If you want to keep the v10 default behavior »), plus `mcp`
// (outils du serveur /api/mcp, cf. ADR-10). Ne jamais retirer cette option :
// l'absence vaut collecte large.
//
// Pas d'import de type depuis @sentry/core (dépendance transitive) : le typage
// est vérifié structurellement à l'appel de Sentry.init.

const ENTETES_IDENTIFIANTS = ["forwarded", "-ip", "remote-", "via", "-user"];

export const COLLECTE_SENTRY = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: ENTETES_IDENTIFIANTS },
    response: { deny: ENTETES_IDENTIFIANTS },
  },
  httpBodies: [],
  urlQueryParams: { deny: ENTETES_IDENTIFIANTS },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
};
