// Commande de lancement de Playwright par scripts/e2e-staging.mjs (#357).
//
// Pourquoi ce test existe : sous Windows, l'ancien `spawn("npx", …, { shell: true })`
// repassait les arguments par cmd.exe, qui coupait un motif `-g` contenant des
// espaces ou un `|`. La commande doit viser directement le CLI de Playwright
// avec `node`, sans shell, pour que chaque argument arrive intact.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { commandePlaywright } from "../scripts/commande-playwright.mjs";

describe("commandePlaywright (#357)", () => {
  const motif = "stepper born|lectionner manuellement";
  const cmd = commandePlaywright(["e2e/x.spec.ts", "-g", motif]);

  it("n'utilise pas de shell", () => {
    expect(cmd.shell).toBe(false);
  });

  it("lance le CLI Playwright avec le node courant", () => {
    expect(cmd.commande).toBe(process.execPath);
    expect(cmd.arguments[0].endsWith("cli.js")).toBe(true);
    expect(existsSync(cmd.arguments[0])).toBe(true);
    expect(cmd.arguments[1]).toBe("test");
  });

  it("transmet les arguments octet pour octet (espaces, |)", () => {
    expect(cmd.arguments.slice(2)).toEqual(["e2e/x.spec.ts", "-g", motif]);
    expect(cmd.arguments[cmd.arguments.length - 1]).toBe(motif);
  });

  it("conserve les accents et les guillemets", () => {
    const m = 'ça "marche" é|è';
    expect(commandePlaywright(["-g", m]).arguments.at(-1)).toBe(m);
  });

  it("résout le CLI sans dépendre du cwd", () => {
    const avant = process.cwd();
    try {
      process.chdir(process.env.TEMP ?? "/");
      expect(existsSync(commandePlaywright([]).arguments[0])).toBe(true);
    } finally {
      process.chdir(avant);
    }
  });
});
