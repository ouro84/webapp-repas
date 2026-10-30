// Spike #307 — émet le webhook de réveil de Hermes, comme le fera OMQ (RG-81).
// Usage : node envoyer-webhook.mjs <url> <secret>
// Corps sans donnée métier. Signature Standard Webhooks, celle que vérifie Hermes
// (gateway/platforms/webhook.py) : base64 HMAC-SHA256 de "<id>.<timestamp>.<corps>",
// avec fenêtre anti-rejeu sur le timestamp et dédoublonnage par id.
import { createHmac, randomUUID } from "node:crypto";

const [url, secret] = process.argv.slice(2);
if (!url || !secret) {
  console.error("usage : node envoyer-webhook.mjs <url> <secret>");
  process.exit(2);
}

const corps = JSON.stringify({ evenement: "demande_panier" });
const id = `msg_${randomUUID()}`;
const horodatage = String(Math.floor(Date.now() / 1000));
// Secret « whsec_… » = clé en base64 ; sinon secret brut (les deux sont acceptés par Hermes).
const cle = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret);
const signature = createHmac("sha256", cle).update(`${id}.${horodatage}.${corps}`).digest("base64");

const r = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": horodatage, "webhook-signature": `v1,${signature}` },
  body: corps,
});
console.log(JSON.stringify({ statut: r.status, corps: (await r.text()).slice(0, 200) }));
