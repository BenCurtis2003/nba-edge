# BDL Context Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Picks with Proof" BDL stat panel that appears above the ConvictionCard when any play row is expanded, showing last 5 game logs, season average, and rest status for the relevant player or team.

**Architecture:** A new serverless route (`pages/api/bdl-context.js`) fetches BDL data on demand and returns structured context. The frontend calls it when a row expands, caches results in a `useRef` Map to prevent duplicate fetches, and stores results in a `useState` object to trigger re-renders. A new `BDLContextPanel` component renders the panel using existing design tokens.

**Tech Stack:** Next.js Pages Router, BallDontLie API v1 (Bearer auth), inline styles, existing design tokens (`T.*`), Barlow + JetBrains Mono fonts.

---

## Spec Reference
`docs/superpowers/specs/2026-03-18-bdl-context-design.md`

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `pages/api/bdl-context.js` | **Create** | Server-side BDL fetching. Accepts query params, calls BDL, returns structured context object. Keeps API key server-side. |
| `pages/index.jsx` | **Modify** | Add `bdlCache` ref + `bdlData` state. Add `BDLContextPanel` component. Wire fetch-on-expand. Render panel above `ConvictionCard` in expanded row. |

No other files change.

---

## Codebase Context (read this before touching any file)

**`pages/index.jsx` key locations:**
- Line ~105: `const T = { ... }` — design tokens. Use `T.surface`, `T.surfaceHi`, `T.border`, `T.text`, `T.textMid`, `T.textDim`, `T.blue`, `T.green`, `T.amber`, `T.red`.
- Line ~624: `function HistoryRow(...)` — add `BDLContextPanel` component definition **above** this line (before `HistoryRow`).
- Line ~1: `import { useState, useEffect, useCallback } from "react"` — **you must add `useRef`** to this import (see Task 3, Step 0).
- Line ~1442: `const [expandedId, setExpandedId] = useState(null);` — add `bdlCache` and `bdlData` state immediately after this block. These are inside the main page component function — `tablePlays`, `fetchBdlContext`, and all state hooks live at the same scope level inside this function.
- Lines ~2049–2062: The expanded row block. Currently renders `ConvictionCard`. Add `BDLContextPanel` **before** `ConvictionCard` inside this block.

**Expanded row block (current):**
```jsx
{isExpanded && (
  <div style={{
    borderBottom:`1px solid ${T.border}`,
    borderLeft: rowBorderLeft,
    background: T.surfaceHi,
    padding:"12px 16px",
  }}>
    <ConvictionCard
      play={play}
      expanded={true}
      onExpand={() => setExpandedId(null)}
    />
  </div>
)}
```

**API route pattern** (match existing routes like `pages/api/nba-stats.js`):
```js
export default async function handler(req, res) {
  // no auth needed — public read endpoint
  try {
    // logic
    return res.status(200).json({ ... });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
```

**BDL API base URL:** `https://api.balldontlie.io/v1`
**Auth header:** `Authorization: Bearer ${process.env.BDL_API_KEY}`

---

## Task 1: Create `pages/api/bdl-context.js`

**Files:**
- Create: `pages/api/bdl-context.js`

**What this route does:**
1. Reads `betType`, `selection`, `game` from query params
2. For `Props`: looks up player → fetches season avg via `/season_averages` → fetches last 5 team games → fetches player stat for each game → computes hit rate vs. prop line
3. For `Moneyline`/`Spread`/`Game Total`: looks up team → fetches last 5 games → computes W/L or margin/total
4. Returns a structured JSON context object

- [ ] **Step 1: Create the file with the helper and the handler skeleton**

```js
// pages/api/bdl-context.js
// Returns BDL statistical context for a play — called client-side on row expand.

const BDL_BASE = "https://api.balldontlie.io/v1";

async function bdlFetch(path) {
  const res = await fetch(`${BDL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.BDL_API_KEY}` },
  });
  if (!res.ok) throw new Error(`BDL ${path} → HTTP ${res.status}`);
  return res.json();
}

// Infer stat key and prop line from selection string
// e.g. "LeBron James Over 27.5 Points" → { stat: "pts", line: 27.5 }
function parseSelection(selection) {
  const s = selection || "";
  let stat = "pts";
  if (/rebounds|reb/i.test(s)) stat = "reb";
  else if (/assists|ast/i.test(s)) stat = "ast";
  else if (/three|3pm|threes/i.test(s)) stat = "fg3m";

  const lineMatch = s.match(/(\d+\.?\d*)/);
  const line = lineMatch ? parseFloat(lineMatch[1]) : null;

  // Player name: everything before "Over" or "Under"
  const nameMatch = s.match(/^(.+?)\s+(over|under)/i);
  const playerName = nameMatch ? nameMatch[1].trim() : s.split(" ").slice(0, 2).join(" ");

  return { stat, line, playerName };
}

// Current NBA season year (start year of season)
function currentSeason() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

// Days between two ISO date strings
function daysBetween(dateA, dateB) {
  return Math.round(
    Math.abs(new Date(dateA) - new Date(dateB)) / (1000 * 60 * 60 * 24)
  );
}

export default async function handler(req, res) {
  const { betType = "Moneyline", selection = "", game = "", gameDate } = req.query;
  const targetDate = gameDate || new Date().toISOString().slice(0, 10);

  try {
    if (betType === "Props") {
      const ctx = await fetchPropsContext(selection, targetDate);
      return res.status(200).json(ctx);
    } else {
      const ctx = await fetchTeamContext(betType, selection, game, targetDate);
      return res.status(200).json(ctx);
    }
  } catch (e) {
    console.error("bdl-context error:", e.message);
    return res.status(200).json({ error: "unavailable" });
  }
}
```

- [ ] **Step 2: Add `fetchPropsContext` function**

Add this before `export default`:

```js
async function fetchPropsContext(selection, targetDate) {
  const { stat, line, playerName } = parseSelection(selection);

  // 1. Find player
  const playerRes = await bdlFetch(`/players?search=${encodeURIComponent(playerName)}&per_page=5`);
  const player = playerRes.data?.[0];
  if (!player) return { error: "not_found" };

  const playerId = player.id;
  const teamId = player.team?.id;

  // 2. Season averages
  const avgRes = await bdlFetch(`/season_averages?season=${currentSeason()}&player_ids[]=${playerId}`);
  const avgData = avgRes.data?.[0] || {};
  const seasonAvg = avgData[stat] ?? null;

  // 3. Last 6 completed games for the team (we'll take 5 with scores)
  const gamesRes = await bdlFetch(
    `/games?team_ids[]=${teamId}&per_page=6&postseason=false`
  );
  const completedGames = (gamesRes.data || [])
    .filter(g => g.status === "Final")
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (!completedGames.length) return { error: "not_found" };

  // 4. Player stat for each game (sequential to respect rate limits).
  // Note: all API/network errors are collapsed into { error: "unavailable" } at the
  // handler level — rate limits (429) and auth errors (401) are intentionally treated
  // the same per spec scope.
  const last5 = [];
  for (const g of completedGames) {
    try {
      const statRes = await bdlFetch(`/stats?game_ids[]=${g.id}&player_ids[]=${playerId}&per_page=1`);
      const statLine = statRes.data?.[0];
      const value = statLine?.[stat] ?? null;
      if (value !== null) {
        const hitsLine = line !== null ? value > line : null;
        last5.push({ date: g.date, value, hitsLine });
      }
    } catch (_) {
      // skip game if stat fetch fails
    }
  }

  const hitsCount = last5.filter(g => g.hitsLine).length;
  const hitRate = last5.length > 0 ? hitsCount / last5.length : null;

  // Rest calculation: days since most recent completed game
  const mostRecentGame = completedGames[0];
  const restDays = mostRecentGame ? daysBetween(targetDate, mostRecentGame.date) : null;
  const isBackToBack = restDays !== null && restDays <= 1;

  return {
    type: "player",
    playerName,
    stat,
    propLine: line,
    last5,
    hitRate,
    seasonAvg,
    restDays,
    isBackToBack,
    opponentContext: null,
  };
}
```

- [ ] **Step 3: Add `fetchTeamContext` function**

Add this before `export default`:

```js
async function fetchTeamContext(betType, selection, game, targetDate) {
  // Parse team name: for ML/SPR the selection IS the team name
  // e.g. "Los Angeles Lakers" or "Lakers -5.5"
  const teamName = selection.replace(/[+-]?\d+\.?\d*$/, "").trim();

  // 1. Find team
  const teamRes = await bdlFetch(`/teams?search=${encodeURIComponent(teamName)}`);
  const team = teamRes.data?.[0];
  if (!team) return { error: "not_found" };

  const teamId = team.id;

  // 2. Last 6 completed games
  const gamesRes = await bdlFetch(
    `/games?team_ids[]=${teamId}&per_page=6&postseason=false`
  );
  const completedGames = (gamesRes.data || [])
    .filter(g => g.status === "Final")
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (!completedGames.length) return { error: "not_found" };

  // Build last5 based on betType
  const last5 = completedGames.map(g => {
    const isHome = g.home_team?.id === teamId;
    const teamScore = isHome ? g.home_team_score : g.visitor_team_score;
    const oppScore = isHome ? g.visitor_team_score : g.home_team_score;
    const margin = teamScore - oppScore;
    const total = teamScore + oppScore;

    let value, hitsLine;
    if (betType === "Game Total") {
      // Parse line from selection: "Over 224.5" or "Under 224.5"
      const lineMatch = selection.match(/(\d+\.?\d*)/);
      const line = lineMatch ? parseFloat(lineMatch[1]) : null;
      const isOver = /over/i.test(selection);
      value = total;
      hitsLine = line !== null ? (isOver ? total > line : total < line) : null;
    } else {
      // ML or Spread — value is margin
      value = margin;
      if (betType === "Spread") {
        const lineMatch = selection.match(/([+-]?\d+\.?\d*)$/);
        const spread = lineMatch ? parseFloat(lineMatch[1]) : null;
        hitsLine = spread !== null ? margin + spread > 0 : null;
      } else {
        hitsLine = margin > 0; // ML: did they win?
      }
    }
    return { date: g.date, value, hitsLine };
  });

  const hitsCount = last5.filter(g => g.hitsLine).length;
  const hitRate = last5.length > 0 ? hitsCount / last5.length : null;

  const mostRecentGame = completedGames[0];
  const restDays = mostRecentGame ? daysBetween(targetDate, mostRecentGame.date) : null;
  const isBackToBack = restDays !== null && restDays <= 1;

  return {
    type: "team",
    teamName: team.full_name,
    stat: betType === "Game Total" ? "total" : "margin",
    propLine: null,
    last5,
    hitRate,
    seasonAvg: null,
    restDays,
    isBackToBack,
    opponentContext: null,
  };
}
```

- [ ] **Step 4: Verify the route works manually**

Start the dev server:
```bash
npm run dev
```

Test the Props endpoint in your browser or curl:
```
http://localhost:3000/api/bdl-context?betType=Props&selection=LeBron%20James%20Over%2027.5%20Points&game=Lakers%20%40%20Celtics
```

Expected: JSON object with `type: "player"`, `last5` array of 5 entries, `hitRate` number, `seasonAvg` number.

Test the team endpoint:
```
http://localhost:3000/api/bdl-context?betType=Moneyline&selection=Los%20Angeles%20Lakers&game=Lakers%20%40%20Celtics
```

Expected: JSON object with `type: "team"`, `last5` array with `value` (point margin) and `hitsLine` boolean.

If BDL returns `HTTP 401`: check `BDL_API_KEY` is set in `.env.local`.
If BDL returns `not_found`: player/team name parsing may need adjustment for the specific play format.

- [ ] **Step 5: Commit**

```bash
git add pages/api/bdl-context.js
git commit -m "feat: add /api/bdl-context route — BDL props and team context"
```

---

## Task 2: Add `BDLContextPanel` Component to `pages/index.jsx`

**Files:**
- Modify: `pages/index.jsx` — insert component above `function HistoryRow` (~line 624)

- [ ] **Step 1: Add the `BDLContextPanel` component**

Find this line in `pages/index.jsx`:
```js
// ── History Row — trading blotter style ──────────────────────────────────────
function HistoryRow({ h, rowIndex }) {
```

Insert the entire `BDLContextPanel` function **before** that comment:

```jsx
// ── BDL Context Panel — "Picks with Proof" stat context on row expand ────────
function BDLContextPanel({ context, play }) {
  // Note: `stat` uses BDL field name abbreviations ("pts", "reb", "ast", "fg3m")
  // internally. The spec example shows "points" but BDL's actual field names are
  // abbreviated — the statLabel map handles display. This is an intentional deviation
  // from the spec's example JSON for practical BDL compatibility.
  const statLabel = {
    pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM",
    margin: "MARGIN", total: "TOTAL",
  };

  // Loading state
  if (context === undefined) {
    return (
      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.12em", marginBottom:10,
          fontFamily:"'Barlow',sans-serif", textTransform:"uppercase" }}>
          Statistical Context
        </div>
        {[1,2,3].map(i => (
          <div key={i} style={{ height:14, background:T.surfaceHi, borderRadius:4,
            marginBottom:8, width: i === 3 ? "60%" : "100%",
            animation:"pulse 1.5s ease-in-out infinite" }} />
        ))}
      </div>
    );
  }

  // Error states
  if (context?.error === "not_found") {
    return (
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.border}`,
        fontSize:10, color:T.textDim, fontFamily:"'Barlow',sans-serif" }}>
        No BDL data available for this play
      </div>
    );
  }
  if (context?.error) {
    return (
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.border}`,
        fontSize:10, color:T.textDim, fontFamily:"'Barlow',sans-serif" }}>
        Stats temporarily unavailable
      </div>
    );
  }

  const { last5 = [], hitRate, seasonAvg, restDays, isBackToBack, stat, propLine,
    playerName, teamName } = context;
  const label = statLabel[stat] || stat?.toUpperCase() || "STAT";
  const maxVal = Math.max(...last5.map(g => Math.abs(g.value || 0)), 1); // guard against 0-max
  const hitRateColor = hitRate === null ? T.textDim
    : hitRate >= 0.6 ? T.green : hitRate >= 0.4 ? T.amber : T.red;
  const restColor = isBackToBack ? T.red : restDays === 1 ? T.amber : T.green;
  const restText = isBackToBack ? "Back-to-back" : restDays === 1 ? "1 day rest" : `${restDays ?? "?"} days rest`;

  return (
    <div style={{ borderBottom:`1px solid ${T.border}`, background:T.surface }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"10px 16px 6px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ fontSize:9, fontWeight:800, color:T.textDim, letterSpacing:"0.12em",
          textTransform:"uppercase", fontFamily:"'Barlow',sans-serif" }}>
          Statistical Context · {playerName || teamName}
        </div>
        <div style={{ fontSize:8, color:T.textDim, fontFamily:"'Barlow',sans-serif" }}>
          Powered by BallDontLie
        </div>
      </div>

      <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:10 }}>
        {/* Last 5 game log */}
        {last5.length > 0 && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              marginBottom:6 }}>
              <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.1em",
                textTransform:"uppercase", fontFamily:"'Barlow',sans-serif" }}>
                Last {last5.length} Games · {label}
                {propLine !== null && (
                  <span style={{ color:T.textMid }}> (line: {propLine})</span>
                )}
              </div>
              {hitRate !== null && (
                <div style={{ fontSize:10, fontWeight:700, color:hitRateColor,
                  fontFamily:"'JetBrains Mono',monospace" }}>
                  {Math.round(hitRate * last5.length)}/{last5.length} HIT
                </div>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              {last5.map((g, i) => {
                // Minimum bar width of 4% so a value of exactly 0 still renders a visible sliver
                const barPct = Math.max(Math.round((Math.abs(g.value || 0) / maxVal) * 100), 4);
                const barWidth = `${barPct}%`;
                const dateStr = new Date(g.date).toLocaleDateString("en-US",
                  { month:"short", day:"numeric" });
                return (
                  <div key={i} style={{ display:"grid",
                    gridTemplateColumns:"48px 52px 1fr 28px", gap:6, alignItems:"center" }}>
                    <div style={{ fontSize:9, color:T.textDim,
                      fontFamily:"'JetBrains Mono',monospace" }}>{dateStr}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:T.text, textAlign:"right",
                      fontFamily:"'JetBrains Mono',monospace" }}>
                      {g.value > 0 ? "+" : ""}{g.value}
                    </div>
                    <div style={{ height:3, borderRadius:2, background:T.border, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:barWidth,
                        background: g.hitsLine ? T.green : T.red, borderRadius:2 }} />
                    </div>
                    <div style={{ fontSize:10, textAlign:"center",
                      color: g.hitsLine ? T.green : g.hitsLine === false ? T.red : T.textDim }}>
                      {g.hitsLine === true ? "✓" : g.hitsLine === false ? "✗" : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Season avg + rest — side by side */}
        <div style={{ display:"flex", gap:16 }}>
          {seasonAvg !== null && (
            <div style={{ fontSize:10, color:T.textMid, fontFamily:"'Barlow',sans-serif" }}>
              Season avg:{" "}
              <span style={{ fontFamily:"'JetBrains Mono',monospace", color:T.text,
                fontWeight:700 }}>{Number(seasonAvg).toFixed(1)}</span>
            </div>
          )}
          {restDays !== null && (
            <div style={{ fontSize:10, fontFamily:"'Barlow',sans-serif",
              color:restColor, fontWeight:600 }}>
              {restText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component renders without crashing**

In `pages/index.jsx`, temporarily add a test render of the component anywhere visible (e.g. at the top of the main return) to confirm it mounts cleanly:

```jsx
<BDLContextPanel context={undefined} play={{}} />
```

Run `npm run dev` and open the browser. Should see the loading skeleton (pulsing gray bars). Remove the test render after confirming.

- [ ] **Step 3: Commit**

```bash
git add pages/index.jsx
git commit -m "feat: add BDLContextPanel component — loading, error, and data states"
```

---

## Task 3: Wire State + Fetch-on-Expand

**Files:**
- Modify: `pages/index.jsx` — add state, fetch logic, and panel into expanded row

- [ ] **Step 0: Add `useRef` to the React import**

Find the first line of `pages/index.jsx`:
```js
import { useState, useEffect, useCallback } from "react";
```

Replace with:
```js
import { useState, useEffect, useCallback, useRef } from "react";
```

This is a required change — `bdlCache` uses `useRef` and the build will fail without it.

- [ ] **Step 1: Add `bdlCache` ref and `bdlData` state**

Find this line in `pages/index.jsx`:
```js
const [expandedId, setExpandedId] = useState(null);
```

Add immediately after it:
```js
const bdlCache = useRef(new Map()); // play.id → sentinel or context (prevents duplicate fetches)
const [bdlData, setBdlData] = useState({}); // play.id → context object (drives re-render)
```

Note: `useRef` is already imported. If not, it's imported from React at the top of the file — check line ~2 and add `useRef` to the import if missing.

- [ ] **Step 2: Add the fetch function**

Find the block containing `const tablePlays = (() => {` (around line ~1609). Add this helper function **before** that block:

```js
const fetchBdlContext = (play) => {
  if (bdlCache.current.has(play.id)) return; // already fetching or fetched
  bdlCache.current.set(play.id, "loading");
  const params = new URLSearchParams({
    betType: play.betType || "Moneyline",
    selection: play.selection || "",
    game: play.game || "",
    gameDate: new Date().toISOString().slice(0, 10),
  });
  fetch(`/api/bdl-context?${params}`)
    .then(r => r.json())
    .then(ctx => {
      bdlCache.current.set(play.id, ctx);
      setBdlData(prev => ({ ...prev, [play.id]: ctx }));
    })
    .catch(() => {
      const err = { error: "unavailable" };
      bdlCache.current.set(play.id, err);
      setBdlData(prev => ({ ...prev, [play.id]: err }));
    });
};
```

- [ ] **Step 3: Trigger fetch when a row expands**

Find the row click handler:
```js
onClick={() => setExpandedId(isExpanded ? null : play.id)}
```

Replace with:
```js
onClick={() => {
  const newId = isExpanded ? null : play.id;
  setExpandedId(newId);
  if (newId) fetchBdlContext(play);
}}
```

- [ ] **Step 4: Render `BDLContextPanel` in the expanded block**

Find the expanded row block (currently ~lines 2049–2062):
```jsx
{isExpanded && (
  <div style={{
    borderBottom:`1px solid ${T.border}`,
    borderLeft: rowBorderLeft,
    background: T.surfaceHi,
    padding:"12px 16px",
  }}>
    <ConvictionCard
      play={play}
      expanded={true}
      onExpand={() => setExpandedId(null)}
    />
  </div>
)}
```

Replace with:
```jsx
{isExpanded && (
  <div style={{
    borderBottom:`1px solid ${T.border}`,
    borderLeft: rowBorderLeft,
    background: T.surfaceHi,
  }}>
    <BDLContextPanel context={bdlData[play.id]} play={play} />
    <div style={{ padding:"12px 16px" }}>
      <ConvictionCard
        play={play}
        expanded={true}
        onExpand={() => setExpandedId(null)}
      />
    </div>
  </div>
)}
```

Note: `padding` moved from the outer div to wrap only `ConvictionCard`, since `BDLContextPanel` manages its own padding.

- [ ] **Step 5: Verify end-to-end in the browser**

```bash
npm run dev
```

Open `http://localhost:3000`. Navigate to the Plays tab. Click any play row to expand it. Verify:
1. The BDL context panel appears above the conviction card
2. Loading skeleton shows immediately on click
3. Within 2–5 seconds, real data replaces the skeleton (last 5 game bars + hit rate + rest info)
4. Clicking the same row again (collapse + re-expand) does NOT re-fetch — data appears instantly (cache working)
5. No console errors

If panel stays on skeleton forever: check Network tab for the `/api/bdl-context` request. If it returns an error, check the Vercel dev server terminal for the error message.

- [ ] **Step 6: Commit**

```bash
git add pages/index.jsx
git commit -m "feat: wire BDL context fetch-on-expand with session cache"
```

---

## Task 4: Deploy and Verify

**Files:** none (deploy only)

- [ ] **Step 1: Push to production**

```bash
git push origin main
```

Vercel auto-deploys on push. Wait ~60 seconds for the build.

- [ ] **Step 2: Verify on production**

Open the live site. Expand a play row. Confirm:
- BDL panel appears with real stat data (not just loading skeleton stuck)
- No `Stats temporarily unavailable` message (would indicate API key issue on Vercel)

If `Stats temporarily unavailable` in prod but not locally: `BDL_API_KEY` may not be set in Vercel environment variables. Add it via the Vercel dashboard → Project Settings → Environment Variables.

- [ ] **Step 3: Done**

The "Picks with Proof" layer is live. Every play row expansion now shows the statistical evidence behind the pick.

---

## Edge Cases the Implementer Must Handle

| Situation | Behavior |
|-----------|----------|
| BDL player not found (name parse fails) | Return `{ error: "not_found" }` → panel shows "No BDL data available" |
| BDL API key missing/invalid | `bdlFetch` throws → caught → return `{ error: "unavailable" }` |
| `last5` is empty (new team/player) | Panel shows only season avg + rest, skips game log section |
| `propLine` is null (couldn't parse line from selection) | Bar chart still renders, `hitsLine` is null → "—" shown instead of ✓/✗ |
| `betType` is missing or unrecognized | Falls through to team context, treated as Moneyline |
| Multiple rows expanded rapidly | Each triggers its own fetch; `bdlCache` ref prevents duplicates per play.id |
