// Helpers API de management Supabase — état d'un projet et réveil s'il dort.
//
// Le tier gratuit met un projet en pause après ~1 semaine sans activité. Deux
// mécanismes du projet en dépendent : le harnais e2e local
// (scripts/e2e-staging.mjs) et le workflow keep-alive (qui réimplémente la même
// logique en bash, faute de Node — cf. .github/workflows/supabase-keepalive.yml ;
// toute évolution de la règle doit être faite des DEUX côtés, même contrat de
// « jumeau » que lib/accompagnement.ts et son miroir SQL).
//
// Module séparé du harnais e2e pour être importable par les tests sans
// déclencher tout le lancement de Playwright (et parce que le shebang de
// e2e-staging.mjs empêche son import direct par Vitest).

const API = "https://api.supabase.com/v1/projects"

/** Statut courant d'un projet (ACTIVE_HEALTHY, INACTIVE, COMING_UP, RESTORING…). */
export async function statutProjet(ref, token) {
  const rep = await fetch(`${API}/${ref}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!rep.ok) throw new Error(`API management HTTP ${rep.status} (SUPABASE_ACCESS_TOKEN valide ?)`)
  return (await rep.json()).status ?? "INCONNU"
}

/**
 * Garantit qu'un projet est actif : le réveille s'il est en pause, puis attend
 * qu'il soit ACTIVE_HEALTHY.
 *
 * Sans ça, le symptôme d'un projet endormi est déroutant :
 * GET /v1/projects/<ref>/api-keys répond 200 avec un tableau VIDE (pas une
 * erreur d'authentification), donc l'appelant échoue sur « clé anon
 * introuvable » et l'on soupçonne à tort le token. Vécu le 2026-09-01 : staging
 * dormait depuis le 2026-07-20.
 *
 * `attendre` est injectable pour que les tests n'attendent pas réellement.
 */
export async function assurerProjetActif(ref, token, attendre = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let statut = await statutProjet(ref, token)
  if (statut === "ACTIVE_HEALTHY") return

  if (statut !== "INACTIVE") {
    // Ni actif ni en pause : transition déjà en cours (COMING_UP/RESTORING…).
    // On attend sans demander de restauration — elle serait rejetée par l'API.
    console.log(`→ Projet ${ref} en transition (${statut}) — attente…`)
  } else {
    process.stdout.write(`→ Projet ${ref} EN PAUSE — demande de restauration… `)
    const rep = await fetch(`${API}/${ref}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    })
    if (!rep.ok) throw new Error(`restauration refusée (HTTP ${rep.status})`)
    console.log("ok")
  }

  // Remontée observée : COMING_UP → RESTORING → ACTIVE_HEALTHY en ~2 min.
  const debut = Date.now()
  for (let i = 0; i < 40; i++) {
    await attendre(15_000)
    statut = await statutProjet(ref, token)
    console.log(`   t+${Math.round((Date.now() - debut) / 1000)}s  ${statut}`)
    if (statut === "ACTIVE_HEALTHY") {
      // Le DNS du sous-domaine peut traîner quelques secondes après l'API.
      await attendre(10_000)
      console.log("✓ Projet réveillé.")
      return
    }
  }
  throw new Error(`projet ${ref} toujours pas ACTIVE_HEALTHY après 10 min (dernier statut : ${statut})`)
}
