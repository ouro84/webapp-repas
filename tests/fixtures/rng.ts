// PRNG déterministe (mulberry32) pour les tests qui injectent `random`.
//
// Pourquoi (#157) : sans seed, `genererPlanning` pouvait épuiser au hasard le
// vivier « rapide » et `remplacerSlot` renvoyait alors légitimement `null` ;
// l'assertion `not.toBeNull()` tombait ~0,4 % des runs. Avec un seed fixe, un
// test passe ou échoue toujours, jamais « occasionnellement ».
export function rngSeed(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
