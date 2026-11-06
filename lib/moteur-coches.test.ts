import { describe, expect, it, vi } from "vitest"
import {
  creerMoteurCoches,
  type Etat,
  type MoteurCoches,
  type StockageCoches,
  type TransportCoches,
} from "@/lib/moteur-coches"

// Table de cas du moteur de coche (#362 phase 2) : faux transport dont on
// résout les promesses à la main, faux stockage `Map`, fausse vue `Map`.
// Horodatages au format Postgres (fraction tronquée de ses zéros finaux).

const A = "2026-11-02"
const B = "2026-11-09"
const T0 = "2026-11-06T10:00:00.98765+00:00"
const T1 = "2026-11-06T10:00:01.12345+00:00"
const T2 = "2026-11-06T10:00:01.9405+00:00"
const T5 = "2026-11-06T10:00:05.5+00:00"
const T6 = "2026-11-06T10:00:06.000123+00:00"
const TOMATES = "tomates|piece"
const RIZ = "riz|g"

type AppelEcrire = {
  type: "ecrire"
  ancre: string
  cle: string
  etat: Etat<number>
  resoudre: (maj: string | null) => void
  rejeter: (erreur: unknown) => void
}
type AppelVider = {
  type: "vider"
  ancre: string
  resoudre: (lignes: Array<{ cle: string; maj: string }>) => void
  rejeter: (erreur: unknown) => void
}
type Appel = AppelEcrire | AppelVider

function fauxTransport() {
  const appels: Appel[] = []
  const transport: TransportCoches<number> = {
    ecrire(ancre, cle, etat) {
      return new Promise((resolve, reject) => {
        appels.push({ type: "ecrire", ancre, cle, etat, resoudre: resolve, rejeter: reject })
      })
    },
    vider(ancre) {
      return new Promise((resolve, reject) => {
        appels.push({ type: "vider", ancre, resoudre: resolve, rejeter: reject })
      })
    },
  }
  return { transport, appels }
}

function fauxStockage(): StockageCoches & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>()
  return {
    donnees,
    lire: (cle) => donnees.get(cle) ?? null,
    ecrire: (cle, valeur) => void donnees.set(cle, valeur),
    effacer: (cle) => void donnees.delete(cle),
  }
}

function monter(
  stockage: StockageCoches = fauxStockage(),
  options: {
    estDefinitive?: (erreur: unknown) => boolean
    surEtat?: (etat: "sauvegarde" | "synchronise" | "hors-ligne") => void
  } = {}
) {
  const { transport, appels } = fauxTransport()
  const vue = new Map<string, Etat<number>>()
  const etats: string[] = []
  const journal = vi.fn()
  const moteur: MoteurCoches<number> = creerMoteurCoches<number>({
    nom: "coches_test",
    transport,
    vue: {
      appliquer: (cle, etat) => void vue.set(cle, etat),
      vider: () => vue.clear(),
    },
    stockage,
    surEtat: (etat) => {
      etats.push(etat)
      options.surEtat?.(etat)
    },
    journal,
    estDefinitive: options.estDefinitive,
  })
  const cochee = (cle: string) => vue.get(cle)?.coche === true
  return { moteur, appels, vue, etats, journal, stockage, cochee }
}

// Laisse passer les microtâches (réponse du transport → suite du flush).
const attendre = () => new Promise<void>((r) => setTimeout(r, 0))

const coche = (valeur = 3): Etat<number> => ({ coche: true, valeur })
const decoche = (valeur = 3): Etat<number> => ({ coche: false, valeur })

function ecriture(appel: Appel | undefined): AppelEcrire {
  if (!appel || appel.type !== "ecrire") throw new Error("écriture attendue")
  return appel
}
function vidage(appel: Appel | undefined): AppelVider {
  if (!appel || appel.type !== "vider") throw new Error("vidage attendu")
  return appel
}

describe("moteur de coche horodaté (#362)", () => {
  it("(a) écho tardif : l'écho de la coche reçu après la décoche est ignoré", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).resoudre(T1)
    await attendre()
    moteur.poser(A, TOMATES, decoche())
    ecriture(appels[1]).resoudre(T2)
    await attendre()

    moteur.surEvent(A, TOMATES, coche(), T1)

    expect(cochee(TOMATES)).toBe(false)
  })

  it("(a) écho de la coche reçu pendant l'écriture de la décoche : ignoré", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).resoudre(T1)
    await attendre()
    moteur.poser(A, TOMATES, decoche())
    moteur.surEvent(A, TOMATES, coche(), T1) // différé
    ecriture(appels[1]).resoudre(T2)
    await attendre()

    expect(cochee(TOMATES)).toBe(false)
  })

  it("(b) commit concurrent intercalé : la décoche d'un autre membre, plus récente, l'emporte", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.surEvent(A, TOMATES, decoche(), T2) // reçu pendant notre écriture
    expect(cochee(TOMATES)).toBe(true) // différé, le local fait foi
    ecriture(appels[0]).resoudre(T1) // notre commit est antérieur

    await attendre()

    expect(cochee(TOMATES)).toBe(false)
    expect(appels).toHaveLength(1)
  })

  it("commit concurrent antérieur : notre coche, plus récente, l'emporte", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.surEvent(A, TOMATES, decoche(), T0)
    ecriture(appels[0]).resoudre(T1)

    await attendre()

    expect(cochee(TOMATES)).toBe(true)
  })

  it("événement d'un autre membre hors vol, plus récent : appliqué", () => {
    const { moteur, cochee } = monter()
    moteur.hydrater(A, { [TOMATES]: { ...decoche(), maj: T1 } })

    moteur.surEvent(A, TOMATES, coche(), T2)

    expect(cochee(TOMATES)).toBe(true)
  })

  it("événement d'un autre membre hors vol, plus ancien : ignoré", () => {
    const { moteur, cochee } = monter()
    moteur.hydrater(A, { [TOMATES]: { ...coche(), maj: T1 } })

    moteur.surEvent(A, TOMATES, decoche(), T0)

    expect(cochee(TOMATES)).toBe(true)
  })

  it("trois gestes rapides pendant une écriture : deux écritures, la dernière vaut le dernier geste", async () => {
    const { moteur, appels, etats, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.poser(A, TOMATES, decoche())
    moteur.poser(A, TOMATES, coche())
    moteur.poser(A, TOMATES, decoche())
    expect(appels).toHaveLength(1)

    ecriture(appels[0]).resoudre(T1)
    await attendre()
    expect(appels).toHaveLength(2)
    expect(ecriture(appels[1]).etat).toEqual(decoche())
    ecriture(appels[1]).resoudre(T2)
    await attendre()

    expect(appels).toHaveLength(2)
    expect(moteur.enAttente()).toBe(false)
    expect(cochee(TOMATES)).toBe(false)
    expect(etats).toEqual(["sauvegarde", "synchronise"])
  })

  it("échec réseau : hors ligne, opération en file, rejouée dans son ancre d'origine par un nouveau moteur", async () => {
    const stockage = fauxStockage()
    const premier = monter(stockage)
    premier.moteur.hydrater(A, {})
    premier.moteur.poser(A, TOMATES, coche())
    ecriture(premier.appels[0]).rejeter(new Error("Failed to fetch"))
    await attendre()

    expect(premier.etats.at(-1)).toBe("hors-ligne")
    expect(premier.moteur.enAttente()).toBe(true)

    const second = monter(stockage)
    expect(second.moteur.enAttente()).toBe(true)
    second.moteur.hydrater(B, {})
    expect(second.cochee(TOMATES)).toBe(false) // l'op de A ne touche pas la vue de B
    const rejeu = second.moteur.rejouer()
    await attendre()

    const appel = ecriture(second.appels[0])
    expect([appel.ancre, appel.cle, appel.etat]).toEqual([A, TOMATES, coche()])
    appel.resoudre(T1)
    await rejeu
    expect(second.moteur.enAttente()).toBe(false)
    expect(second.etats.at(-1)).toBe("synchronise")
  })

  it("ecrire renvoie null (cible disparue) : file vide, pas de nouvel essai", async () => {
    const { moteur, appels, journal } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).resoudre(null)
    await attendre()

    expect(moteur.enAttente()).toBe(false)
    expect(journal).toHaveBeenCalled()
    await moteur.rejouer()
    expect(appels).toHaveLength(1)
  })

  it("toutDecocher pendant une coche en vol : état final décoché", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.toutDecocher(A)
    expect(cochee(TOMATES)).toBe(false)
    expect(appels).toHaveLength(1) // le vidage attend la fin de la coche

    ecriture(appels[0]).resoudre(T1)
    await attendre()
    vidage(appels[1]).resoudre([{ cle: TOMATES, maj: T2 }])
    await attendre()
    moteur.surEvent(A, TOMATES, coche(), T1) // écho tardif de la coche

    expect(cochee(TOMATES)).toBe(false)
    expect(appels).toHaveLength(2)
    expect(moteur.enAttente()).toBe(false)
  })

  it("hydrater : une clé en file garde le local, les autres prennent le distant (tombstones compris)", async () => {
    const { moteur, appels, vue, cochee } = monter()
    moteur.hydrater(A, {})
    vue.set("perime|g", coche(1)) // reste d'un autre cycle
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).rejeter(new Error("Failed to fetch"))
    await attendre()

    moteur.hydrater(A, {
      [TOMATES]: { ...decoche(), maj: T5 },
      [RIZ]: { ...coche(200), maj: T5 },
      "sel|g": { ...decoche(5), maj: T5 },
    })

    expect(cochee(TOMATES)).toBe(true)
    expect(vue.get(RIZ)).toEqual(coche(200))
    expect(vue.get("sel|g")).toEqual(decoche(5))
    expect(vue.has("perime|g")).toBe(false)

    // Rejeu : notre écriture (T6) est postérieure au distant lu (T5).
    const rejeu = moteur.rejouer()
    await attendre()
    ecriture(appels[1]).resoudre(T6)
    await rejeu
    expect(cochee(TOMATES)).toBe(true)
  })

  it("relecture périmée (ligne plus ancienne) : la coche confirmée et son horodatage restent", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, { [TOMATES]: { ...decoche(), maj: T0 } })
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).resoudre(T1) // commit retenu
    await attendre()
    moteur.surEvent(A, TOMATES, coche(), T1) // notre écho : ignoré

    // Lecture partie avant le commit, livrée après.
    moteur.hydrater(A, { [TOMATES]: { ...decoche(), maj: T0 } })

    expect(cochee(TOMATES)).toBe(true)
    // L'horodatage connu reste T1 : un écho périmé (T0) ne décoche pas…
    moteur.surEvent(A, TOMATES, decoche(), T0)
    expect(cochee(TOMATES)).toBe(true)
    // … un commit plus récent d'un autre membre, si.
    moteur.surEvent(A, TOMATES, decoche(), T2)
    expect(cochee(TOMATES)).toBe(false)
  })

  it("relecture périmée (ligne absente) : la coche confirmée pendant la lecture reste", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    const depuis = moteur.marquerLecture() // lecture partie avant le commit
    ecriture(appels[0]).resoudre(T1)
    await attendre()
    moteur.surEvent(A, TOMATES, coche(), T1) // notre écho : ignoré

    moteur.hydrater(A, {}, depuis) // instantané d'avant la création de la ligne

    expect(cochee(TOMATES)).toBe(true)
  })

  it("« Tout décocher » rejoué, commité pendant une relecture périmée : reste décoché", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, { [TOMATES]: { ...coche(), maj: T0 } })
    moteur.toutDecocher(A)
    vidage(appels[0]).rejeter(new Error("Failed to fetch")) // hors ligne
    await attendre()

    // Retour en ligne : rejeu du vidage, relecture partie avant son commit.
    const rejeu = moteur.rejouer()
    const depuis = moteur.marquerLecture()
    vidage(appels[1]).resoudre([{ cle: TOMATES, maj: T1 }])
    await rejeu
    moteur.surEvent(A, TOMATES, decoche(), T1) // notre écho : ignoré

    moteur.hydrater(A, { [TOMATES]: { ...coche(), maj: T0 } }, depuis) // instantané d'avant

    expect(cochee(TOMATES)).toBe(false)
    // L'horodatage connu reste T1 : un écho périmé de la coche (T0) ne recoche pas.
    moteur.surEvent(A, TOMATES, coche(), T0)
    expect(cochee(TOMATES)).toBe(false)
  })

  // Moteur neuf (rechargement) dont la file rejouée commite pendant la
  // PREMIÈRE lecture de l'ancre : aucune ancre encore affichée.
  async function moteurNeufAvecFile(op: "cle" | "vider") {
    const stockage = fauxStockage()
    const avant = monter(stockage)
    avant.moteur.hydrater(A, {})
    if (op === "cle") avant.moteur.poser(A, TOMATES, coche())
    else avant.moteur.toutDecocher(A)
    avant.appels[0].rejeter(new Error("Failed to fetch"))
    await attendre()
    return monter(stockage)
  }

  it("première hydratation (ligne absente) : la coche rejouée confirmée pendant la lecture reste", async () => {
    const { moteur, appels, cochee } = await moteurNeufAvecFile("cle")
    const rejeu = moteur.rejouer()
    const depuis = moteur.marquerLecture()
    await attendre()
    ecriture(appels[0]).resoudre(T1)
    await rejeu

    moteur.hydrater(A, {}, depuis) // instantané d'avant la création de la ligne

    expect(cochee(TOMATES)).toBe(true)
    moteur.surEvent(A, TOMATES, coche(), T1) // notre écho : ignoré
    expect(cochee(TOMATES)).toBe(true)
  })

  it("première hydratation (ligne plus ancienne) : la coche rejouée confirmée pendant la lecture reste", async () => {
    const { moteur, appels, cochee } = await moteurNeufAvecFile("cle")
    const rejeu = moteur.rejouer()
    const depuis = moteur.marquerLecture()
    await attendre()
    ecriture(appels[0]).resoudre(T1)
    await rejeu

    moteur.hydrater(A, { [TOMATES]: { ...decoche(), maj: T0 } }, depuis)

    expect(cochee(TOMATES)).toBe(true)
    moteur.surEvent(A, TOMATES, decoche(), T0) // écho périmé : ignoré
    expect(cochee(TOMATES)).toBe(true)
  })

  it("première hydratation : « Tout décocher » rejoué, commité pendant la lecture, reste décoché", async () => {
    const { moteur, appels, cochee } = await moteurNeufAvecFile("vider")
    const rejeu = moteur.rejouer()
    const depuis = moteur.marquerLecture()
    await attendre()
    vidage(appels[0]).resoudre([{ cle: TOMATES, maj: T1 }])
    await rejeu

    moteur.hydrater(A, { [TOMATES]: { ...coche(), maj: T0 } }, depuis) // instantané d'avant

    expect(cochee(TOMATES)).toBe(false)
  })

  it("première hydratation : commit AVANT la lecture, ligne absente = purge (le distant fait foi)", async () => {
    const { moteur, appels, cochee } = await moteurNeufAvecFile("cle")
    const rejeu = moteur.rejouer()
    await attendre()
    ecriture(appels[0]).resoudre(T1)
    await rejeu
    const depuis = moteur.marquerLecture()

    moteur.hydrater(A, {}, depuis) // ligne purgée entre-temps

    expect(cochee(TOMATES)).toBe(false)
  })

  it("ligne absente d'une lecture sans confirmation pendant celle-ci : purge (décochée)", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, { [RIZ]: { ...coche(200), maj: T0 } })
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).resoudre(T1) // confirmée AVANT la lecture
    await attendre()
    const depuis = moteur.marquerLecture()

    moteur.hydrater(A, {}, depuis) // lignes purgées entre-temps

    expect(cochee(TOMATES)).toBe(false)
    expect(cochee(RIZ)).toBe(false)
  })

  it("DELETE (purge) : décoche", () => {
    const { moteur, cochee } = monter()
    moteur.hydrater(A, { [TOMATES]: { ...coche(), maj: T1 } })
    expect(cochee(TOMATES)).toBe(true)

    moteur.surEvent(A, TOMATES, null, null)

    expect(cochee(TOMATES)).toBe(false)
  })

  it("après un échec, un nouveau geste relance le flush (file entière, dans l'ordre)", async () => {
    const { moteur, appels, etats } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).rejeter(new Error("Failed to fetch"))
    await attendre()
    expect(etats.at(-1)).toBe("hors-ligne")

    moteur.poser(A, RIZ, coche(200))
    expect(ecriture(appels[1]).cle).toBe(TOMATES)
    ecriture(appels[1]).resoudre(T1)
    await attendre()
    expect(ecriture(appels[2]).cle).toBe(RIZ)
    ecriture(appels[2]).resoudre(T2)
    await attendre()

    expect(moteur.enAttente()).toBe(false)
    expect(etats.at(-1)).toBe("synchronise")
  })

  it("un geste posé juste après la dernière réponse d'un flush part bien", async () => {
    const { moteur, appels } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())

    ecriture(appels[0]).resoudre(T1)
    queueMicrotask(() => moteur.poser(A, RIZ, coche(200)))
    await attendre()

    expect(appels).toHaveLength(2)
    expect(ecriture(appels[1]).cle).toBe(RIZ)
  })

  it("un transport qui lève de façon synchrone ne bloque pas le flush suivant", async () => {
    const stockage = fauxStockage()
    let lever = true
    const ecrits: string[] = []
    const moteur = creerMoteurCoches<number>({
      nom: "coches_test",
      transport: {
        ecrire(_ancre, cle) {
          if (lever) throw new Error("client indisponible")
          ecrits.push(cle)
          return Promise.resolve(T1)
        },
        vider: () => Promise.resolve([]),
      },
      vue: { appliquer: () => {}, vider: () => {} },
      stockage,
      surEtat: () => {},
      journal: () => {},
    })
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    await attendre()
    lever = false

    await moteur.rejouer()

    expect(ecrits).toEqual([TOMATES])
    expect(moteur.enAttente()).toBe(false)
  })

  it("stockage corrompu : journalisé, effacé, le moteur démarre vide", () => {
    const stockage = fauxStockage()
    stockage.ecrire("coches_test_en_attente", "{pas du json")
    stockage.ecrire("coches_test_maj", "[")
    const { moteur, journal } = monter(stockage)

    expect(moteur.enAttente()).toBe(false)
    expect(journal).toHaveBeenCalledTimes(2)
    expect(stockage.donnees.has("coches_test_en_attente")).toBe(false)
    expect(stockage.donnees.has("coches_test_maj")).toBe(false)
  })

  it("stockage de forme invalide : journalisé, effacé", () => {
    const stockage = fauxStockage()
    stockage.ecrire("coches_test_en_attente", JSON.stringify([{ id: "x" }]))
    stockage.ecrire("coches_test_maj", JSON.stringify([1, 2]))
    const { moteur, journal } = monter(stockage)

    expect(moteur.enAttente()).toBe(false)
    expect(journal).toHaveBeenCalledTimes(2)
    expect(stockage.donnees.has("coches_test_en_attente")).toBe(false)
    expect(stockage.donnees.has("coches_test_maj")).toBe(false)
  })

  it("règle 4 : un différé est jeté si un nouveau geste est en file sur sa clé", async () => {
    const { moteur, appels, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.surEvent(A, TOMATES, coche(), T5) // différé (écriture en vol)
    moteur.poser(A, TOMATES, decoche()) // nouveau geste en file
    ecriture(appels[0]).resoudre(T1)
    await attendre()
    // Réponse volontairement plus ancienne que le différé : s'il était
    // gardé, il serait appliqué ici et recocherait.
    ecriture(appels[1]).resoudre(T2)
    await attendre()

    expect(cochee(TOMATES)).toBe(false)
    expect(appels).toHaveLength(2)
  })

  it("file [k1, k2] puis « Tout décocher » : seul le vidage part après l'écriture en vol", async () => {
    const { moteur, appels } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.poser(A, RIZ, coche(200))
    moteur.toutDecocher(A)
    expect(appels).toHaveLength(1)

    ecriture(appels[0]).resoudre(T1)
    await attendre()
    vidage(appels[1]).resoudre([{ cle: TOMATES, maj: T2 }])
    await attendre()

    expect(appels).toHaveLength(2)
    expect(moteur.enAttente()).toBe(false)
  })

  it("DELETE sur une clé en file : vue inchangée", () => {
    const { moteur, cochee } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, RIZ, coche(200)) // en vol

    moteur.surEvent(A, RIZ, null, null)

    expect(cochee(RIZ)).toBe(true)
  })

  it("hydrater(B) pendant l'écriture de A : vue de B intacte, horodatage de A retenu et persisté", async () => {
    const { moteur, appels, vue, stockage } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.hydrater(B, { [RIZ]: { ...coche(200), maj: T0 } })

    ecriture(appels[0]).resoudre(T1)
    await attendre()

    expect(vue.get(RIZ)).toEqual(coche(200))
    expect(vue.has(TOMATES)).toBe(false)
    const majs = JSON.parse(stockage.lire("coches_test_maj") ?? "{}")
    expect(majs[A]?.[TOMATES]).toBe(T1)
  })

  it("échec définitif (estDefinitive) : opération retirée et journalisée, la file continue", async () => {
    const definitive = Object.assign(new Error("RLS"), { definitive: true })
    const { moteur, appels, journal, etats } = monter(fauxStockage(), {
      estDefinitive: (e) => (e as { definitive?: boolean }).definitive === true,
    })
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.poser(A, RIZ, coche(200))

    ecriture(appels[0]).rejeter(definitive)
    await attendre()

    expect(journal).toHaveBeenCalledWith(expect.stringContaining("refusée"), definitive)
    expect(ecriture(appels[1]).cle).toBe(RIZ)
    ecriture(appels[1]).resoudre(T1)
    await attendre()
    expect(moteur.enAttente()).toBe(false)
    expect(etats).not.toContain("hors-ligne")
  })

  it("échec transitoire avec estDefinitive faux : reste en file, hors ligne", async () => {
    const { moteur, appels, etats } = monter(fauxStockage(), { estDefinitive: () => false })
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).rejeter(new Error("Failed to fetch"))
    await attendre()

    expect(moteur.enAttente()).toBe(true)
    expect(etats.at(-1)).toBe("hors-ligne")
  })

  it("ré-entrance : un geste posé depuis surEtat ne lance jamais deux écritures en vol", async () => {
    let moteurRef: MoteurCoches<number> | null = null
    let fait = false
    const { moteur, appels } = monter(fauxStockage(), {
      surEtat: (etat) => {
        if (etat === "synchronise" && !fait) {
          fait = true
          moteurRef?.poser(A, RIZ, coche(200))
        }
      },
    })
    moteurRef = moteur
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).resoudre(T1)
    await attendre()
    expect(ecriture(appels[1]).cle).toBe(RIZ) // en vol

    moteur.poser(A, "sel|g", coche(5))

    expect(appels).toHaveLength(2) // « sel » attend la fin de RIZ
    ecriture(appels[1]).resoudre(T2)
    await attendre()
    expect(ecriture(appels[2]).cle).toBe("sel|g")
  })

  it("enAttente(ancre) : ne compte que les opérations de cette ancre", async () => {
    const { moteur, appels } = monter()
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    ecriture(appels[0]).rejeter(new Error("Failed to fetch"))
    await attendre()

    expect(moteur.enAttente()).toBe(true)
    expect(moteur.enAttente(A)).toBe(true)
    expect(moteur.enAttente(B)).toBe(false)
  })

  it("arreter : un flush en vol termine sans rien écrire (stockage, vue, état) ni continuer", async () => {
    const stockage = fauxStockage()
    const { moteur, appels, vue, etats } = monter(stockage)
    moteur.hydrater(A, {})
    moteur.poser(A, TOMATES, coche())
    moteur.poser(A, RIZ, coche(200))
    moteur.surEvent(A, TOMATES, decoche(), T5) // différé
    moteur.arreter()
    stockage.donnees.clear() // purge de l'appelant (changement de foyer)
    vue.clear()
    const etatsAvant = etats.length

    ecriture(appels[0]).resoudre(T1)
    await attendre()

    expect(appels).toHaveLength(1)
    expect(stockage.donnees.size).toBe(0)
    expect(vue.size).toBe(0)
    expect(etats).toHaveLength(etatsAvant)
    moteur.poser(A, "sel|g", coche(5))
    moteur.surEvent(A, RIZ, decoche(), T6)
    expect(appels).toHaveLength(1)
    expect(stockage.donnees.size).toBe(0)
    expect(vue.size).toBe(0)
  })
})
