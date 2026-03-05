# NBA Edge — EV Betting Engine

A full-stack NBA sports betting analytics platform that finds +EV lines across 6 major sportsbooks, validates edges against Pinnacle (the world's sharpest book), scores every bet for outcome confidence using live NBA Stats data, runs an AI news & injury agent, and tracks a $100 paper bankroll over time. Designed to surface the bets most likely to actually cash — not just the ones with inflated EV.

---

## Features

### 📊 EV Engine
- Pulls real-time odds from DraftKings, FanDuel, BetMGM, Caesars, PointsBet, and BetRivers via The Odds API
- Removes vig from each book individually to compute a true no-vig consensus probability
- Compares best available soft book line against consensus to find genuine mispricing
- Requires ≥1.5% edge on game lines, ≥2.5% edge on player props, ≥6% on longshots (>+125)

### ⚡ Pinnacle Validation
- Fetches Pinnacle's line alongside soft books in the same API call
- Only surfaces a bet if **both** the local model and Pinnacle agree there is edge vs the soft book
- Final probability is averaged 50/50 between local model and Pinnacle when confirmed
- Bets confirmed by Pinnacle show a **⚡ SHARP** badge
- If Pinnacle has no line for a market, bet passes on local model alone with a yellow warning

### 🎯 Outcome Confidence Scoring
Every bet is scored 0–100 for outcome confidence, independent of EV, using:

**For Player Props (NBA Stats API — free, no key needed):**
- 5-game rolling average vs the prop line
- 10-game hit rate — how often the player has cleared this exact number
- Recent trend — last 3 games vs prior 3
- Minutes played as an injury/availability proxy
- EV/line alignment signal

**For Game Lines:**
- EV strength
- Pinnacle confirmation strength
- Best line vs average book gap
- Favorite vs underdog predictability factor

**Bonus layer (when Anthropic key added):**
- AI news score (1–10) applied as a weighted bonus factor

Confidence tiers: **HIGH** (≥72) / **MEDIUM** (≥52) / **LOW** (<52) — color coded green / yellow / red on every bet card.

### ⭐ Top Picks
A dedicated section above the main bet list showing up to 3 bets where **EV edge AND confidence are both HIGH** — the strongest possible double-confirmed signal. Each Top Pick card shows a mini confidence bar breakdown and links to the full expanded card.

### 🏀 Player Props (TheRundown API — free)
- Fetches player points, rebounds, and assists props from TheRundown's free tier
- Includes Pinnacle prop lines for sharp validation
- Props are independently vig-removed at 7% (books are less efficient here)
- Sign up free at therundown.io/api — no credit card required

### 📈 Market Bias Indicator
Calculates average vig across all h2h markets each day:
- **High Vig** (>6%) — soft market, more pricing errors likely, best day for props
- **Normal** (4.8–6%) — standard book vig, look for line moves and props
- **Sharp Market** (3.5–4.8%) — tight lines, sharp action present
- **Very Sharp** (<3.5%) — near-Pinnacle efficiency, hardest day to find edges

### 🔴 Live 60-Second Polling
Auto-refreshes every 60 seconds when your Odds API key is active. Line moves get caught within a minute — important because edges often open and close within 5–10 minutes of sharp money hitting a book.

### 🤖 AI News Agent
Powered by Claude (Anthropic) or GPT (OpenAI). Scans injury reports, beat reporter updates, lineup news, and player availability before each game. Assigns a News Score (1–10) to each bet. Score ≥8 supports the bet; <5 flags a concern. Adjusts confidence scoring when available.

### 🧠 Bayesian ML Engine
Learns from every resolved bet — updates win rates by bet type, odds range, and team. After 5+ resolved bets the ML engine adjusts probability estimates based on historical accuracy. Activates automatically and shows ML✓ badge on adjusted bets. Tracks: team-level win rates, accuracy by Moneyline / Spread / Game Total / Player Prop, accuracy by odds bucket.

### 📋 Kelly Criterion Sizing
Quarter-Kelly (25% of full formula), capped at 4% of bankroll per bet. Recommends a dollar amount for each bet based on your current paper bankroll and the strength of your edge.

### 📒 History Tab & Paper Bankroll
- Starts at $100 paper bankroll
- Every recommended bet is auto-placed at Kelly size
- **Auto-Resolve** — Moneylines, Spreads, and Game Totals resolve automatically via The Odds API scores endpoint. Player props show as Pending.
- **Portfolio Chart** — line chart of bankroll over time with shaded P&L area
- **Deduplication** — uses betId + calendar date as unique key, no duplicate bets
- Persists to localStorage across sessions

### 💡 Near-EV Fallback
On efficient market days (no edges above threshold), surfaces the top 5 closest-to-threshold bets with an orange NEAR-EV badge. Only shows when no sharp or prop bets exist so it never clutters real recommendations. All near-EV bets have edge ≥0% — never negative expected value.

---

## When to Use This App

**Best time:** 6–9am ET when books first post lines for the day, before sharp money arrives.

**Second best:** Within minutes of injury news breaking — a starter ruled out creates a 5–15 minute window before all books adjust. The 60s polling is built for this.

**Hardest time:** Mid-afternoon on game day — lines have been sharpened all morning and are near-efficient. The app will correctly show 0 bets or near-EV only on these days.

---

## API Keys

Click API Setup in the top right to enter your keys:

| Key | Where to Get It | Cost | Purpose |
|-----|----------------|------|---------|
| The Odds API | the-odds-api.com | Free tier | Live game lines + Pinnacle + score resolution |
| TheRundown API | therundown.io/api | Free (20k req/day) | Player props + Pinnacle props |
| Anthropic API | console.anthropic.com | Pay per use | AI news & injury agent (recommended) |
| OpenAI API | platform.openai.com | Pay per use | Alternative news agent |

Without any keys the app runs on demo data so you can explore the full interface freely.

---

## Bet Types

| Type | Edge Threshold | Source |
|------|---------------|--------|
| Moneyline | ≥1.5% | The Odds API |
| Spread | ≥1.5% | The Odds API |
| Game Total | ≥1.5% | The Odds API |
| Player Props | ≥2.5% | TheRundown API |
| Longshots (>+125) | ≥6% | Either |

---

## Odds Targeting

- Range: -450 to +350
- 70% of surfaced bets target negative odds (favorites)
- Longshot rule: any bet >+125 requires ≥6% edge to surface
- Pinnacle confirmation required for game line bets (or local model only with warning)

---

## Deploy Your Own

Live: https://nba-edge.vercel.app

From your terminal:

```shell
vercel
```

---

## File Structure

```
api/
  news.js          # Vercel serverless proxy for Anthropic/OpenAI (avoids CORS)
src/
  App.tsx          # Full React application — all logic, UI, and engines
public/
  index.html
package.json
README.md
```

---

## Tech Stack

- React + TypeScript + Vite
- The Odds API (game lines, Pinnacle, score resolution)
- TheRundown API (player props, free tier)
- NBA Stats API — stats.nba.com (player game logs, free, no key needed)
- Anthropic Claude API / OpenAI API (news agent)
- Bayesian ML engine (localStorage persistence)
- Kelly Criterion — Quarter-Kelly bet sizing
- Canvas API (portfolio chart)

---

## Disclaimer

This app is a statistical and analytical tool — it does not guarantee wins. Even +EV bets lose in the short run due to variance. A positive edge means you win more often than the odds imply over a large sample. This tool is designed to give you a long-run mathematical advantage, not predict individual game outcomes. Always bet responsibly and never more than you can afford to lose. If you or someone you know has a gambling problem, call 1-800-GAMBLER.
