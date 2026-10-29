import type { SupabaseClient } from "@supabase/supabase-js"

// Type commun des clients Supabase (navigateur, serveur à cookies, par jeton)
// accepté par les fonctions à client injecté (#304) : une même lecture sert
// le web (client navigateur par défaut) et le serveur MCP (client par jeton).
export type ClientSupabase = SupabaseClient
