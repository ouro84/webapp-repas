// Tests du jumeau OMQ de `cleJeton` (#330, RG-83) : les mêmes vecteurs que côté chronodrive
// (integrations/chronodrive-mcp/test/vecteurs-jetons.json) garantissent que les deux
// implémentations normalisent un libellé à l’identique.

import { describe, expect, it } from "vitest";
import { cleJeton } from "@/lib/jeton-panier";
import vecteurs from "../integrations/chronodrive-mcp/test/vecteurs-jetons.json";

describe("cleJeton (jumeau chronodrive)", () => {
  it.each(vecteurs)("normalise « $libelle » en « $cle »", (v) => {
    expect(cleJeton(v.libelle)).toBe(v.cle);
  });
});
