import { describe, it, expect } from "vitest"
import { limiteGeneration } from "./rate-limit"

// En environnement de test (et en CI), les variables UPSTASH_* sont absentes →
// le limiteur est NO-OP et autorise tout. C'est le comportement dont dépendent
// les e2e (qui génèrent plusieurs plannings sans déclencher de 429). Ce test
// garde ce contrat ; le vrai plafonnement (avec Upstash configuré) n'est pas
// couvert ici (il exigerait de mocker le service distant).
describe("limiteGeneration (sans Upstash configuré)", () => {
  it("autorise quand le limiteur est désactivé (env absente)", async () => {
    const r1 = await limiteGeneration("utilisateur-a")
    const r2 = await limiteGeneration("utilisateur-a")
    expect(r1.autorise).toBe(true)
    expect(r2.autorise).toBe(true)
  })

  it("autorise pour n'importe quel identifiant", async () => {
    const { autorise } = await limiteGeneration("autre-utilisateur")
    expect(autorise).toBe(true)
  })
})
