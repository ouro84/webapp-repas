// Moteur de coche générique, horodaté (#362 phase 2, RG-10, RG-32, RG-41).
//
// Un seul moteur pour les deux sortes de coches de /courses : ingrédients
// dérivés (`etat_courses_article`, clé `nom|unité`, valeur = quantité) et
// articles manuels (`article_manuel`, clé = id). Le transport, la vue et le
// stockage sont injectés : ni React, ni Supabase, ni `lib/sync.ts` ici.
//
// Arbitrage : DERNIER COMMIT GAGNANT sur `updated_at` (posé par trigger,
// comparé à la microseconde via `cleHorodatage`). Pourquoi : sans horodatage,
// rien ne distinguait l'écho tardif de notre coche d'une coche réelle d'un
// autre membre (limite (a)), ni ne permettait de trancher un commit concurrent
// reçu pendant notre écriture (limite (b)) ; cf. `.claude/rules/sync-planning.md`.
//
// Règles (cf. spec docs/superpowers/specs/2026-11-06-362-phase2-moteur-coches.md) :
// 1. File persistée (RG-12, persistance et invalidation des coches) : au plus
//    une opération par (ancre, clé), le dernier geste remplace ; plus des
//    opérations `vider(ancre)`, qui effacent les opérations de clé
//    antérieures de la même ancre.
// 2. Flush séquentiel, dans l'ordre de la file : jamais deux écritures en vol
//    (donc jamais deux sur une même clé). À la réponse, l'horodatage connu de
//    la clé devient le `maj` renvoyé, puis les événements différés sont jugés.
// 3. Événement : ignoré si `maj` ≤ horodatage connu (écho ou périmé) ; différé
//    si la clé a une opération en file (en vol compris) ; sinon appliqué.
//    DELETE (purge) : décoche si rien n'est en file pour la clé, sinon ignoré.
// 4. Différé jugé quand sa clé n'est plus occupée : appliqué s'il est plus
//    récent que l'horodatage connu (renvoyé par notre écriture) ; jeté si un
//    nouveau geste est en file sur la clé (il sera commité après lui).
// 5. Échec d'écriture : l'opération reste en file, « hors-ligne », arrêt du
//    flush, aucun rejet vers l'appelant ; un geste ou `rejouer()` le relance.
//    `null` du transport (cible disparue) : opération retirée et journalisée.
// 6. Relecture périmée (`hydrater`) : une lecture partie avant un commit peut
//    revenir après lui (et après son écho, déjà ignoré). Pour une clé hors
//    file de l'ancre affichée, l'état affiché et son horodatage connu sont
//    GARDÉS (le distant est jeté) si :
//    - la ligne lue porte un horodatage strictement plus ancien que l'horodatage
//      connu (l'ordre des commits suffit : le distant est un état dépassé) ;
//    - ou la ligne est ABSENTE de la lecture et la clé a été confirmée (réponse
//      d'écriture ou événement appliqué) APRÈS le début de la lecture, marqué
//      par `marquerLecture()` et passé en `depuis` (la ligne n'existait pas
//      encore à l'instantané).
//    Sinon le distant fait foi, et une ligne absente vaut purge (sémantique du
//    DELETE : décochée), y compris pour une clé confirmée AVANT la lecture.
//    Sans hydratation préalable de cette ancre (premier chargement, autre
//    ancre), le distant fait foi. Une clé de l'ancre affichée qui a un
//    horodatage connu mais plus d'état affiché sort d'un « Tout décocher »
//    (rejoué ou non) : son état gardé est « décoché ». Pourquoi : sans cette règle, une coche rejouée au retour en ligne,
//    commitée pendant la relecture du cycle, restait décochée à l'écran (base
//    cochée, indicateur « synchronise ») jusqu'à la lecture suivante.

import { cleHorodatage } from "@/lib/horodatage"

export type Etat<V> = { coche: boolean; valeur: V }

export type TransportCoches<V> = {
  /** `updated_at` de la ligne écrite ; `null` = cible disparue → opération abandonnée. */
  ecrire(ancre: string, cle: string, etat: Etat<V>): Promise<string | null>
  /** Décoche toute l'ancre ; renvoie les lignes modifiées et leur `updated_at`. */
  vider(ancre: string): Promise<Array<{ cle: string; maj: string }>>
}

/** Écrit la vue sans repasser par le moteur. */
export type VueCoches<V> = { appliquer(cle: string, etat: Etat<V>): void; vider(): void }

export type StockageCoches = {
  lire(cle: string): string | null
  ecrire(cle: string, valeur: string): void
  effacer(cle: string): void
}

export type MoteurCoches<V> = {
  /** Geste local : vue (sauf `vueDejaAJour`), file, flush. */
  poser(ancre: string, cle: string, etat: Etat<V>, options?: { vueDejaAJour?: boolean }): void
  /** « Tout décocher » (RG-13, RG-41) : vue vidée, file, flush. */
  toutDecocher(ancre: string): void
  /** Événement temps réel ; `etat === null` = DELETE (purge). */
  surEvent(ancre: string, cle: string, etat: Etat<V> | null, maj: string | null): void
  /** Charge l'état distant de l'ancre affichée ; dirty-first : une clé en file
   *  garde le local, une clé confirmée plus récemment que la lecture aussi
   *  (règle 6). `depuis` = valeur de `marquerLecture()` prise avant la lecture. */
  hydrater(
    ancre: string,
    distant: Record<string, Etat<V> & { maj: string }>,
    depuis?: number
  ): void
  /** Marque le début d'une lecture distante ; à repasser à `hydrater`. */
  marquerLecture(): number
  /** Rejoue la file hors ligne (retour réseau, montage). Ne rejette jamais. */
  rejouer(): Promise<void>
  enAttente(): boolean
}

type Operation<V> =
  | { id: number; type: "cle"; ancre: string; cle: string; etat: Etat<V> }
  | { id: number; type: "vider"; ancre: string }

type EventDiffere<V> = { etat: Etat<V>; maj: string; micro: number }

export function creerMoteurCoches<V>(deps: {
  /** Préfixe des clés de stockage : `${nom}_maj`, `${nom}_en_attente`. */
  nom: string
  transport: TransportCoches<V>
  vue: VueCoches<V>
  stockage: StockageCoches
  surEtat: (etat: "sauvegarde" | "synchronise" | "hors-ligne") => void
  journal?: (message: string, erreur?: unknown) => void
}): MoteurCoches<V> {
  const { nom, transport, vue, stockage, surEtat } = deps
  const journal = deps.journal ?? ((message, erreur) => console.error(message, erreur))
  const CLE_MAJ = `${nom}_maj`
  const CLE_FILE = `${nom}_en_attente`

  // File des opérations à pousser ; l'opération en vol y reste jusqu'à sa
  // réponse (un échec la laisse en place pour le rejeu).
  let file: Operation<V>[] = lireFile()
  let prochainId = file.reduce((max, op) => Math.max(max, op.id), 0) + 1
  // Horodatage connu par ancre puis par clé (dernier commit vu pour la clé).
  const majConnues: Map<string, Map<string, string>> = lireMaj()
  // Ancre affichée (posée par `hydrater`) : seuls ses événements touchent la vue.
  let ancreAffichee: string | null = null
  // État affiché par clé, tel que le moteur l'a écrit (sert au DELETE, qui
  // n'apporte pas de valeur). Réinitialisé à chaque `hydrater`.
  const affichees = new Map<string, Etat<V>>()
  // Événements différés de l'ancre affichée : le plus récent par clé suffit.
  const differes = new Map<string, EventDiffere<V>>()
  let flushActif = false
  let flushEnCours: Promise<void> | null = null
  // Confirmations (réponse d'écriture, événement appliqué) numérotées, par
  // ancre puis par clé : une clé confirmée après `marquerLecture()` n'est pas
  // purgée par une lecture qui ne la contient pas (règle 6). En mémoire seule :
  // une lecture ne survit pas à un rechargement.
  let sequenceConfirmations = 0
  const confirmations = new Map<string, Map<string, number>>()

  // --- Stockage --------------------------------------------------------------

  function lireJSON(cle: string): unknown {
    let brut: string | null
    try {
      brut = stockage.lire(cle)
    } catch (erreur) {
      journal(`Stockage des coches illisible ("${cle}").`, erreur)
      return null
    }
    if (brut === null) return null
    try {
      return JSON.parse(brut)
    } catch (erreur) {
      journal(`Stockage des coches corrompu ("${cle}"), repart vide.`, erreur)
      return null
    }
  }

  function lireFile(): Operation<V>[] {
    const brut = lireJSON(CLE_FILE)
    if (brut === null) return []
    if (!Array.isArray(brut) || !brut.every(estOperation)) {
      journal(`Stockage des coches invalide ("${CLE_FILE}"), repart vide.`)
      return []
    }
    return brut as Operation<V>[]
  }

  function lireMaj(): Map<string, Map<string, string>> {
    const brut = lireJSON(CLE_MAJ)
    const resultat = new Map<string, Map<string, string>>()
    if (brut === null) return resultat
    if (typeof brut !== "object" || Array.isArray(brut)) {
      journal(`Stockage des coches invalide ("${CLE_MAJ}"), repart vide.`)
      return resultat
    }
    for (const [ancre, parCle] of Object.entries(brut as Record<string, unknown>)) {
      if (typeof parCle !== "object" || parCle === null) continue
      const cles = new Map<string, string>()
      for (const [cle, maj] of Object.entries(parCle as Record<string, unknown>)) {
        if (typeof maj === "string") cles.set(cle, maj)
      }
      resultat.set(ancre, cles)
    }
    return resultat
  }

  function ecrireJSON(cle: string, valeur: unknown, vide: boolean): void {
    try {
      if (vide) stockage.effacer(cle)
      else stockage.ecrire(cle, JSON.stringify(valeur))
    } catch (erreur) {
      journal(`Écriture du stockage des coches échouée ("${cle}").`, erreur)
    }
  }

  function persisterFile(): void {
    ecrireJSON(CLE_FILE, file, file.length === 0)
  }

  function persisterMaj(): void {
    const objet: Record<string, Record<string, string>> = {}
    for (const [ancre, cles] of majConnues) {
      if (cles.size > 0) objet[ancre] = Object.fromEntries(cles)
    }
    ecrireJSON(CLE_MAJ, objet, Object.keys(objet).length === 0)
  }

  // --- Horodatages -----------------------------------------------------------

  function majConnue(ancre: string, cle: string): number | null {
    return cleHorodatage(majConnues.get(ancre)?.get(cle))
  }

  function confirmer(ancre: string, cle: string): void {
    let cles = confirmations.get(ancre)
    if (!cles) confirmations.set(ancre, (cles = new Map()))
    cles.set(cle, ++sequenceConfirmations)
  }

  // Retient `maj` s'il est plus récent que l'horodatage connu de la clé.
  function retenirMaj(ancre: string, cle: string, maj: string): void {
    const micro = cleHorodatage(maj)
    if (micro === null) return
    const connue = majConnue(ancre, cle)
    if (connue !== null && connue >= micro) return
    let cles = majConnues.get(ancre)
    if (!cles) majConnues.set(ancre, (cles = new Map()))
    cles.set(cle, maj)
  }

  // --- File ------------------------------------------------------------------

  // Une clé est occupée tant qu'une opération de la file la couvre (son
  // écriture, en vol ou non, ou un vidage de son ancre).
  function estOccupee(ancre: string, cle: string): boolean {
    return file.some((op) => couvre(op, ancre, cle))
  }

  // --- Vue -------------------------------------------------------------------

  function afficher(cle: string, etat: Etat<V>): void {
    affichees.set(cle, etat)
    vue.appliquer(cle, etat)
  }

  // Juge les événements différés de l'ancre affichée après une opération
  // terminée (succès ou cible disparue). Clé encore occupée : jeté si
  // l'opération terminée la couvrait (un nouveau geste sera commité après
  // lui), gardé sinon. Clé libre : appliqué s'il est plus récent que
  // l'horodatage connu.
  function jugerDifferes(terminee: Operation<V>): void {
    if (terminee.ancre !== ancreAffichee) return
    for (const [cle, event] of [...differes]) {
      if (estOccupee(terminee.ancre, cle)) {
        if (couvre(terminee, terminee.ancre, cle)) differes.delete(cle)
        continue
      }
      differes.delete(cle)
      const connue = majConnue(terminee.ancre, cle)
      if (connue !== null && event.micro <= connue) continue
      afficher(cle, event.etat)
      retenirMaj(terminee.ancre, cle, event.maj)
      confirmer(terminee.ancre, cle)
    }
    persisterMaj()
  }

  // --- Flush -----------------------------------------------------------------

  // Le flush est marqué terminé DANS la boucle, de façon synchrone, avant
  // d'annoncer « synchronise » / « hors-ligne ». Pourquoi : levé dans un
  // `finally` d'une fonction appelante, il ne l'était qu'une microtâche plus
  // tard ; un geste posé entre-temps rejoignait le flush fini et restait en
  // file, sans envoi, sous l'indicateur « synchronise ».
  function terminerFlush(): void {
    flushActif = false
    flushEnCours = null
  }

  async function flusher(): Promise<void> {
    flushActif = true
    try {
      surEtat("sauvegarde")
      while (file.length > 0) {
        const op = file[0]
        let lignes: Array<{ cle: string; maj: string }> | null
        try {
          if (op.type === "cle") {
            const maj = await transport.ecrire(op.ancre, op.cle, op.etat)
            lignes = maj === null ? null : [{ cle: op.cle, maj }]
          } else {
            lignes = await transport.vider(op.ancre)
          }
        } catch (erreur) {
          terminerFlush()
          surEtat("hors-ligne")
          journal("Synchronisation des coches échouée (sera rejouée).", erreur)
          return
        }
        // Retrait par identité : un geste arrivé pendant le vol a pu remplacer
        // cette opération (il reste en file) ou un vidage l'effacer.
        file = file.filter((o) => o.id !== op.id)
        persisterFile()
        if (lignes === null) {
          journal(
            `Coche abandonnée : cible disparue (ancre ${op.ancre}, clé ${op.type === "cle" ? op.cle : "*"}).`
          )
        } else {
          for (const { cle, maj } of lignes) {
            retenirMaj(op.ancre, cle, maj)
            confirmer(op.ancre, cle)
          }
        }
        jugerDifferes(op)
      }
      terminerFlush()
      surEtat("synchronise")
    } finally {
      // Filet pour une exception inattendue (vue, `surEtat`) : sans lui, le
      // moteur se croirait en flush pour toujours. Synchrone lui aussi.
      if (flushActif) terminerFlush()
    }
  }

  function lancerFlush(): Promise<void> {
    // Pendant la partie synchrone du premier tour (avant le premier `await`),
    // `flushEnCours` n'est pas encore posé : l'op ajoutée est prise par la
    // boucle en cours.
    if (flushActif) return flushEnCours ?? Promise.resolve()
    if (file.length === 0) return Promise.resolve()
    const flush = flusher()
    // Un flush fini de façon synchrone (transport qui lève sans attendre) a
    // déjà appelé `terminerFlush` : ne pas le mémoriser comme en cours.
    if (flushActif) flushEnCours = flush
    return flush
  }

  // --- API -------------------------------------------------------------------

  return {
    poser(ancre, cle, etat, options) {
      if (options?.vueDejaAJour) affichees.set(cle, etat)
      else afficher(cle, etat)
      file = file.filter((op) => !(op.type === "cle" && op.ancre === ancre && op.cle === cle))
      file.push({ id: prochainId++, type: "cle", ancre, cle, etat })
      persisterFile()
      void lancerFlush()
    },

    toutDecocher(ancre) {
      affichees.clear()
      vue.vider()
      // Un vidage efface les opérations antérieures de son ancre (règle 1).
      // Celle en vol finit son écriture ; le vidage part après elle.
      file = file.filter((op) => op.ancre !== ancre)
      file.push({ id: prochainId++, type: "vider", ancre })
      persisterFile()
      void lancerFlush()
    },

    surEvent(ancre, cle, etat, maj) {
      if (ancreAffichee === null || ancre !== ancreAffichee) return
      if (etat === null) {
        // DELETE : purge (vieux cycle, compte, foyer), sans horodatage.
        if (estOccupee(ancre, cle)) return
        majConnues.get(ancre)?.delete(cle)
        confirmations.get(ancre)?.delete(cle)
        persisterMaj()
        const affichee = affichees.get(cle)
        if (affichee?.coche) afficher(cle, { coche: false, valeur: affichee.valeur })
        return
      }
      const micro = cleHorodatage(maj)
      if (maj === null || micro === null) {
        journal(`Événement de coche sans horodatage lisible ignoré (clé ${cle}).`)
        return
      }
      const connue = majConnue(ancre, cle)
      if (connue !== null && micro <= connue) return // écho ou périmé
      if (estOccupee(ancre, cle)) {
        const dejaDiffere = differes.get(cle)
        if (!dejaDiffere || micro > dejaDiffere.micro) differes.set(cle, { etat, maj, micro })
        return
      }
      afficher(cle, etat)
      retenirMaj(ancre, cle, maj)
      confirmer(ancre, cle)
      persisterMaj()
    },

    hydrater(ancre, distant, depuis) {
      // État affiché avant la lecture (règle 6) : seulement s'il est celui de
      // cette ancre.
      const memeAncre = ancreAffichee === ancre
      const precedentes = memeAncre ? new Map(affichees) : new Map<string, Etat<V>>()
      ancreAffichee = ancre
      differes.clear()
      affichees.clear()
      vue.vider()
      // Horodatages : ceux de l'ancre affichée sont relus ; on ne garde des
      // autres ancres que celles qui ont encore des opérations à rejouer.
      const anciennes = majConnues.get(ancre) ?? new Map<string, string>()
      for (const autre of [...majConnues.keys()]) {
        if (autre !== ancre && !file.some((op) => op.ancre === autre)) majConnues.delete(autre)
      }
      for (const autre of [...confirmations.keys()]) {
        if (autre !== ancre) confirmations.delete(autre)
      }
      const confirmees = confirmations.get(ancre)
      // Clés hors file dont la lecture est périmée (règle 6) : état gardé
      // (`null` = rien à afficher, la vue vidée est déjà décochée).
      const gardees = new Map<string, Etat<V> | null>()
      for (const [cle, maj] of anciennes) {
        if (!memeAncre || estOccupee(ancre, cle)) continue
        const connue = cleHorodatage(maj)
        const lue = distant[cle]
        const perimee =
          lue !== undefined
            ? connue !== null && (cleHorodatage(lue.maj) ?? Infinity) < connue
            : depuis !== undefined && (confirmees?.get(cle) ?? 0) > depuis
        if (!perimee) continue
        // Horodatage connu sans état affiché, sur l'ancre affichée : seul un
        // « Tout décocher » (qui vide `affichees`) y mène ; l'état est décoché.
        const precedente =
          precedentes.get(cle) ?? (lue ? { coche: false, valeur: lue.valeur } : null)
        gardees.set(cle, precedente)
      }
      const nouvelles = new Map<string, string>()
      for (const [cle, maj] of anciennes) {
        if (estOccupee(ancre, cle) || gardees.has(cle)) nouvelles.set(cle, maj)
      }
      majConnues.set(ancre, nouvelles)
      for (const [cle, etat] of gardees) if (etat) afficher(cle, etat)
      for (const [cle, { maj, ...etat }] of Object.entries(distant)) {
        if (gardees.has(cle)) continue
        if (estOccupee(ancre, cle)) {
          // Dirty-first : le local fait foi ; le distant est jugé à la fin
          // de l'écriture, comme un événement reçu pendant le vol.
          const micro = cleHorodatage(maj)
          if (micro !== null) differes.set(cle, { etat, maj, micro })
          continue
        }
        afficher(cle, etat)
        retenirMaj(ancre, cle, maj)
      }
      // Gestes en file de cette ancre (après tout vidage, règle 1) : rejoués
      // sur la vue.
      for (const op of file) {
        if (op.ancre === ancre && op.type === "cle") afficher(op.cle, op.etat)
      }
      persisterMaj()
    },

    rejouer() {
      return lancerFlush()
    },

    marquerLecture() {
      return sequenceConfirmations
    },

    enAttente() {
      return file.length > 0
    },
  }
}

function couvre<V>(op: Operation<V>, ancre: string, cle: string): boolean {
  return op.ancre === ancre && (op.type === "vider" || op.cle === cle)
}

function estOperation(valeur: unknown): boolean {
  if (typeof valeur !== "object" || valeur === null) return false
  const op = valeur as Record<string, unknown>
  if (typeof op.id !== "number" || typeof op.ancre !== "string") return false
  if (op.type === "vider") return true
  return (
    op.type === "cle" &&
    typeof op.cle === "string" &&
    typeof op.etat === "object" &&
    op.etat !== null &&
    typeof (op.etat as Record<string, unknown>).coche === "boolean"
  )
}
