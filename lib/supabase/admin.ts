import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// Client Supabase ADMIN (service_role) — SERVEUR UNIQUEMENT (#237). Ne jamais
// importer depuis un fichier "use client" : la clé donne un accès complet,
// contournant toute RLS. Utilisé uniquement par
// app/api/compte/supprimer/route.ts pour admin.auth.admin.deleteUser().
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquante : impossible de supprimer un compte."
    )
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
