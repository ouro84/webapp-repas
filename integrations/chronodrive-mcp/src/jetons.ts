// Jetons signés par article du run de panier (#330, RG-83). Format `<demande_id>.<exp>.<mac>` :
// `exp` en secondes (pris_le + 30 min), `mac` = 32 premiers hex de
// HMAC-SHA256(sous_cle, "<demande_id>|<cle>|<exp>"), avec sous_cle = HMAC-SHA256(cle_secret,
// "jetons-panier") et cle_secret décodée comme dans `creer_demande_panier` (préfixe `whsec_` →
// base64, sinon octets UTF-8). Le jeton ne lie pas les quantités. Les jetons sont émis par
// Postgres ; `signerJeton` ne sert qu'aux tests et aux vecteurs.
// Pièges : .claude/rules/chronodrive.md.
import { createHmac, timingSafeEqual } from "node:crypto";

// Jumeau de `cleJeton` de lib/jeton-panier.ts (côté OMQ), testé sur les mêmes vecteurs.
export function cleJeton(libelle: string): string {
  return libelle.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

export type VerificationJeton =
  | { ok: true; demandeId: string }
  | { ok: false; raison: "format" | "signature" | "expire" };

// Même règle que `creer_demande_panier` : `whsec_` + base64 → octets décodés, sinon UTF-8 brut.
function cleSecrete(secret: string): Buffer {
  return secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
}

function mac(secret: string, demandeId: string, libelle: string, exp: number): string {
  const sousCle = createHmac("sha256", cleSecrete(secret)).update("jetons-panier", "utf8").digest();
  return createHmac("sha256", sousCle)
    .update(`${demandeId}|${cleJeton(libelle)}|${exp}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function signerJeton(secret: string, demandeId: string, libelle: string, exp: number): string {
  return `${demandeId}.${exp}.${mac(secret, demandeId, libelle, exp)}`;
}

// uuid en minuscules, forme de `demande_panier.id::text` côté Postgres.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Découpe `<demande_id>.<exp>.<mac>` ; null si le format est invalide. Un uuid contient des tirets
// mais pas de points : exactement trois parties.
function decouper(jeton: string): { demandeId: string; exp: number; mac: string } | null {
  const parties = jeton.split(".");
  if (parties.length !== 3) return null;
  const [demandeId, expTexte, macTexte] = parties;
  if (!UUID.test(demandeId) || !/^\d{1,15}$/.test(expTexte) || !/^[0-9a-f]{32}$/.test(macTexte)) return null;
  return { demandeId, exp: Number(expTexte), mac: macTexte };
}

export function verifierJeton(
  secret: string,
  jeton: string,
  terme: string,
  maintenantMs: number,
): VerificationJeton {
  const lu = decouper(jeton);
  if (!lu) return { ok: false, raison: "format" };
  const { demandeId, exp, mac: macRecu } = lu;

  // Signature d'abord : un jeton forgé ne doit pas apprendre s'il aurait expiré.
  const attendu = Buffer.from(mac(secret, demandeId, terme, exp), "utf8");
  const recu = Buffer.from(macRecu, "utf8");
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) {
    return { ok: false, raison: "signature" };
  }
  if (maintenantMs > exp * 1000) return { ok: false, raison: "expire" };
  return { ok: true, demandeId };
}

// Lecture d'un jeton SANS contrôle de signature : format, expiration, demande. Pour les co-jetons
// d'une ligne fusionnée de `ajouter_au_panier`, dont le libellé est inconnu de chronodrive (le
// jeton ne le porte pas) : seul le jeton de `terme` est vérifié par `verifierJeton`.
export function lireJeton(
  jeton: string,
  maintenantMs: number,
): { ok: true; demandeId: string } | { ok: false; raison: "format" | "expire" } {
  const lu = decouper(jeton);
  if (!lu) return { ok: false, raison: "format" };
  if (maintenantMs > lu.exp * 1000) return { ok: false, raison: "expire" };
  return { ok: true, demandeId: lu.demandeId };
}

// Garde des jetons d'une ligne (#330, RG-83) : l'article doit venir d'une demande OMQ prise par ce
// run. Le jeton ne porte pas le libellé, seulement sa signature : `chronodrive` ne peut vérifier la
// SIGNATURE d'un jeton que contre `terme`. Pour une ligne fusionnée, au moins un jeton doit vérifier
// `terme` (signature + expiration) ; les autres (co-jetons) doivent avoir un format et une
// expiration valides et la même demande, mais leur signature n'est pas lue : n'importe quel MAC hex
// de 32 caractères passe pour un co-jeton. Sans conséquence : seul le jeton de `terme` autorise
// l'ajout. Pourquoi : sans demande prise, aucun jeton n'est signé, donc rien ne part chez Chronodrive ;
// un jeton d'une demande précédente expire (30 min) et ne couvre que son propre libellé.
export function jetonsValides(secret: string, jetons: string[], terme: string, maintenant: number): boolean {
  const lus = jetons.map((j) => lireJeton(j, maintenant));
  const demandes = new Set<string>();
  for (const l of lus) {
    if (!l.ok) return false;
    demandes.add(l.demandeId);
  }
  if (demandes.size !== 1) return false;
  return jetons.some((j) => verifierJeton(secret, j, terme, maintenant).ok);
}
