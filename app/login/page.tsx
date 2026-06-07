"use client"

import { createClient } from "@/lib/supabase/client"
import { FormulaireAuth, LienPied } from "@/components/auth/formulaire-auth"

export default function LoginPage() {
  const supabase = createClient()

  // Renvoie le message d'erreur Supabase, ou null si la connexion réussit.
  // (La traduction des messages en français est suivie par l'issue #58.)
  async function connecter(
    email: string,
    password: string
  ): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error?.message ?? null
  }

  return (
    <FormulaireAuth
      titre="Se connecter"
      autocompletePassword="current-password"
      labelSoumettre="Se connecter"
      labelChargement="Connexion…"
      onSoumettre={connecter}
      pied={
        <>
          Pas encore de compte ? <LienPied href="/signup">S&apos;inscrire</LienPied>
        </>
      }
    />
  )
}
