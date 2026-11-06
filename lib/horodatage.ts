// Horodatages Postgres (`updated_at`, posé par trigger) comparés à la
// microseconde, jamais comme chaînes : Postgres tronque les zéros finaux de la
// fraction et Realtime / RETURNING ne formatent pas l'instant de la même façon.

// `updated_at` → entier en microsecondes, ou null s'il est absent ou illisible
// (ex. un DELETE dont `old` ne porte que la clé primaire : ignoré, comme avant).
// Postgres tronque les zéros finaux (« .94056 » = 940 560 µs) : on complète.
export function cleHorodatage(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? "";
  const micro = Number((fraction + "000000").slice(0, 6));
  return Math.floor(ms / 1000) * 1_000_000 + micro;
}
