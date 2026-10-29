// Erreurs des outils MCP (#305, RG-78) : le message est destiné à l'ASSISTANT,
// en français, et dit quoi faire ensuite. Le serveur (lib/mcp/serveur.ts) le
// renvoie en résultat `isError: true` ; toute autre exception est loggée et
// remplacée par un message générique.
export class ErreurOutil extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ErreurOutil"
  }
}
