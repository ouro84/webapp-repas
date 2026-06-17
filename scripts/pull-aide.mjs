// Pull de la doc utilisateur depuis Notion (#97, modèle B).
//
// Tire les articles AU STATUT « Publié » de la base Notion « Guide OMQ »,
// les convertit en Markdown et écrit le contenu COMMITTÉ au repo :
//   - content/aide/<slug>.md      (corps de l'article, Markdown pur)
//   - content/aide/index.json     (sommaire : métadonnées de chaque article)
//   - public/aide/<slug>/*        (images rapatriées — les URLs Notion expirent)
//
// La page /aide de l'app lit ces fichiers au build (SSG). Notion reste la
// SOURCE DE VÉRITÉ ; ce script est le seul pont. À relancer après toute
// modification publiée dans Notion.
//
// Usage : NOTION_TOKEN=secret_xxx node scripts/pull-aide.mjs
// Requiert une intégration interne Notion partagée sur la page « Guide
// utilisateur — On mange quoi ? » (qui contient la base).

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Configuration ───────────────────────────────────────────────────────────

const TOKEN = process.env.NOTION_TOKEN;
// Base « Guide OMQ » (override possible via env si la base est recréée).
const DATABASE_ID =
  process.env.NOTION_DATABASE_ID ?? "b453753d-9033-491e-90a7-2c5ae4766f10";
const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

// Ordre canonique des sections (figé ici, pas dans Notion — cf. schéma #97).
const ORDRE_SECTIONS = [
  "Démarrage",
  "Planning",
  "Recettes",
  "Courses",
  "Réglages",
  "Foyer",
  "Mon compte",
  "Dépannage",
];

const RACINE_CONTENU = join(process.cwd(), "content", "aide");
const RACINE_IMAGES = join(process.cwd(), "public", "aide");

if (!TOKEN) {
  console.error(
    "Erreur : NOTION_TOKEN manquant.\n" +
      "Usage : NOTION_TOKEN=secret_xxx node scripts/pull-aide.mjs"
  );
  process.exit(1);
}

// ── Appels API ───────────────────────────────────────────────────────────────

async function notion(chemin, options = {}) {
  const res = await fetch(`${API}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API Notion ${res.status} sur ${chemin} : ${await res.text()}`);
  }
  return res.json();
}

// Toutes les lignes publiées de la base (pagination incluse).
async function listerArticlesPublies() {
  const pages = [];
  let cursor;
  do {
    const data = await notion(`/databases/${DATABASE_ID}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: { property: "Statut", select: { equals: "Publié" } },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// Enfants d'un bloc (ou d'une page), pagination incluse.
async function listerBlocs(blocId) {
  const blocs = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const data = await notion(`/blocks/${blocId}/children?${params}`);
    blocs.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return blocs;
}

// ── Lecture des propriétés ───────────────────────────────────────────────────

const texteBrut = (richText = []) => richText.map((t) => t.plain_text).join("");

function lireProprietes(page) {
  const p = page.properties;
  return {
    titre: texteBrut(p["Titre"]?.title),
    slug: texteBrut(p["Slug"]?.rich_text).trim(),
    section: p["Section"]?.select?.name ?? "",
    ordre: p["Ordre"]?.number ?? 0,
    resume: texteBrut(p["Résumé"]?.rich_text),
    motsCles: (p["Mots-clés"]?.multi_select ?? []).map((m) => m.name),
    majLe: p["Dernière MAJ"]?.last_edited_time ?? page.last_edited_time,
  };
}

// ── Conversion blocs → Markdown ──────────────────────────────────────────────

// Rich text → Markdown inline (gras, italique, code, barré, lien).
function richTextVersMd(richText = []) {
  return richText
    .map((t) => {
      let s = t.plain_text;
      const a = t.annotations ?? {};
      if (a.code) s = `\`${s}\``;
      if (a.bold) s = `**${s}**`;
      if (a.italic) s = `_${s}_`;
      if (a.strikethrough) s = `~~${s}~~`;
      if (t.href) s = `[${s}](${t.href})`;
      return s;
    })
    .join("");
}

// Convertit une liste de blocs en Markdown. `ctx` porte le slug (nommage des
// images) et un compteur d'images partagé.
async function blocsVersMd(blocs, ctx, profondeur = 0) {
  const morceaux = [];
  for (const bloc of blocs) {
    const enfants =
      bloc.has_children && bloc.type !== "table"
        ? await listerBlocs(bloc.id)
        : [];

    switch (bloc.type) {
      case "heading_2":
        morceaux.push(`## ${richTextVersMd(bloc.heading_2.rich_text)}`);
        break;
      case "heading_3":
        morceaux.push(`### ${richTextVersMd(bloc.heading_3.rich_text)}`);
        break;
      case "paragraph":
        morceaux.push(richTextVersMd(bloc.paragraph.rich_text));
        break;
      case "bulleted_list_item":
        morceaux.push(
          indenter(`- ${richTextVersMd(bloc.bulleted_list_item.rich_text)}`, profondeur)
        );
        if (enfants.length) morceaux.push(await blocsVersMd(enfants, ctx, profondeur + 1));
        break;
      case "numbered_list_item":
        morceaux.push(
          indenter(`1. ${richTextVersMd(bloc.numbered_list_item.rich_text)}`, profondeur)
        );
        if (enfants.length) morceaux.push(await blocsVersMd(enfants, ctx, profondeur + 1));
        break;
      case "quote":
        morceaux.push(`> ${richTextVersMd(bloc.quote.rich_text)}`);
        break;
      case "callout": {
        // Callout Notion → blockquote, emoji d'icône conservé en tête.
        const emoji = bloc.callout.icon?.emoji ? `${bloc.callout.icon.emoji} ` : "";
        morceaux.push(`> ${emoji}${richTextVersMd(bloc.callout.rich_text)}`);
        break;
      }
      case "toggle": {
        // Pas de <details> (HTML brut) pour garder un Markdown pur rendu sans
        // rehype-raw : le résumé devient un intertitre gras, le corps suit.
        const corps = enfants.length ? await blocsVersMd(enfants, ctx) : "";
        morceaux.push(`**${richTextVersMd(bloc.toggle.rich_text)}**\n\n${corps}`);
        break;
      }
      case "code":
        morceaux.push(
          `\`\`\`${bloc.code.language ?? ""}\n${texteBrut(bloc.code.rich_text)}\n\`\`\``
        );
        break;
      case "divider":
        morceaux.push("---");
        break;
      case "image": {
        const url = bloc.image.type === "external" ? bloc.image.external.url : bloc.image.file.url;
        const alt = texteBrut(bloc.image.caption);
        const chemin = await telechargerImage(url, ctx);
        morceaux.push(`![${alt}](${chemin})`);
        break;
      }
      case "table":
        morceaux.push(await tableVersMd(bloc));
        break;
      default:
        // Type non géré (cf. contrat de blocs autorisés #97) : ignoré + log.
        console.warn(`  ⚠ bloc « ${bloc.type} » ignoré (non supporté)`);
    }
  }
  // Double saut de ligne entre blocs de tête, simple pour les items de liste.
  return morceaux.join("\n\n");
}

const indenter = (ligne, profondeur) => "  ".repeat(profondeur) + ligne;

async function tableVersMd(bloc) {
  const lignes = await listerBlocs(bloc.id); // table_row
  if (lignes.length === 0) return "";
  const cellules = (row) => row.table_row.cells.map((c) => richTextVersMd(c).replace(/\|/g, "\\|"));
  const [entete, ...corps] = lignes.map(cellules);
  const md = [`| ${entete.join(" | ")} |`, `| ${entete.map(() => "---").join(" | ")} |`];
  for (const row of corps) md.push(`| ${row.join(" | ")} |`);
  return md.join("\n");
}

// ── Images ───────────────────────────────────────────────────────────────────

async function telechargerImage(url, ctx) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image inaccessible (${res.status}) : ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = extensionImage(url, res.headers.get("content-type"));
  ctx.compteurImage += 1;
  const nomFichier = `img-${ctx.compteurImage}.${ext}`;
  const dossier = join(RACINE_IMAGES, ctx.slug);
  await mkdir(dossier, { recursive: true });
  await writeFile(join(dossier, nomFichier), buffer);
  return `/aide/${ctx.slug}/${nomFichier}`; // chemin public servi par Next
}

function extensionImage(url, contentType) {
  const m = url.split("?")[0].match(/\.(png|jpe?g|gif|webp|svg)$/i);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("svg")) return "svg";
  return "jpg";
}

// ── Programme principal ──────────────────────────────────────────────────────

async function principal() {
  console.log("Lecture de la base Notion « Guide OMQ »…");
  const pages = await listerArticlesPublies();
  console.log(`${pages.length} article(s) au statut « Publié ».`);

  // Repart d'un dossier propre (supprime les fichiers obsolètes / images périmées).
  await rm(RACINE_CONTENU, { recursive: true, force: true });
  await rm(RACINE_IMAGES, { recursive: true, force: true });
  await mkdir(RACINE_CONTENU, { recursive: true });

  const index = [];
  const slugsVus = new Set();

  for (const page of pages) {
    const meta = lireProprietes(page);

    // Garde-fous (le build doit échouer plutôt que produire des liens morts).
    if (!meta.slug) throw new Error(`Article « ${meta.titre} » sans slug.`);
    if (slugsVus.has(meta.slug)) throw new Error(`Slug dupliqué : « ${meta.slug} ».`);
    if (!ORDRE_SECTIONS.includes(meta.section)) {
      throw new Error(`Section inconnue « ${meta.section} » (article ${meta.slug}).`);
    }
    slugsVus.add(meta.slug);

    console.log(`  • ${meta.section} / ${meta.titre} (${meta.slug})`);
    const blocs = await listerBlocs(page.id);
    const ctx = { slug: meta.slug, compteurImage: 0 };
    const markdown = await blocsVersMd(blocs, ctx);
    await writeFile(join(RACINE_CONTENU, `${meta.slug}.md`), `${markdown}\n`, "utf8");
    index.push(meta);
  }

  // Tri : section canonique puis Ordre croissant.
  index.sort((a, b) => {
    const ds = ORDRE_SECTIONS.indexOf(a.section) - ORDRE_SECTIONS.indexOf(b.section);
    return ds !== 0 ? ds : a.ordre - b.ordre;
  });

  await writeFile(
    join(RACINE_CONTENU, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8"
  );
  console.log(`\n✓ ${index.length} article(s) écrit(s) dans content/aide/.`);
}

principal().catch((e) => {
  console.error(`\n✗ Échec du pull : ${e.message}`);
  process.exit(1);
});
