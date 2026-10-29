import { createClient } from "@/lib/supabase/client"
import type { ClientSupabase } from "@/lib/supabase/types"

// Client par DÉFAUT des fonctions d'accès à client injectable (#304).
//
// Dans le navigateur : le client navigateur (session de l'utilisateur). Hors
// navigateur, on REFUSE : createBrowserClient ne lève pas sans cookies et
// donnerait un client anonyme, pour lequel la RLS mon_foyer() renvoie
// silencieusement « rien » (liste vide, lundi, cycle de 7 j…). Côté serveur
// (route, MCP), l'appelant passe le client de l'utilisateur (RG-71).
export function clientParDefaut(): ClientSupabase {
  if (typeof window === "undefined") {
    throw new Error("Client Supabase requis côté serveur : passe le client de l'utilisateur.")
  }
  return createClient()
}
