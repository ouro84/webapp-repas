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

export function verifierJeton(
  secret: string,
  jeton: string,
  terme: string,
  maintenantMs: number,
): VerificationJeton {
  // Un uuid contient des tirets mais pas de points : exactement trois parties.
  const parties = jeton.split(".");
  if (parties.length !== 3) return { ok: false, raison: "format" };
  const [demandeId, expTexte, macRecu] = parties;
  if (demandeId === "" || !/^\d{1,15}$/.test(expTexte) || !/^[0-9a-f]{32}$/.test(macRecu)) {
    return { ok: false, raison: "format" };
  }
  const exp = Number(expTexte);

  // Signature d'abord : un jeton forgé ne doit pas apprendre s'il aurait expiré.
  const attendu = Buffer.from(mac(secret, demandeId, terme, exp), "utf8");
  const recu = Buffer.from(macRecu, "utf8");
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) {
    return { ok: false, raison: "signature" };
  }
  if (maintenantMs > exp * 1000) return { ok: false, raison: "expire" };
  return { ok: true, demandeId };
}
