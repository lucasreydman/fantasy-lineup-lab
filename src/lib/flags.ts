import type { PointsFn } from './scoring'
import type { Player, PlayerProjections } from './types'

/** danger = can't help you right now; warn = a real risk; info = good to know. */
export type FlagLevel = 'danger' | 'warn' | 'info'

export interface Flag {
  level: FlagLevel
  label: string
  detail?: string
}

const INJURY: Record<string, { level: FlagLevel; label: string }> = {
  IR: { level: 'danger', label: 'On injured reserve' },
  PUP: { level: 'danger', label: 'On the PUP list' },
  Out: { level: 'danger', label: 'Ruled out' },
  Doubtful: { level: 'danger', label: 'Doubtful' },
  Questionable: { level: 'warn', label: 'Questionable' },
  Sus: { level: 'danger', label: 'Suspended' },
  NA: { level: 'danger', label: 'Not with the team' },
  DNR: { level: 'danger', label: 'Did not report' },
  COV: { level: 'danger', label: 'COVID list' },
}

const RANK: Record<FlagLevel, number> = { danger: 0, warn: 1, info: 2 }
const NEWS_WINDOW_MS = 3 * 24 * 3600 * 1000

function since(date: string | null) {
  if (!date) return null
  const d = new Date(`${date}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : `since ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/**
 * Everything worth knowing about a player before he joins (or leaves) a roster:
 * injury designation and detail, practice report, roster status, being off an NFL
 * team, an upcoming bye, and a season that's projected to be over.
 */
export function playerFlags(
  p: Player | undefined,
  opts: { currentWeek: number; rosWeeks: number[]; points: PointsFn; proj: PlayerProjections | undefined; now?: number },
): Flag[] {
  if (!p) return []
  const flags: Flag[] = []
  const now = opts.now ?? Date.now()

  if (!p.team && p.pos !== 'DEF') flags.push({ level: 'danger', label: 'Not on an NFL team', detail: 'Released or unsigned' })

  const inj = p.injury ? INJURY[p.injury] ?? { level: 'warn' as const, label: p.injury } : null
  if (inj) {
    const detail = [p.bodyPart, p.injuryNotes, since(p.injuryStart)].filter(Boolean).join(' · ')
    flags.push({ ...inj, detail: detail || undefined })
  } else if (p.status && p.status !== 'Active' && p.team && p.pos !== 'DEF') {
    // Roster status without an injury tag: practice squad, inactive, etc.
    flags.push({ level: 'warn', label: p.status })
  }

  const prac = (p.practice ?? '').toLowerCase()
  if (/did not|dnp|^out/.test(prac)) flags.push({ level: 'warn', label: 'Did not practice', detail: p.practiceNote ?? undefined })
  else if (/limited/.test(prac)) flags.push({ level: 'info', label: 'Limited in practice', detail: p.practiceNote ?? undefined })

  if (opts.proj) {
    if (opts.proj[opts.currentWeek] === null) flags.push({ level: 'warn', label: `On bye in Week ${opts.currentWeek}` })
    else {
      const bye = [1, 2, 3].map((d) => opts.currentWeek + d).find((w) => opts.proj![w] === null)
      if (bye) flags.push({ level: 'info', label: `Bye in Week ${bye}` })
    }
    const ros = opts.rosWeeks.reduce((s, w) => s + opts.points(p.id, w), 0)
    // An IR or Out tag already explains a zero; only flag it when nothing else does.
    if (ros <= 0 && inj?.level !== 'danger')
      flags.push({ level: 'danger', label: 'Projected for 0 points the rest of the season' })
  }

  if (p.newsUpdated && now - p.newsUpdated < NEWS_WINDOW_MS) flags.push({ level: 'info', label: 'News in the last 3 days' })

  return flags.sort((a, b) => RANK[a.level] - RANK[b.level])
}

export const worstLevel = (flags: Flag[]): FlagLevel | null => flags[0]?.level ?? null

const CLEARED = /\b(good to go|off (the )?injury report|no injury designation|without (an )?injury designation|won'?t carry (an )?(injury )?designation|cleared to play|will play|expected to play|full participant|fully participat|activated)\b/i
const RULED_OUT = /\b(ruled out|won'?t play|will not play|is out for|out for (the )?(season|year|week)|placed on (injured reserve|ir)|season-ending|out indefinitely)\b/i

/**
 * Sleeper's injury tag can lag the news by a day (a player reported "good to go" is
 * still tagged Questionable). Read the newest headline for the two cases that matter:
 * a tagged player who's been cleared, and an untagged/Questionable one who's been ruled out.
 */
export function newsVsTag(
  p: Player | undefined,
  latest: { title: string; description: string | null } | null | undefined,
): 'cleared' | 'out' | null {
  if (!p || !latest) return null
  const text = `${latest.title} ${latest.description ?? ''}`
  if (RULED_OUT.test(text) && !['Out', 'IR', 'PUP', 'Sus'].includes(p.injury ?? '')) return 'out'
  if (CLEARED.test(text) && (p.injury === 'Questionable' || p.injury === 'Doubtful')) return 'cleared'
  return null
}
