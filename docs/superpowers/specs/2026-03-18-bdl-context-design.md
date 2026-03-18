# NBA Edge — BDL Context Panel Design Spec
**Date:** 2026-03-18
**Status:** Approved
**Scope:** Inline BDL statistical context panel added to expanded play rows in `pages/index.jsx` + new API route `pages/api/bdl-context.js`

---

## Overview

Add a "Picks with Proof" layer to NBA Edge: when a user expands any play row, a **BDL Context Panel** appears showing the statistical evidence behind the pick. Data is fetched lazily on expand and cached client-side for the session. This makes the conviction engine transparent — users see the *why*, not just the pick.

Target users: recreational bettors who want guidance, and serious bettors who want to verify the thesis. Both are served by showing the data.

---

## Product Value Prop

- **Differentiator vs. Action Network:** They show picks + community. We show picks + the statistical evidence. No one in the free tier does this.
- **Trust builder:** Casual users see real data behind each pick. Serious users can sanity-check quickly without leaving the app.
- **v2 path:** Player names in the context panel will become links to full player drill-down pages (designed for but not built in this spec).

---

## Layout

The BDL Context Panel renders **above** the existing `ConvictionCard` expanded content when a play row is expanded.

```
┌──────────────────────────────────────────────────────────┐
│ STATISTICAL CONTEXT                          [BDL badge] │
├──────────────────────────────────────────────────────────┤
│ LAST 5 GAMES  [relevant stat]                            │
│  Mar 15  28 pts  ████████░░  ✓ Over 26.5                │
│  Mar 13  31 pts  ██████████  ✓ Over 26.5                │
│  Mar 11  19 pts  ██████░░░░  ✗ Under 26.5               │
│  Mar 9   33 pts  ██████████  ✓ Over 26.5                │
│  Mar 7   27 pts  ████████░░  ✓ Over 26.5     HIT: 4/5   │
├──────────────────────────────────────────────────────────┤
│ MATCHUP   Celtics allow 24.1 PPG to opponent   #8 DEF   │
├──────────────────────────────────────────────────────────┤
│ REST      Back-to-back — played last night               │
└──────────────────────────────────────────────────────────┘
```

---

## Stat Selection by Bet Type

The panel adapts to the play's `betType`:

| `betType` | Stat shown in Last 5 | Hit condition |
|-----------|---------------------|---------------|
| `Moneyline` | Team W/L + point differential | Win = covers spread / wins outright |
| `Spread` | Team margin vs. spread | Covered the spread |
| `Game Total` | Combined game total vs. line | Over or Under as per play |
| `Props` | Player stat inferred from `play.selection` text (pts/reb/ast/3pm) | Stat exceeded the prop line |

For props, the relevant stat is inferred by keyword matching on `play.selection`:
- Contains "Points" or "PTS" → points
- Contains "Rebounds" or "REB" → rebounds
- Contains "Assists" or "AST" → assists
- Contains "Threes" or "3PM" → three pointers made

The prop line value is parsed from `play.selection` (e.g. "LeBron James Over 27.5 Points" → line = 27.5).

---

## API Route: `pages/api/bdl-context.js`

### Request
```
GET /api/bdl-context?betType=Props&selection=LeBron+James+Over+27.5+Points&game=Lakers+%40+Celtics&gameDate=2026-03-18
```

Query params:
- `betType` — one of: `Moneyline`, `Spread`, `Game Total`, `Props`. If missing or unrecognized, treat as `Moneyline`.
- `selection` — the full play selection string (used to extract player/team name)
- `game` — the game string (e.g. "Lakers @ Celtics", used to identify opponent)
- `gameDate` — ISO date string (optional). Play objects do not currently have a `date` field, so the client passes `new Date().toISOString().slice(0,10)` (today's date) as a reasonable fallback. Rest calculation uses this date to determine days since the team's last game.

### Response
```json
{
  "type": "player",
  "playerName": "LeBron James",
  "stat": "points",
  "propLine": 27.5,
  "last5": [
    { "date": "2026-03-15", "value": 28, "hitsLine": true },
    { "date": "2026-03-13", "value": 31, "hitsLine": true },
    { "date": "2026-03-11", "value": 19, "hitsLine": false },
    { "date": "2026-03-09", "value": 33, "hitsLine": true },
    { "date": "2026-03-07", "value": 27, "hitsLine": false }
  ],
  "hitRate": 0.6,
  "seasonAvg": 28.3,
  "restDays": 0,
  "isBackToBack": true,
  "opponentContext": null
}
```

For team bets (ML/SPR/TOT), `type` is `"team"` and `last5` contains game results with margin/total data. `playerName` is null. `opponentContext` is always `null` in this version — opponent defensive rank data is not available via BDL v1 and is deferred to v2.

### Error handling
- If BDL player lookup returns no results: return `{ "error": "not_found" }` — panel shows "No BDL data available for this play"
- If BDL API is rate-limited or errors: return `{ "error": "unavailable" }` — panel shows a graceful fallback, never crashes the expanded row

---

## BDL API Calls (server-side, in order)

### For Props
1. `GET /players?search={playerName}&per_page=5` → get player ID and `team_id`
2. `GET /season_averages?season={currentSeason}&player_ids[]={id}` → season averages object (BDL v1 has a dedicated `/season_averages` endpoint that returns pre-aggregated averages — use this, not `/stats`)
3. `GET /games?team_ids[]={teamId}&per_page=6` → last 5 completed games for the player's team + rest gap calculation (use `date` field of most recent game vs. `gameDate` param)
4. For each of the last 5 game IDs: `GET /stats?game_ids[]={id}&player_ids[]={playerId}` → player's stat line for that game. Make these calls sequentially to respect rate limits.

### For Team bets (ML/SPR/TOT)
1. Parse team name from `play.game` string
2. `GET /teams?search={teamName}` → get team ID
3. `GET /games?team_ids[]={teamId}&per_page=6` → last 5 completed games + rest gap calculation

### Rate limiting
BDL API calls are sequential (not parallel) to respect rate limits. The upgraded API key supports higher throughput — use `Authorization: Bearer {BDL_API_KEY}` header on all requests. The BDL API key is read from `process.env.BDL_API_KEY` (already set in the project).

---

## Client-Side Integration

### State
```js
const bdlCache = useRef(new Map()); // play.id → context object or "loading" or "error"
const [bdlData, setBdlData] = useState({}); // play.id → context (triggers re-render)
```

### Fetch on expand
When `expandedId` is set to a play's id:
```js
if (!bdlCache.current.has(play.id)) {
  bdlCache.current.set(play.id, "loading");
  fetch(`/api/bdl-context?betType=...&selection=...&game=...&gameDate=...`)
    .then(r => r.json())
    .then(ctx => {
      bdlCache.current.set(play.id, ctx);
      setBdlData(prev => ({ ...prev, [play.id]: ctx }));
    })
    .catch(() => {
      bdlCache.current.set(play.id, "error");
      setBdlData(prev => ({ ...prev, [play.id]: { error: "unavailable" } }));
    });
}
```

### BDLContextPanel component
New component in `pages/index.jsx` (above `HistoryRow`). Props: `{ context, play }`.

`context` is always sourced from `bdlData[play.id]` (the React state map), never from `bdlCache.current` directly. `bdlCache` is a ref used only to prevent duplicate fetches — it is never passed to components.

States:
- `context === undefined` (key absent from `bdlData`) → loading skeleton (3 shimmer rows)
- `context?.error === "not_found"` → "No BDL data available"
- `context?.error === "unavailable"` → "Stats temporarily unavailable"
- Otherwise → full panel render

---

## Visual Design

Follows existing design tokens (`T.*`) and Bloomberg terminal aesthetic.

- **Panel background:** `T.surface` with `border: 1px solid T.border`, `borderRadius: 8`
- **Section dividers:** `1px solid T.border`
- **Section labels:** 9px, `T.textDim`, `letterSpacing: 0.12em`, uppercase, `fontFamily: 'Barlow'`
- **BDL badge:** Top-right corner, 8px, `T.textDim`, "Powered by BallDontLie"
- **Stat bars:** Inline `div` with `background: T.blue`, width proportional to value vs. season max, height 3px
- **Hit indicator:** ✓ in `T.green`, ✗ in `T.red`
- **Hit rate summary:** Right-aligned, `fontFamily: 'JetBrains Mono'`, green if ≥ 60%, amber if 40–59%, red if < 40%
- **Rest flag colors:** 🟢 `T.green` (2+ days rest) / 🟡 `T.amber` (1 day) / 🔴 `T.red` (back-to-back)
- **Loading skeleton:** 3 rows of `background: T.surfaceHi`, `borderRadius: 4`, animated opacity pulse

---

## Components Unchanged

All existing components (`ConvictionCard`, `ScoreRing`, `SignalBar`, `BookLine`, `BookOddsTable`, etc.) are unchanged. The `BDLContextPanel` renders **before** `ConvictionCard` in the expanded row, as a separate block.

---

## What's NOT in Scope (v2)

- Full player profile/drill-down pages
- Opponent position-level defensive splits
- Real-time injury reports (just rest/B2B from schedule data)
- Historical BDL data beyond last 5 games
- Caching BDL responses server-side (session-level client cache is sufficient for now)

---

## Files Changed

- **Create:** `pages/api/bdl-context.js` — BDL data fetching and context assembly
- **Modify:** `pages/index.jsx` — add `BDLContextPanel` component, `bdlCache` ref, `bdlData` state, fetch-on-expand logic
