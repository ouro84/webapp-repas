// Génère les icônes PWA (#71, P18) depuis le mark de marque (app/icon.svg).
//
// Le mark n'est pas carré (≈ 430×495) : on le rend à une taille interne puis on
// le compose CENTRÉ sur un canevas carré (sharp). Mark blanc sur fond vert
// brand-600 (#3d7a44) pour les icônes pleines ; mark blanc sur TRANSPARENT pour
// l'icône monochrome (Android se sert de l'alpha comme masque et applique sa
// propre teinte — Material You / icônes thématiques). Le maskable réserve une
// zone de sécurité (mark plus petit) pour ne pas être rogné par le launcher.
//
// Usage : node scripts/generer-icones-pwa.mjs

import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWBOX_W = 429.97;
const VIEWBOX_H = 495.13;

// Extrait les `d="..."` du mark de référence (source unique de vérité).
const svgSource = readFileSync(join(racine, "app/icon.svg"), "utf8");
const paths = [...svgSource.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
if (paths.length === 0) throw new Error("Aucun path trouvé dans app/icon.svg");

// SVG du mark à une hauteur cible (en px), recoloré, sans stroke.
function markSvg(hauteurPx, couleur) {
  const largeurPx = Math.round(hauteurPx * (VIEWBOX_W / VIEWBOX_H));
  const corps = paths
    .map((d) => `<path d="${d}" fill="${couleur}" />`)
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largeurPx}" height="${hauteurPx}" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}">${corps}</svg>`
  );
}

// Compose le mark centré sur un canevas carré.
async function genererIcone({ sortie, taille, ratio, fond }) {
  const hauteurMark = Math.round(taille * ratio);
  const mark = await sharp(markSvg(hauteurMark, "#ffffff")).png().toBuffer();
  await sharp({
    create: {
      width: taille,
      height: taille,
      channels: 4,
      background: fond, // objet {r,g,b,alpha} ou couleur
    },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(join(racine, sortie));
  console.log("✓", sortie);
}

const VERT = { r: 0x3d, g: 0x7a, b: 0x44, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

mkdirSync(join(racine, "public/icons"), { recursive: true });

await genererIcone({ sortie: "public/icons/icon-192.png", taille: 192, ratio: 0.6, fond: VERT });
await genererIcone({ sortie: "public/icons/icon-512.png", taille: 512, ratio: 0.6, fond: VERT });
// Maskable : zone de sécurité (mark ~52% pour rester dans le cercle sûr 80%).
await genererIcone({ sortie: "public/icons/icon-maskable-512.png", taille: 512, ratio: 0.52, fond: VERT });
// Monochrome : mark blanc sur transparent → re-teinté par le launcher Android.
await genererIcone({ sortie: "public/icons/icon-monochrome-512.png", taille: 512, ratio: 0.52, fond: TRANSPARENT });
// Apple touch icon : opaque (iOS gère mal la transparence), arrondi auto par iOS.
await genererIcone({ sortie: "app/apple-icon.png", taille: 180, ratio: 0.6, fond: VERT });

console.log("Icônes PWA générées.");
