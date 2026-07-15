import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiError } from "@/lib/errors"

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return apiError(
      "POST /api/compte/supprimer",
      authError,
      "Tu dois être connecté pour supprimer ton compte.",
      401
    )
  }

  const { error: erreurRpc } = await supabase.rpc("supprimer_mon_compte")
  if (erreurRpc) {
    return apiError(
      "POST /api/compte/supprimer",
      erreurRpc,
      "Suppression des données impossible. Réessaie dans quelques instants.",
      500
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (erreur) {
    return apiError(
      "POST /api/compte/supprimer",
      erreur,
      "Suppression indisponible pour l'instant. Réessaie plus tard ou contacte-nous.",
      500
    )
  }

  const { error: erreurDelete } = await admin.auth.admin.deleteUser(user.id)
  if (erreurDelete) {
    return apiError(
      "POST /api/compte/supprimer",
      erreurDelete,
      "Tes données ont été supprimées mais la fermeture du compte a échoué. Réessaie — l'opération est sûre à rejouer.",
      500
    )
  }

  return NextResponse.json({ ok: true })
}
