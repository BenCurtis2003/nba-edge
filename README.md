# NBA Edge 🏀

**A full-stack NBA betting analytics engine with real-time EV calculation, ML-weighted conviction scoring, and automated paper portfolio tracking.**

> Paper trading only. Built to demonstrate quantitative sports analytics — not financial advice.

---

## What It Does

NBA Edge runs two parallel systems every 8 minutes:

1. **EV Engine** — fetches live odds from 6 sportsbooks, deviggs using Pinnacle as the sharp-money benchmark, and surfaces bets where your estimated probability exceeds the book's implied probability by ≥1.5%. Sizes each bet using fractional Kelly Criterion.

2. **Conviction Engine** — independently scores every NBA game 0–100 using 7 ML-weighted signals (form, rest, net rating, ATS record, home court, H2H, pace mismatch). No line pricing involved. Bets scoring ≥70 are auto-placed in the paper portfolio.

Results are tracked in a live paper portfolio starting at $100, with full history, P&L, win rate, and a portfolio performance chart — visible without any API key.

---

## Features

### EV Betting Engine
- **6-sportsbook line shopping** — DraftKings, FanDuel, BetMGM, Caesars, PointsBet, BetRivers
- **Pinnacle no-vig devigging** — uses sharp market as probability ground truth
- **Kelly Criterion sizing** — fractional Kelly (25%) scales bet size to edge magnitude
- **Market bias detection** — classifies vig level (Very Sharp / Sharp / Normal / High Vig) to assess market efficiency each day
- **Near-EV surfacing** — shows sub-threshold bets when no sharp plays exist
- **Player props** — via TheRundown API (free tier, 20k datapoints/day)
- **Line move tracking** — detects sharp money movement vs public action

### Conviction Plays Engine
- **7 ML-weighted signals per game per team:**
  - Season Win Rate (22%)
  - Net Rating / Point Differential (20%)
  - Rest Advantage (18%)
  - ATS Record (14%)
  - Home Court Advantage (12%)
  - Head-to-Head Record (8%)
  - Pace Mismatch (6%)
- **Self-learning** — after 15+ resolved plays, the ML model reweights signals based on what actually predicted wins
- **Three bet types per game** — Moneyline, Spread, Game Total each scored independently
- **AUTO-BET badge** — plays ≥70/100 are paper-placed automatically; below 70 show as WATCH ONLY
- **Live rescoring** — during active games, conviction scores update every 60s using ESPN live data (score differential, game clock, momentum), blended with pregame signals

### Paper Portfolio
- **$100 starting bankroll** — tracks every placed bet with full Kelly %, wager amount, and P&L
- **Auto-resolution** — ESPN scores used to settle bets; games >4h old with no score are estimated using predicted probability
- **Undo Clear** — one-click restore after clearing history
- **Resolve Now** — manual trigger to immediately settle pending bets
- **Portfolio chart** — bankroll curve with win/loss dots
- **ML model stats** — win rate, record, P&L, learning status

### Live Data (No Key Required)
- **Conviction plays load immediately** — ESPN is free and unlimited, no API key needed
- **Live game updates** — ESPN scoreboard polled every 60s during active games
- **History always visible** — new users see algorithm accuracy before entering any key

---

## API Keys

| Key | Source | Cost | Required For |
|-----|--------|------|-------------|
| Odds API | [the-odds-api.com](https://the-odds-api.com) | Free (500 req/month) | Live EV bets |
| TheRundown | [therundown.io/api](https://therundown.io/api) | Free (20k pts/day) | Player props |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Pay-per-use | AI news & injury agent |

The app polls the Odds API every **8 minutes** to stay within the free tier (~180 calls/day vs 500/month limit). ESPN data is unlimited and free.

---

## Tech Stack

- **React** — single-file JSX (~3,000 lines), no build step required
- **ESPN Site API** — free scoreboard, team records, game logs (no key needed)
- **The Odds API** — live lines: spreads, totals, moneylines
- **TheRundown API** — player props
- **Anthropic Claude API** — news and injury summarization agent
- **localStorage** — bet history, ML model weights, API keys (all client-side, never transmitted)
- **Recharts** — portfolio performance chart

---

## How the Math Works

### Devigging (No-Vig Fair Odds)
```
impliedProb = odds < 0 ? (-odds)/(-odds+100) : 100/(odds+100)
noVigProb   = impliedProb / (impliedHome + impliedAway)
```

### Edge & EV
```
edge = ourProbability - bookImpliedProbability (no-vig)
EV   = edge / bookImpliedProbability * 100
```

### Kelly Criterion (Fractional)
```
kellyFull = (edge * decOdds) / (decOdds - 1)
kellyFrac = kellyFull * 0.25     // 25% fractional — reduces variance
wager     = bankroll * kellyFrac
```

### Conviction Score (0–100)
```
score = Σ (signalScore[i] * weight[i])

// After 15+ resolved plays, ML reweighting:
learnedWeight[i] = baseWeight[i] * (signalAccuracy[i] / averageAccuracy)
```

---

## Bet Resolution Logic

1. **Odds API scores** — checked first (`daysFrom=3`)
2. **ESPN fallback** — today + yesterday's completed games (free, no key)
3. **Time-based removal** — games started >3.2h ago removed from active view
4. **Auto-estimate** — games >4h old with no matching score resolved using `ourProbability`
5. **Mock data cleanup** — demo bet IDs silently removed on first resolve

---

## Polling Architecture

```
Odds API   ── every 8 min ──► EV bets + conviction odds merge
ESPN Live  ── every 60s  ──► Live conviction rescoring during active games
Score API  ── once/cycle ──► Shared between resolution + stale bet removal
```

All systems are non-blocking — EV bets render immediately while conviction loads in the background.

---

## Configuration

```js
STARTING_BANKROLL       = 100       // Paper bankroll (USD)
MIN_EV_EDGE             = 1.5%      // Minimum edge for game lines
MIN_EV_EDGE_PROP        = 2.5%      // Minimum edge for player props
MIN_EV_EDGE_LONGSHOT    = 6.0%      // Minimum edge for +125 or longer
POLL_INTERVAL_MS        = 480000    // Odds API: every 8 minutes
ESPN_POLL_MS            = 60000     // ESPN live scores: every 60 seconds
CONVICTION_AUTO_BET     = 70        // Minimum score to auto-place
KELLY_FRACTION          = 0.25      // Fractional Kelly multiplier
```

---

## Deploying

### Vercel / Netlify
```bash
npx create-react-app nba-edge
cp nba-edge.jsx src/App.jsx
npm run build
```

### Replit
Paste `nba-edge.jsx` as `src/App.jsx` in a React template. Add API keys via Secrets panel or the in-app API Setup modal.

### Local
```bash
npx create-react-app nba-edge
cd nba-edge
cp nba-edge.jsx src/App.jsx
npm start
```

---

## ML Models (localStorage)

| Key | Tracks | Activates |
|-----|--------|-----------|
| `nba_edge_ml_v1` | EV bet signal accuracy, ROI, win rate | Always |
| `nba_edge_conviction_ml_v1` | Conviction signal accuracy per-signal | After 15+ resolved plays |

Both reset if localStorage is cleared. The UI shows "Learning" until enough data exists to reweight.

---

## Sportsbook Coverage

| Book | Sharp Rating |
|------|-------------|
| DraftKings | Standard |
| FanDuel | Standard |
| BetMGM | Standard |
| Caesars | Standard |
| PointsBet | Standard |
| BetRivers | Standard |
| Pinnacle | Sharp benchmark (not shown as betting option) |

---

## License

MIT — use freely, attribution appreciated.
