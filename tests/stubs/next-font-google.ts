// Substitut de `next/font/google` pour Vitest : la fonction n'existe que dans la
// chaîne de build Next (loader SWC). Ici, toute police renvoie une classe vide.
const police = () => ({ className: "", style: {}, variable: "" })

export const Roboto = police
