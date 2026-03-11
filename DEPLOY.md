# NBA Edge — Server-Automated Portfolio

> **What changed in v2:** The app no longer requires any user input. Your API keys live in Vercel environment variables. A cron job runs the engine every 8 minutes and writes results to a shared database. Every visitor sees the same live, growing portfolio — no login, no API key prompt.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vercel Cron  (every 8 min)                             │
│    → /api/cron/run-engine                               │
│       · Fetches live odds  (Odds API, your key)         │
│       · Builds conviction plays  (ESPN, free)           │
│       · Places qualifying bets                          │
│       · Writes to Vercel KV  ←──────────────────┐      │
│    → /api/cron/resolve-bets  (every 30 min)      │      │
│       · Fetches scores                           │      │
│       · Settles pending bets                     │      │
│       · Updates bankroll in KV  ─────────────────┘      │
│                                                         │
│  Every visitor  →  /api/portfolio  →  reads KV          │
│    · Same live portfolio for everyone                   │
│    · No API key needed to view                          │
│    · Auto-refreshes every 60s                           │
└─────────────────────────────────────────────────────────┘
```

---

## Deploy in 4 Steps

### Step 1 — Fork & import to Vercel

1. Push this folder to a GitHub repo (or zip-upload directly to Vercel)
2. Go to [vercel.com/new](https://vercel.com/new) → Import your repo
3. Framework: **Next.js** (auto-detected)
4. Don't deploy yet — you need environment variables first

### Step 2 — Create Vercel KV database

1. In your Vercel project dashboard → **Storage** tab → **Create Database**
2. Choose **KV** (Redis-compatible) → name it `nba-edge-kv` → create
3. Click **Connect** to link it to your project
4. Vercel automatically adds all `KV_*` environment variables

### Step 3 — Add environment variables

In your Vercel project → **Settings** → **Environment Variables**, add:

| Variable | Value | Where to get it |
|----------|-------|-----------------|
| `ODDS_API_KEY` | your key | [the-odds-api.com](https://the-odds-api.com) — free, 500 req/month |
| `CRON_SECRET` | any random string | run `openssl rand -hex 32` in terminal |
| `RUNDOWN_API_KEY` | your key (optional) | [therundown.io/api](https://therundown.io/api) — for player props |
| `ANTHROPIC_API_KEY` | your key (optional) | [console.anthropic.com](https://console.anthropic.com) — for AI news |

> The `KV_*` variables are added automatically in Step 2. Don't add them manually.

### Step 4 — Deploy

Click **Deploy**. Once live:

1. Verify the site loads at your Vercel URL
2. **Seed initial data** by running the engine manually once:

```bash
curl -X POST https://your-app.vercel.app/api/trigger \
  -H "Content-Type: application/json" \
  -d '{"secret":"your_cron_secret_here"}'
```

From this point, the cron runs automatically forever.

---

## How the Automation Works

### Cron Schedule (vercel.json)

```json
{
  "crons": [
    { "path": "/api/cron/run-engine",   "schedule": "*/8 * * * *"  },
    { "path": "/api/cron/resolve-bets", "schedule": "*/30 * * * *" }
  ]
}
```

- **run-engine** fires every 8 minutes: fetches odds, builds conviction plays, places qualifying bets into KV
- **resolve-bets** fires every 30 minutes: checks ESPN/Odds API scores, settles pending bets, updates bankroll

### What runs without an Odds API key

Even with no Odds API key, the engine still:
- Fetches today's NBA games from ESPN (free, unlimited)
- Scores every game 0–100 using 7 ML-weighted conviction signals
- Auto-places conviction plays ≥70 as 2% Kelly paper bets
- Resolves completed games using ESPN final scores

With an Odds API key, it additionally:
- Extracts EV bets from 6-sportsbook line shopping
- Uses Pinnacle no-vig devigging for accurate probabilities
- Sizes bets with full fractional Kelly (25%)

### Bet placement logic

A bet is placed if:
- **EV bet:** edge ≥ 1.5% (game lines), ≥ 6% (longshots +125 or longer), ≥ 2.5% (props)
- **Conviction play:** conviction score ≥ 70/100
- The same game hasn't already been bet today (deduplication by `betId + calendar date`)

### Bankroll management

- Starts at **$100**
- EV bets: fractional Kelly sizing (Kelly% × 25% of bankroll)
- Conviction bets: flat **2%** of bankroll
- Kelly capped at **8%** maximum per bet
- Bankroll updates only after resolution (not at placement)

---

## File Structure

```
nba-edge-server/
├── pages/
│   ├── index.jsx              ← Public dashboard (read-only for visitors)
│   ├── _app.jsx
│   └── api/
│       ├── portfolio.js       ← GET /api/portfolio — serves live data to frontend
│       ├── trigger.js         ← POST /api/trigger  — manual engine run
│       └── cron/
│           ├── run-engine.js  ← Cron: finds + places bets every 8 min
│           └── resolve-bets.js← Cron: settles completed games every 30 min
├── lib/
│   ├── engine.js              ← Core math: EV, Kelly, conviction scoring, resolution
│   └── store.js               ← Vercel KV read/write wrapper
├── vercel.json                ← Cron schedule config
├── next.config.js
├── package.json
└── .env.example               ← Copy to .env.local for local dev
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Create local env file
cp .env.example .env.local
# Fill in your keys

# 3. For local KV, use Vercel CLI (connects to your real KV)
npm install -g vercel
vercel link        # link to your Vercel project
vercel env pull    # pulls KV_* variables into .env.local

# 4. Start dev server
npm run dev

# 5. Manually trigger engine in a second terminal
curl -X POST http://localhost:3000/api/trigger \
  -H "Content-Type: application/json" \
  -d '{"secret":"your_cron_secret_here"}'
```

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/portfolio` | GET | None | Full portfolio snapshot (cached 30s) |
| `/api/trigger` | POST | `{ secret }` | Manually run engine + resolve |
| `/api/cron/run-engine` | GET | Cron header | Find + place bets |
| `/api/cron/resolve-bets` | GET | Cron header | Settle completed games |

### Portfolio response shape

```json
{
  "bankroll": 107.42,
  "totalPnl": 7.42,
  "winRate": 54.2,
  "roi": 8.3,
  "record": { "wins": 13, "losses": 11 },
  "history": [...],
  "currentBets": [...],
  "convictionPlays": [...],
  "lastRun": "2026-03-11T18:32:00Z",
  "mlStatus": "Active",
  "mlBets": 24
}
```

---

## Costs

Everything runs on free tiers:

| Service | Free Tier | Usage |
|---------|-----------|-------|
| Vercel Hosting | Free | Unlimited |
| Vercel Cron | Free (2 crons) | ✓ using exactly 2 |
| Vercel KV | Free (30k req/month) | ~500 req/day = 15k/month ✓ |
| The Odds API | 500 req/month | ~180/month at 8-min polling ✓ |
| ESPN API | Unlimited free | ✓ |

Total cost: **$0/month** on free tiers.

---

## KV Data Schema

All keys stored under `nba_edge:*` namespace:

| Key | Type | Contents |
|-----|------|----------|
| `nba_edge:history` | JSON array | All bet history entries |
| `nba_edge:bankroll` | Number | Current bankroll |
| `nba_edge:ml_model` | JSON object | ML model weights + stats |
| `nba_edge:conviction_ml` | JSON object | Conviction signal accuracy |
| `nba_edge:current_bets` | JSON array | Today's EV bets (24h TTL) |
| `nba_edge:conviction_plays` | JSON array | Today's conviction plays (24h TTL) |
| `nba_edge:last_run` | ISO string | Timestamp of last engine run |

---

## Conviction Signal Weights

| Signal | Default Weight | What It Measures |
|--------|---------------|-----------------|
| Season Win Rate | 22% | Overall team quality |
| Net Rating / Record Edge | 20% | Point differential vs opponent |
| Rest Advantage | 18% | Days since last game |
| ATS Record | 14% | Against-the-spread performance |
| Home Court | 12% | Home/away historical edge |
| Head-to-Head | 8% | Historical H2H record |
| Pace Mismatch | 6% | Style matchup |

After 15+ resolved conviction plays, the ML engine reweights these based on which signals actually predicted wins.

---

## Troubleshooting

**Portfolio shows no data after deploy**
→ Run the manual trigger once: `POST /api/trigger`

**Cron isn't firing**
→ Check Vercel dashboard → your project → Cron Jobs tab. Crons only run on Vercel (not local).

**KV connection errors**
→ Make sure KV database is connected to your project in Vercel Storage tab.

**"0 EV bets" every cycle**
→ Normal without Odds API key. Conviction plays still run from ESPN. Add `ODDS_API_KEY` for EV bets.

**Bets not resolving**
→ ESPN scores are typically available 30–60 min after game ends. The resolve cron runs every 30 min.
