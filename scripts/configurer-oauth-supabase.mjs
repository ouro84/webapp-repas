#!/usr/bin/env node
// Configure le serveur OAuth 2.1 de Supabase Auth (#305, ADR-11, RG-71/72) par
// l'API de management, sans passer par le dashboard.
//
// Usage :
//   node scripts/configurer-oauth-supabase.mjs <ref>                     # lecture seule
//   node scripts/configurer-oauth-supabase.mjs <ref> --appliquer         # active OAuth + DCR + chemin de consentement
//   node scripts/configurer-oauth-supabase.mjs <ref> --site-url=<url>    # change le site_url (tests sur preview)
// Sur la PROD, toute écriture exige en plus --prod-valide (validation humaine).
//
// L'URL de l'écran de consentement est site_url + oauth_server_authorization_path :
// staging garde http://localhost:3000 pour l'e2e local (cf. .claude/rules/mcp.md).
// Token : SUPABASE_ACCESS_TOKEN de l'environnement, sinon lu dans .env.local.

import { existsSync, readFileSync } from "node:fs"

const PROD_REF = "gabyhlcwahzquolwxmgd"
const CHEMIN_CONSENTEMENT = "/oauth/consent"
const API = "https://api.supabase.com/v1/projects"

function lireToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  if (!existsSync(".env.local")) return null
  const contenu = readFileSync(".env.local", "utf8").replace(/^﻿/, "")
  const m = contenu.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null
}

async function appeler(token, chemin, options = {}) {
  const rep = await fetch(`${API}/${chemin}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })
  const corps = await rep.text()
  if (!rep.ok) throw new Error(`API management HTTP ${rep.status} sur ${chemin} : ${corps}`)
  return corps ? JSON.parse(corps) : null
}

async function afficher(token, ref) {
  const [projet, auth, cles] = await Promise.all([
    appeler(token, ref),
    appeler(token, `${ref}/config/auth`),
    appeler(token, `${ref}/config/auth/signing-keys`),
  ])
  console.log(`Projet ${ref} : ${projet.status}`)
  console.log(`  site_url = ${JSON.stringify(auth.site_url)}`)
  for (const cle of ["oauth_server_enabled", "oauth_server_allow_dynamic_registration", "oauth_server_authorization_path"]) {
    console.log(`  ${cle} = ${JSON.stringify(auth[cle])}`)
  }
  const liste = Array.isArray(cles) ? cles : cles?.keys ?? []
  console.log(`  clés de signature : ${liste.map((k) => `${k.algorithm} (${k.status})`).join(", ")}`)
}

async function main() {
  const [ref, ...options] = process.argv.slice(2)
  if (!ref) throw new Error("Usage : node scripts/configurer-oauth-supabase.mjs <ref> [--appliquer] [--site-url=<url>] [--prod-valide]")
  const token = lireToken()
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN introuvable (environnement ou .env.local).")

  const appliquer = options.includes("--appliquer")
  const siteUrl = options.find((o) => o.startsWith("--site-url="))?.slice("--site-url=".length)
  const ecriture = appliquer || siteUrl !== undefined

  if (ecriture && ref === PROD_REF && !options.includes("--prod-valide")) {
    throw new Error("Écriture sur la PROD refusée sans --prod-valide (validation humaine requise).")
  }

  if (ecriture) {
    const patch = {}
    if (appliquer) {
      patch.oauth_server_enabled = true
      patch.oauth_server_allow_dynamic_registration = true
      patch.oauth_server_authorization_path = CHEMIN_CONSENTEMENT
    }
    if (siteUrl !== undefined) patch.site_url = siteUrl
    console.log(`→ PATCH config/auth : ${JSON.stringify(patch)}`)
    await appeler(token, `${ref}/config/auth`, { method: "PATCH", body: JSON.stringify(patch) })
  }

  await afficher(token, ref)
}

main().catch((erreur) => {
  console.error(`✗ ${erreur.message}`)
  process.exit(1)
})
