// Jeton signé par article du run de panier (#330, RG-83) : normalisation du libellé couvert par
// le jeton. Jumeau de `cleJeton` de integrations/chronodrive-mcp/src/jetons.ts : les deux sont
// testés sur les mêmes vecteurs (integrations/chronodrive-mcp/test/vecteurs-jetons.json).
// Pourquoi : le MCP chronodrive vérifie le jeton sur le terme recopié par le modèle ; une
// normalisation différente d'un côté rejetterait un libellé légitime (ou en accepterait un autre).

// Clé de comparaison d'un libellé : NFC, bords rognés, espaces repliés, minuscules françaises.
export function cleJeton(libelle: string): string {
  return libelle.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}
