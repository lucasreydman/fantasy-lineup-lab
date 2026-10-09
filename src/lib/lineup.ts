/** Which player positions each Sleeper roster slot accepts. */
export const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'],
}

export const SLOT_LABEL: Record<string, string> = {
  FLEX: 'FLEX',
  WRRB_FLEX: 'W/R',
  REC_FLEX: 'W/T',
  SUPER_FLEX: 'SF',
  IDP_FLEX: 'IDP',
}

const NON_STARTER = new Set(['BN', 'IR', 'TAXI'])

export function starterSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((s) => !NON_STARTER.has(s))
}

/** Active roster limit: starters + bench (IR and taxi have their own slots). */
export function rosterLimit(rosterPositions: string[]): number {
  return rosterPositions.filter((s) => s !== 'IR' && s !== 'TAXI').length
}

export function slotAccepts(slot: string, positions: string[]): boolean {
  const ok = SLOT_ELIGIBILITY[slot]
  return !!ok && positions.some((p) => ok.includes(p))
}

export interface LineupCandidate {
  id: string
  positions: string[]
  points: number
}

export interface LineupSlot {
  slot: string
  playerId: string | null
  points: number
}

export interface Lineup {
  slots: LineupSlot[]
  bench: string[]
  total: number
}

const BENCH_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
const benchRank = (positions: string[]) => {
  const i = BENCH_ORDER.indexOf(positions[0])
  return i < 0 ? BENCH_ORDER.length : i
}

/** Bonus per filled slot so the solver fills every slot it can before maximizing points. */
const FILL_BONUS = 1000
const INELIGIBLE = 1e9

/**
 * Optimal lineup = max-weight bipartite matching of slots to players, solved
 * exactly with the Hungarian algorithm (rosters are tiny, so O(n^3) is free).
 * Greedy fill breaks with overlapping flexes (W/R + W/T + SF), this does not.
 */
export function optimizeLineup(slots: string[], players: LineupCandidate[]): Lineup {
  const n = slots.length
  if (n === 0) return { slots: [], bench: players.map((p) => p.id), total: 0 }

  // Columns: real players, then one "empty" dummy per slot (always eligible, no bonus).
  const m = players.length + n
  const cost: number[][] = slots.map((slot) => {
    const row = new Array<number>(m)
    for (let j = 0; j < players.length; j++) {
      const p = players[j]
      row[j] = slotAccepts(slot, p.positions) ? -(p.points + FILL_BONUS) : INELIGIBLE
    }
    for (let j = players.length; j < m; j++) row[j] = 0
    return row
  })

  const assign = hungarian(cost)
  const used = new Set<number>()
  const out: LineupSlot[] = slots.map((slot, i) => {
    const j = assign[i]
    if (j < players.length) {
      used.add(j)
      return { slot, playerId: players[j].id, points: players[j].points }
    }
    return { slot, playerId: null, points: 0 }
  })

  // Within identical slot types, show the higher projection first (RB1 above RB2).
  const bySlot = new Map<string, number[]>()
  out.forEach((s, i) => bySlot.set(s.slot, [...(bySlot.get(s.slot) ?? []), i]))
  for (const idxs of bySlot.values()) {
    const sorted = idxs.map((i) => out[i]).sort((a, b) => b.points - a.points)
    idxs.forEach((i, k) => (out[i] = sorted[k]))
  }

  // Bench reads like Sleeper's: QB, RB, WR, TE, K, DEF, then IDP; best projection first within each.
  const bench = players
    .filter((_, j) => !used.has(j))
    .sort((a, b) => benchRank(a.positions) - benchRank(b.positions) || b.points - a.points)
    .map((p) => p.id)
  const total = Math.round(out.reduce((s, x) => s + x.points, 0) * 100) / 100
  return { slots: out, bench, total }
}

/** Min-cost assignment for an n x m matrix (n <= m). Returns column index per row. */
function hungarian(a: number[][]): number[] {
  const n = a.length
  const m = a[0].length
  const u = new Array<number>(n + 1).fill(0)
  const v = new Array<number>(m + 1).fill(0)
  const p = new Array<number>(m + 1).fill(0)
  const way = new Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(m + 1).fill(Infinity)
    const used = new Array<boolean>(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const ans = new Array<number>(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1
  return ans
}

/**
 * Whether an injury designation can go in this league's IR slots. IR and PUP always
 * can; the rest are commissioner switches (`reserve_allow_out` and friends). Reads the
 * injury designation, never Sleeper's roster `status`, which is team membership.
 */
export function irEligible(injury: string | null | undefined, settings: Record<string, unknown>): boolean {
  switch (injury) {
    case 'IR':
    case 'PUP':
      return true
    case 'Out':
      return settings.reserve_allow_out === 1
    case 'Doubtful':
      return settings.reserve_allow_doubtful === 1
    case 'Sus':
      return settings.reserve_allow_sus === 1
    case 'COV':
      return settings.reserve_allow_cov === 1
    case 'NA':
      return settings.reserve_allow_na === 1
    case 'DNR':
      return settings.reserve_allow_dnr === 1
    default:
      return false
  }
}
