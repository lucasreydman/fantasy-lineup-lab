# Trade Lineup Lab

See a Sleeper trade in your actual lineup. Pick your league, pick a trade partner, drag players between the two rosters (or add them in the trade bar), and both starting lineups re-optimize for every week in the horizon you choose: who gets elevated off the bench, who has to be dropped, which spots open up, and what the trade does to projected points this week, over the next 3, or rest of season.

## Run

```
npm install
npm run dev      # app + /api functions on one dev server
npm test         # lineup solver, trade evaluation, Blend math, pickup ranking
npm run build
```

Deploys to Vercel as-is: `api/*.ts` are Vercel functions, everything else is a static Vite app.

## How it works

- **Data**: Sleeper's public API (CORS-open, no backend): league, rosters, users, the player DB (trimmed and cached for a day), and per-player weekly projections for every week of the season.
- **Scoring**: projected stat lines are scored with the league's own `scoring_settings` (PPR, TE premium, custom bonuses).
- **Lineups** (`src/lib/lineup.ts`): the optimal lineup is a max-weight assignment of players to slots, solved exactly with the Hungarian algorithm, so overlapping flexes (W/R, W/T, SF) are handled correctly. Byes count as 0.
- **Trades** (`src/lib/trade.ts`): before/after lineups per week; when a trade overfills a roster, the drop is the player whose loss hurts the optimal lineups least over the horizon (overridable: Drop / Keep).
- **Open spots** (`src/lib/waivers.ts`): when a trade frees roster spots, it suggests IR activations and waiver pickups ranked by what each adds to the optimal lineups over the horizon. That's positionally aware by construction (a third QB never starts in a one-QB league), with depth caps for QB/TE/K/DEF and depth targets that favor whichever position the roster is thinnest at. Drag a suggestion onto the roster or hit Add.

## Projections: Sleeper or Blend

The toggle switches between Sleeper's projections and the **Blend** (`src/lib/blend.ts`), the War Room app's method rebuilt here:

1. **Consensus**: Sleeper × ESPN stat lines, 50/50 where both project a stat.
2. **Sportsbooks**: Pinnacle + Underdog player props (median line, de-vigged juice → expected value; anytime-TD → expected TDs via Poisson) anchor the stats they price, at 70–85% weight.
3. **Game script**: implied team totals and spreads tilt everything the books didn't price.
4. **Matchup**: defense vs. position from Sleeper actuals, scored with the league's settings, regressed by measured year-over-year predictiveness, capped at ±10%.
5. **Health**: Out/IR zeroed, Doubtful 0.2×, Questionable by practice report (DNP 0.6×, limited 0.85×).

Books only price the current week, so later weeks in a horizon are Sleeper's projection plus the matchup tilt. Hover a player's points for the breakdown.

The market feeds come from this app's own functions, no keys needed:

- `GET /api/market`: game lines (Pinnacle, ESPN backup), consensus props, ESPN projections for the week being priced (5–10 min cache).
- `GET /api/dvp`: stat totals allowed per defense × position, this season and last (hourly).
