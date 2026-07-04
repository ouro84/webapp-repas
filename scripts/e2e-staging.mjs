#!/usr/bin/env node
// Joue les e2e Playwright en LOCAL contre l'instance Supabase STAGING (jamais la
// prod), pour fiabiliser une branche AVANT d'ouvrir/pusher une PR (cf. CLAUDE.md
// « E2E sur staging avant PR »). Remplace le wrapper scratchpad manuel de la
// mémoire [[e2e-local-staging]].
//
// Ce qu'il fait :
//  1. Lit .env.local (qui pointe la PROD) pour récupérer SUPABASE_ACCESS_TOKEN.
//  2. Récupère la clé anon STAGING courante via l'API de management (elle change
//     — pas de valeur en dur).
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

  process.stdout.write("→ Récupération de la clé anon staging… ")
  const rep = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!rep.ok) throw new Error(`API management HTTP ${rep.status} (SUPABASE_ACCESS_TOKEN valide ?)`)
  const cles = await rep.json()
  const anon = Array.isArray(cles) ? cles.find((k) => k.name === "anon")?.api_key : null
  if (!anon) throw new Error("Clé anon staging introuvable dans la réponse management")
  console.log("ok")

  const staging = prod
    .replace(/^NEXT_PUBLIC_SUPABASE_URL=.*$/m, `NEXT_PUBLIC_SUPABASE_URL=https://${STAGING_REF}.supabase.co`)
    .replace(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*$/m, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`)
  if (!staging.includes(STAGING_REF)) throw new Error("Échec du repointage de l'URL staging")

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
