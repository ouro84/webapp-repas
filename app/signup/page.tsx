"use client"

import { createClient } from "@/lib/supabase/client"
import { FormulaireAuth, LienPied } from "@/components/auth/formulaire-auth"

export default function SignupPage() {
  const supabase = createClient()

  // Renvoie le message d'erreur Supabase, ou null si l'inscription réussit.
  // (La traduction des messages en français est suivie par l'issue #58.)
  async function inscrire(
    email: string,
    password: string
  ): Promise<string | null> {
    const { error } = await supabase.auth.signUp({ email, password })
    return error?.message ?? null
  }

  return (
    <FormulaireAuth
      titre="Créer un compte"
      autocompletePassword="new-password"
      minLengthPassword={6}
      labelSoumettre="Créer mon compte"
      labelChargement="Création…"
      onSoumettre={inscrire}
      pied={
        <>
          Déjà un compte ? <LienPied href="/login">Se connecter</LienPied>
        </>
      }
    />
  )
}
