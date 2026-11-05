// Commande de lancement de Playwright, SANS shell (#357).
//
// Pourquoi : sous Windows, `spawn("npx", …, { shell: true })` repasse les
// arguments par cmd.exe, qui coupe un motif `-g` contenant des espaces ou un
// `|` et abîme les accents. On lance donc `node <cli Playwright> test …` en
// direct : chaque argument arrive intact. Le CLI est résolu depuis ce fichier
// (via l'export `./cli` de @playwright/test), jamais depuis le cwd.
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

/**
 * @param {string[]} args arguments passés à `playwright test`
 * @returns {{ commande: string, arguments: string[], shell: false }}
 */
export function commandePlaywright(args) {
  return {
    commande: process.execPath,
    arguments: [require.resolve("@playwright/test/cli"), "test", ...args],
    shell: false,
  }
}
