// Outil ponctuel — exécute une requête SQL sur un projet Supabase via
// l'API de management (contourne le blocage TLS d'Avast sur le CLI Go).
// Usage : node scripts/query-supabase.mjs <project-ref> "<sql>"
// Requiert SUPABASE_ACCESS_TOKEN en variable d'environnement.

const [ref, sql] = process.argv.slice(2);
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !sql || !token) {
  console.error("Usage : SUPABASE_ACCESS_TOKEN=... node scripts/query-supabase.mjs <ref> <sql>");
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

if (!res.ok) {
  console.error(`Erreur API ${res.status} : ${await res.text()}`);
  process.exit(1);
}

console.log(JSON.stringify(await res.json(), null, 1));
