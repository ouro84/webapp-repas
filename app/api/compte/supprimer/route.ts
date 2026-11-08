import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiError } from "@/lib/errors"
import { authentificationRecente } from "@/lib/reauth"

const MESSAGE_REAUTH =
  "Pour supprimer ton compte, confirme d’abord ton identité. La confirmation est valable 5 minutes."

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

  // RG-93 : la session courante doit s’être authentifiée il y a moins de
  // 5 minutes (claim `amr` du JWT). Contrôle AVANT la RPC : l’ordre
  // RPC puis deleteUser reste strict. Une panne de vérification (erreur
  // retournée ou exception du SDK) se distingue d’une session ancienne.
  let claims
  try {
    const { data, error: erreurClaims } = await supabase.auth.getClaims()
    if (erreurClaims) throw erreurClaims
    claims = data
  } catch (erreur) {
    return apiError(
      "POST /api/compte/supprimer",
      erreur,
      "Vérification de ta session impossible. Réessaie dans quelques instants.",
      500
    )
  }
  // Contrôle croisé : les claims lus doivent être ceux de l’utilisateur
  // vérifié par getUser(). Un écart (cookies incohérents) n’autorise rien.
  if (claims?.claims?.sub !== user.id) {
    return apiError(
      "POST /api/compte/supprimer",
      `sub des claims (${String(claims?.claims?.sub)}) différent de l’utilisateur (${user.id})`,
      MESSAGE_REAUTH,
      403
    )
  }
  if (
    !authentificationRecente(
      claims?.claims?.amr,
      Math.floor(Date.now() / 1000)
    )
  ) {
    return apiError(
      "POST /api/compte/supprimer",
      "amr absent ou périmé",
      MESSAGE_REAUTH,
      403
    )
  }

  const { error: erreurRpc } = await supabase.rpc("supprimer_mon_compte")
  if (erreurRpc) {
    // OMQ06 : la RPC refuse aussi une authentification ancienne (jumeau SQL
    // du contrôle ci-dessus), p. ex. si le JWT a vieilli entre les deux.
    if (erreurRpc.code === "OMQ06") {
      return apiError(
        "POST /api/compte/supprimer",
        erreurRpc,
        MESSAGE_REAUTH,
        403
      )
    }
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
