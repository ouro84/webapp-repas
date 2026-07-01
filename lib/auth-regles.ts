// Règles d'authentification partagées (#189, audit F-02).
//
// Source UNIQUE de la longueur minimale du mot de passe, importée par les trois
// points de saisie (inscription, réinitialisation, changement) ET par la
// traduction d'erreur (lib/messages-auth.ts) — fini les trois constantes
// divergentes.
//
// ⚠️ L'autorité RÉELLE est la config Supabase Auth (longueur minimale +
// complexité + « Leaked Password Protection » / HaveIBeenPwned). Le front n'est
// qu'un garde-fou UX : un client modifié peut le contourner, c'est Supabase qui
// refuse au final. À activer en console côté DEV et PROD (la protection anti-fuite
// peut dépendre du plan Pro, cf. #241).
//
// Politique de reprise : application EN AVANT uniquement (nouvelles inscriptions,
// réinitialisations et changements). Les comptes existants conservent leur mot de
// passe jusqu'à leur prochain changement — pas de reset forcé (dette assumée, à
// revoir à l'ouverture publique ; Supabase ne permet pas de cibler les mots de
// passe faibles, qui sont hashés).
export const LONGUEUR_MIN_MDP = 8
