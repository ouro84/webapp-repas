// Traduction des erreurs d'authentification Supabase — logique pure (#58).
//
// Supabase renvoie des messages en anglais (« Invalid login credentials »).
// Cette fonction les convertit en messages français actionnables (cause +
// remède), pour login ET signup. Mapping par `code` (SDK récent) en priorité,
// repli sur le `message` (SDK ancien ou code absent), puis message générique.
//
// Aucune dépendance Supabase : on type juste la forme minimale de l'erreur,
// ce qui rend la fonction testable en isolation.

export type ErreurAuth = {
  message?: string
  code?: string
  status?: number
}

const MESSAGE_GENERIQUE =
  "Une erreur est survenue. Réessaie dans un instant."

// Codes d'erreur GoTrue (supabase-js v2) → message français.
const PAR_CODE: Record<string, string> = {
  invalid_credentials:
    "Email ou mot de passe incorrect. Vérifie ta saisie ou inscris-toi.",
  email_not_confirmed:
    "Ton email n'est pas encore confirmé. Vérifie ta boîte de réception.",
  user_already_exists:
    "Un compte existe déjà avec cet email. Connecte-toi plutôt.",
  email_exists: "Un compte existe déjà avec cet email. Connecte-toi plutôt.",
  weak_password: "Mot de passe trop court : au moins 6 caractères.",
  over_request_rate_limit:
    "Trop de tentatives. Patiente quelques minutes avant de réessayer.",
  over_email_send_rate_limit:
    "Trop de tentatives. Patiente quelques minutes avant de réessayer.",
  validation_failed: "Adresse email invalide.",
  email_address_invalid: "Adresse email invalide.",
}

// Repli par sous-chaîne du message anglais (SDK sans `code`).
// Ordre important : la première correspondance gagne.
const PAR_MESSAGE: { motif: string; texte: string }[] = [
  { motif: "invalid login credentials", texte: PAR_CODE.invalid_credentials },
  { motif: "email not confirmed", texte: PAR_CODE.email_not_confirmed },
  { motif: "already registered", texte: PAR_CODE.user_already_exists },
  { motif: "already been registered", texte: PAR_CODE.user_already_exists },
  { motif: "user already exists", texte: PAR_CODE.user_already_exists },
  { motif: "password should be at least", texte: PAR_CODE.weak_password },
  { motif: "rate limit", texte: PAR_CODE.over_request_rate_limit },
  { motif: "unable to validate email", texte: PAR_CODE.email_address_invalid },
]

/**
 * Convertit une erreur d'auth Supabase en message français actionnable.
 * Renvoie un message générique si le code et le message sont inconnus —
 * jamais le texte brut anglais de Supabase (#58).
 */
export function traduireErreurAuth(erreur: ErreurAuth | null): string {
  if (!erreur) return MESSAGE_GENERIQUE

  if (erreur.code && PAR_CODE[erreur.code]) {
    return PAR_CODE[erreur.code]
  }

  const message = erreur.message?.toLowerCase() ?? ""
  for (const { motif, texte } of PAR_MESSAGE) {
    if (message.includes(motif)) return texte
  }

  return MESSAGE_GENERIQUE
}
