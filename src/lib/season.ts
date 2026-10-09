/** The NFL regular season has 18 weeks; fantasy leagues finish inside it. */
export const LAST_NFL_WEEK = 18

/**
 * A league's playoff weeks from its Sleeper settings: playoffs start at
 * `playoff_week_start`, run one round per bracket level (4 teams = 2 rounds,
 * 6 or 8 = 3), and `playoff_round_type` stretches them: 1 = two-week
 * championship, 2 = every round two weeks. Leagues without playoffs (or settings
 * Sleeper didn't send) fall back to the usual Weeks 15–17.
 */
export function playoffWeeks(settings: Record<string, unknown>): { start: number; end: number } {
  const start = Number(settings.playoff_week_start) || 15
  const teams = Number(settings.playoff_teams) || 6
  const rounds = Math.max(1, Math.ceil(Math.log2(teams)))
  const type = Number(settings.playoff_round_type) || 0
  const weeks = type === 2 ? rounds * 2 : type === 1 ? rounds + 1 : rounds
  return { start, end: Math.min(LAST_NFL_WEEK, start + weeks - 1) }
}
