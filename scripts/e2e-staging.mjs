#!/usr/bin/env node
// Joue les e2e Playwright en LOCAL contre l'instance Supabase STAGING (jamais la
// prod), pour fiabiliser une branche AVANT d'ouvrir/pusher une PR (cf. CLAUDE.md
// « E2E sur staging avant PR »). Remplace le wrapper scratchpad manuel de la
// mémoire [[e2e-local-staging]].
//
// Ce qu'il fait :
//  1. Lit .env.local (qui pointe la PROD) pour récupérer SUPABASE_ACCESS_TOKEN.
//  2. RÉVEILLE le projet staging s'il est en pause (tier gratuit : pause après
//     ~1 semaine sans activité), puis récupère la clé anon STAGING courante via
//     l'API de management (elle change — pas de valeur en dur).
//  3. Sauvegarde .env.local → .env.local.prodbak, puis écrit un .env.local
//     STAGING (seuls NEXT_PUBLIC_SUPABASE_URL/ANON_KEY repointés ; le reste des
//     secrets prod est conservé, nécessaire au build/monitoring).
//  4. Lance `playwright test <args>` (NODE_OPTIONS=--use-system-ca pour Avast).
//  5. RESTAURE toujours .env.local en sortie (succès, échec, Ctrl-C).
//
// Garde-fous : refuse si le port 3000 est déjà occupé (sinon Playwright
// réutiliserait un serveur prod via reuseExistingServer) ou si un backup
// résiduel traîne (restauration précédente échouée → intervention manuelle).
//
// Usage : node scripts/e2e-staging.mjs [args playwright]
//   node scripts/e2e-staging.mjs                       # toute la suite
//   node scripts/e2e-staging.mjs courses.spec.ts --retries=2
//   node scripts/e2e-staging.mjs -g "restes"
// Astuce : passer --retries=2 reproduit les conditions CI (flakiness latence).

import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import { spawn } from "node:child_process"

const STAGING_REF = "upxoxrjumxpzumakawiv"
const PROD_REF = "gabyhlcwahzquolwxmgd"
const ENV = ".env.local"
const BAK = ".env.local.prodbak"

function lireVar(contenu, nom) {
  const m = contenu.match(new RegExp(`^${nom}=(.*)$`, "m"))
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null
}

function portOccupe(port) {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" })
    s.on("connect", () => { s.destroy(); resolve(true) })
    s.on("error", () => resolve(false))
    setTimeout(() => { s.destroy(); resolve(false) }, 800)
  })
}

async function statutProjet(ref, token) {
  const rep = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!rep.ok) throw new Error(`API management HTTP ${rep.status} (SUPABASE_ACCESS_TOKEN valide ?)`)
  return (await rep.json()).status ?? "INCONNU"
}

// Réveille le projet s'il dort (tier gratuit). Sans ça, le symptôme est
// déroutant : /v1/projects/<ref>/api-keys répond 200 avec un tableau VIDE (pas
// une erreur d'auth), donc le script échouait sur « Clé anon staging
// introuvable » en laissant croire à un problème de token. Vécu le 2026-09-01,
// staging dormait depuis le 2026-07-20 (cf. le deadlock du workflow keep-alive,
// .github/workflows/supabase-keepalive.yml).
async function assurerProjetActif(ref, token) {
  let statut = await statutProjet(ref, token)
  if (statut === "ACTIVE_HEALTHY") return

  if (statut !== "INACTIVE") {
    // Ni actif ni en pause : transition en cours (COMING_UP/RESTORING…) ou état
    // inattendu. On attend sans demander de restauration (elle serait rejetée).
    console.log(`→ Projet staging en transition (${statut}) — attente…`)
  } else {
    process.stdout.write("→ Projet staging EN PAUSE — demande de restauration… ")
    const rep = await fetch(`https://api.supabase.com/v1/projects/${ref}/restore`, {
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
    await new Promise((r) => setTimeout(r, 15_000))
    statut = await statutProjet(ref, token)
    console.log(`   t+${Math.round((Date.now() - debut) / 1000)}s  ${statut}`)
    if (statut === "ACTIVE_HEALTHY") {
      // Le DNS du sous-domaine peut traîner quelques secondes après l'API.
      await new Promise((r) => setTimeout(r, 10_000))
      console.log("✓ Staging réveillé.")
      return
    }
  }
  throw new Error(`staging toujours pas ACTIVE_HEALTHY après 10 min (dernier statut : ${statut})`)
}

async function main() {
  if (!existsSync(ENV)) throw new Error(`${ENV} introuvable`)
  if (existsSync(BAK)) throw new Error(`${BAK} résiduel — une exécution précédente ne s'est pas restaurée. Vérifier ${ENV} puis supprimer ${BAK}.`)

  const prod = readFileSync(ENV, "utf8").replace(/^﻿/, "")
  if (!prod.includes(PROD_REF)) {
    // Sécurité : on s'attend à ce que .env.local pointe la prod au repos.
    console.warn(`⚠️  ${ENV} ne semble pas pointer la prod (${PROD_REF}). Poursuite quand même.`)
  }
  const token = lireVar(prod, "SUPABASE_ACCESS_TOKEN")
  if (!token) throw new Error(`SUPABASE_ACCESS_TOKEN absent de ${ENV}`)

  if (await portOccupe(3000)) {
    throw new Error("Port 3000 occupé — arrête le serveur dev (sinon Playwright réutiliserait un serveur PROD).")
  }

  await assurerProjetActif(STAGING_REF, token)

  process.stdout.write("→ Récupération des clés anon + service_role staging… ")
  const rep = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!rep.ok) throw new Error(`API management HTTP ${rep.status} (SUPABASE_ACCESS_TOKEN valide ?)`)
  const cles = await rep.json()
  const anon = Array.isArray(cles) ? cles.find((k) => k.name === "anon")?.api_key : null
  if (!anon) throw new Error("Clé anon staging introuvable dans la réponse management (projet actif pourtant — vérifier les clés du projet)")
  // service_role (#237, suppression de compte) : sans ce repointage, la route
  // qui appelle admin.auth.admin.deleteUser() utiliserait la clé service_role
  // PROD (restée dans .env.local) contre l'URL STAGING — échec d'authentification
  // (JWT signé avec le secret du mauvais projet). Best-effort : si absente de la
  // réponse (compte/projet sans cette clé), on continue sans la swapper — seules
  // les features nécessitant service_role en seraient affectées.
  const serviceRole = Array.isArray(cles) ? cles.find((k) => k.name === "service_role")?.api_key : null
  console.log("ok")

  let staging = prod
    .replace(/^NEXT_PUBLIC_SUPABASE_URL=.*$/m, `NEXT_PUBLIC_SUPABASE_URL=https://${STAGING_REF}.supabase.co`)
    .replace(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*$/m, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`)
  if (!staging.includes(STAGING_REF)) throw new Error("Échec du repointage de l'URL staging")
  if (serviceRole) {
    staging = staging.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${serviceRole}`)
  } else {
    console.warn("⚠️  Clé service_role staging introuvable — SUPABASE_SERVICE_ROLE_KEY reste la valeur PROD (les features service_role échoueront contre staging).")
  }

  copyFileSync(ENV, BAK)
  let restaure = false
  const restaurer = () => {
    if (restaure) return
    restaure = true
    if (existsSync(BAK)) { copyFileSync(BAK, ENV); rmSync(BAK); console.log(`↩︎  ${ENV} (prod) restauré`) }
  }
  process.on("SIGINT", () => { restaurer(); process.exit(130) })
  process.on("SIGTERM", () => { restaurer(); process.exit(143) })

  try {
    writeFileSync(ENV, staging, "utf8")
    console.log(`✓ ${ENV} pointe STAGING (${STAGING_REF}). Lancement de Playwright…\n`)
    const code = await new Promise((resolve) => {
      const p = spawn("npx", ["playwright", "test", ...process.argv.slice(2)], {
        stdio: "inherit",
        shell: process.platform === "win32",
        env: { ...process.env, NODE_OPTIONS: "--use-system-ca" },
      })
      p.on("close", resolve)
    })
    restaurer()
    process.exit(code ?? 1)
  } finally {
    restaurer()
  }
}

main().catch((e) => {
  if (existsSync(BAK)) { copyFileSync(BAK, ENV); rmSync(BAK) }
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
