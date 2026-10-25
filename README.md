# Lineup Lab

See a Sleeper trade in your actual lineup. Pick your league and a trade partner, drag players between the two rosters (or add them in the trade bar), and both starting lineups re-optimize for every week in the window you choose: who gets elevated off the bench, who gets cut or stashed on IR, who gets picked up, and what the trade does to projected points this week, over the next 3, or rest of season.

Live: https://fantasy-lineup-lab.vercel.app · installable as an app (PWA) on iPhone, Android and desktop.

## Run

```
npm install
npm run dev      # app + /api functions on one dev server
npm test         # lineup solver, trade evaluation, roster automation, projections, pickups
npm run build
```

Deploys to Vercel as-is (pushes to `main` deploy automatically): `api/*.ts` are Vercel functions, everything else is a static Vite app with a service worker.

## How it works

- **Data**: Sleeper's public API (CORS-open, no backend): league, rosters, users, the player DB (trimmed and cached for a day), and per-player weekly projections for every week of the season.
- **Scoring**: projected stat lines are scored with the league's own `scoring_settings` (PPR, TE premium, custom bonuses).
- **Lineups** (`src/lib/lineup.ts`): the optimal lineup is a max-weight assignment of players to slots, solved exactly with the Hungarian algorithm, so overlapping flexes (W/R, W/T, SF) are handled. Byes count as 0. Bench reads QB, RB, WR, TE, K, DEF.
- **Roster moves** (`src/lib/trade.ts`): after a trade, both rosters are made legal automatically, judged on the **rest of the season** whatever window is on screen:
  - over the limit → stash IR-eligible players first (per the league's IR rules and free slots), then cut whoever costs the optimal lineups least;
  - under the limit → fill each spot with the best pickup or IR activation, re-ranking after each pick.
  - healthy but still on IR → activate now, cutting the cheapest if the roster is full;
  - on IR and coming back → activate the first week he's projected to play, cutting the cheapest from that week on.
  Before and after the trade are played out the same way, so a return you'd get anyway isn't credited to the trade, and trading away a player on IR costs every week he'd have started.
  Every automatic move is tagged and reversible (Keep, Remove pickup, Keep on IR), and you can make your own (Drop, Move to IR, Add, Activate).
- **Pickups** (`src/lib/waivers.ts`): ranked by what each adds to the optimal lineups. Positionally aware by construction, plus hard caps (no third QB in a one-QB league, no third TE, no second K/DEF) and depth targets that favor the thinnest position.

## Player news and trade alerts

- **Player card**: tap a player (or click a name on desktop) for injury and practice detail, this week's projection breakdown, the latest news from Sleeper's feed (Rotowire, FantasyPros, RotoBaller, with analysis), and that player's actions.
- **Flags** (`src/lib/flags.ts`): injury designation with body part and notes, practice report, roster status, not on an NFL team, upcoming bye, a zero rest-of-season projection, news in the last 3 days.
- **Heads up before you trade**: every player coming to your roster (trade, pickup, IR activation) with a flag is listed under the trade bar with his latest headline. Sleeper's injury tag can lag the news by a day, so when the newest headline says a tagged player is good to go (or ruled out) the alert says so.

## Projections: Sleeper or Lineup Lab

The toggle switches between Sleeper's projections and Lineup Lab's own (`src/lib/blend.ts`):

1. **Sportsbooks lead**: Pinnacle + Underdog player props (median line, de-vigged juice → expected value; anytime-TD → expected TDs via Poisson) set the stats they price, at 70–85% weight.
2. **Sleeper + ESPN fill the gaps**: books price only some stats for some players (about 210 players this week, few kickers, no defenses), and only the current week. Every other stat comes from Sleeper's and ESPN's projections averaged 50/50.
3. **Game script**: implied team totals and spreads tilt everything the books didn't price.
4. **Matchup**: defense vs. position from Sleeper actuals, scored with the league's settings, regressed by measured year-over-year predictiveness, capped at ±10%.
5. **Health**: Out/IR zeroed, Doubtful 0.2×, Questionable by practice report (DNP 0.6×, limited 0.85×).

Books only price the current week, so later weeks are Sleeper's projection plus the matchup tilt. Tap a player's points for the breakdown.

The market feeds come from this app's own functions, no keys needed:

- `GET /api/market`: game lines (Pinnacle, ESPN backup), consensus props, ESPN projections for the week being priced (5–10 min cache).
- `GET /api/dvp`: stat totals allowed per defense × position, this season and last (hourly).

## Phones

Installable PWA (manifest, icons, offline app shell; Sleeper and market data fall back to the last copy offline). "Get the app" walks through installing on each platform. Drag works by touch: press and hold a player, and a dock with both teams appears at the bottom of the screen. Tap any player for their actions.
