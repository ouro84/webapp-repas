import { createClient } from "@supabase/supabase-js"
import type { ClientSupabase } from "@/lib/supabase/types"

// Client Supabase « par jeton » — SERVEUR (#304, pour le serveur MCP #305).
//
// RG-71 : l'assistant agit EN TANT QUE l'utilisateur. On crée un client avec la
// clé ANON et le JWT `authenticated` de l'utilisateur en en-tête Authorization :
// PostgREST applique alors la RLS `mon_foyer()` telle quelle, sans code
// d'autorisation supplémentaire. Jamais de `service_role` sur ce chemin (cf.
// lib/supabase/admin.ts, réservé à la suppression de compte).
//
// Sans session persistée ni rafraîchissement : le jeton est fourni à chaque
// requête par l'appelant (un client par requête).
export function creerClientParJeton(jeton: string): ClientSupabase {
  if (!jeton.trim()) {
    throw new Error("Jeton d'accès manquant.")
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const cleAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !cleAnon) {
    throw new Error("Configuration Supabase incomplète (URL ou clé anon manquante).")
  }
  return createClient(url, cleAnon, {
    global: { headers: { Authorization: `Bearer ${jeton}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
